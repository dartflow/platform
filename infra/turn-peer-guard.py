#!/usr/bin/python3 -I
"""Fixed, root-only TURN same-host relay boundary; no application secrets."""
import argparse
import json
import os
from pathlib import Path
import re
import socket
import subprocess

PUBLIC_IP = '128.140.93.95'
SITES = {'staging': (49160, 49179), 'production': (49180, 49199)}
NFT = '/usr/sbin/nft'
CGROUP_ROOT = Path('/sys/fs/cgroup')


def binding(environment):
    if environment not in SITES:
        raise ValueError('Unknown fixed TURN environment')
    return ('dartflow_turn_' + environment + '_guard',
            '/system.slice/dg-turn-' + environment + '.service')


def current_cgroup(environment, content):
    """The pre-start process must belong to exactly this current v2 service."""
    _table, expected = binding(environment)
    if content.splitlines() != ['0::' + expected]:
        raise ValueError('TURN guard must run inside its exact unified service cgroup')
    return expected


def nft(arguments, content=None):
    return subprocess.run([NFT, *arguments], input=content, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          check=True, timeout=10,
                          env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C.UTF-8'})


def rules(environment, replace):
    table, cgroup = binding(environment)
    minimum, maximum = SITES[environment]
    scope = f'socket cgroupv2 level 2 "{cgroup[1:]}" ip daddr {PUBLIC_IP}'
    # Both ports are bounded: neither control sockets nor another environment's
    # relay may use this exception. Everything else on our host is still denied.
    return (f'delete table inet {table}\n' if replace else '') + f'''table inet {table} {{
 chain output {{
  type filter hook output priority -10; policy accept;
  {scope} udp sport {minimum}-{maximum} udp dport {minimum}-{maximum} counter accept comment "dg-turn-{environment}-own-relay-v1"
  {scope} counter drop comment "dg-turn-{environment}-own-host-deny-v1"
 }}
}}
'''


def cgroup_id(environment):
    _table, cgroup = binding(environment)
    return (CGROUP_ROOT / cgroup[1:]).stat().st_ino


def inspect_text(environment, text, expected_id):
    """nft 1.0.9 JSON omits socket.level; verify its real text dump as well.

    Upstream datatype.c cgroupv2_type_print() resolves the stored kernel ID by
    searching current directory inode numbers. An emitted path therefore binds
    the stored ID to that live path; it is not a cached configuration label.
    """
    table, cgroup = binding(environment)
    minimum, maximum = SITES[environment]
    identity = '(?:' + re.escape(json.dumps(cgroup[1:])) + '|' + str(expected_id) + ')'
    scope = r'socket cgroupv2 level 2 ' + identity + r' ip daddr ' + re.escape(PUBLIC_IP)
    counter = r' counter packets [0-9]+ bytes [0-9]+ '
    allow = scope + f' udp sport {minimum}-{maximum} udp dport {minimum}-{maximum}' + counter + r'accept comment ' + re.escape(f'"dg-turn-{environment}-own-relay-v1"')
    deny = scope + counter + r'drop comment ' + re.escape(f'"dg-turn-{environment}-own-host-deny-v1"')
    pattern = r'table inet ' + re.escape(table) + r' \{ chain output \{ type filter hook output priority -10; policy accept; ' + allow + ' ' + deny + r' \} \}'
    if re.fullmatch(pattern, ' '.join(text.split())) is None:
        raise ValueError('TURN guard text, level or port boundary differs from review')


def inspect_document(environment, document, expected_id, text):
    """Accept only the two reviewed rules, bound to the live service's ID."""
    inspect_text(environment, text, expected_id)
    table, cgroup = binding(environment)
    minimum, maximum = SITES[environment]
    entries = document.get('nftables')
    if not isinstance(entries, list):
        raise ValueError('Invalid TURN guard state')
    tables, chains, actual_rules = [], [], []
    for entry in entries:
        if not isinstance(entry, dict) or len(entry) != 1:
            raise ValueError('Unexpected TURN guard object')
        if 'metainfo' in entry:
            continue
        if 'table' in entry:
            tables.append(entry['table'])
        elif 'chain' in entry:
            chains.append(entry['chain'])
        elif 'rule' in entry:
            actual_rules.append(entry['rule'])
        else:
            raise ValueError('Unexpected TURN guard object')
    if len(tables) != 1 or len(chains) != 1 or len(actual_rules) != 2:
        raise ValueError('Unexpected TURN guard table shape')
    if tables[0].get('family') != 'inet' or tables[0].get('name') != table or tables[0].get('flags'):
        raise ValueError('Unexpected TURN guard table')
    chain = chains[0]
    if any(chain.get(key) != value for key, value in {
        'family': 'inet', 'table': table, 'name': 'output', 'type': 'filter',
        'hook': 'output', 'prio': -10, 'policy': 'accept'
    }.items()) or chain.get('flags'):
        raise ValueError('Unexpected TURN guard chain')

    common = [({'socket': {'key': 'cgroupv2', 'level': 2}}, expected_id),
              ({'payload': {'protocol': 'ip', 'field': 'daddr'}}, PUBLIC_IP)]
    expected = [common + [({'payload': {'protocol': 'udp', 'field': 'sport'}}, {'range': [minimum, maximum]}),
                          ({'payload': {'protocol': 'udp', 'field': 'dport'}}, {'range': [minimum, maximum]})], common]
    counters = []
    for index, rule in enumerate(actual_rules):
        comment = f'dg-turn-{environment}-' + ('own-relay-v1' if index == 0 else 'own-host-deny-v1')
        if any(rule.get(key) != value for key, value in {'family': 'inet', 'table': table, 'chain': 'output', 'comment': comment}.items()):
            raise ValueError('Unexpected TURN guard rule')
        expressions = rule.get('expr')
        if not isinstance(expressions, list) or not expressions or expressions[-1] != ({'accept': None} if index == 0 else {'drop': None}):
            raise ValueError('Unexpected TURN guard verdict')
        matches, found_counter = [], None
        for expression in expressions[:-1]:
            if isinstance(expression, dict) and set(expression) == {'counter'}:
                counter = expression['counter']
                if found_counter is not None or not isinstance(counter, dict) or any(type(counter.get(key)) is not int or counter[key] < 0 for key in ['packets', 'bytes']):
                    raise ValueError('Invalid TURN guard counter')
                found_counter = counter['packets']
                continue
            if not isinstance(expression, dict) or set(expression) != {'match'}:
                raise ValueError('Unexpected TURN guard expression')
            match = expression['match']
            if not isinstance(match, dict) or set(match) != {'op', 'left', 'right'} or match['op'] != '==':
                raise ValueError('Unexpected TURN guard comparison')
            left, right = match['left'], match['right']
            if left == {'socket': {'key': 'cgroupv2'}}:
                # Verified independently against the actual text dump above.
                left = common[0][0]
            # nft may retain explicit protocol dependencies in JSON. They only
            # narrow the reviewed IPv4/UDP rule; all other extra matches fail.
            if left == {'meta': {'key': 'nfproto'}} and right in ['ipv4', 'ip', 2]:
                continue
            if index == 0 and left in [{'meta': {'key': 'l4proto'}}, {'payload': {'protocol': 'ip', 'field': 'protocol'}}] and right in ['udp', 17]:
                continue
            if left == common[0][0]:
                if right == cgroup[1:] or right == cgroup or right == str(expected_id):
                    right = expected_id
            matches.append((left, right))
        if matches != expected[index] or found_counter is None:
            raise ValueError('TURN guard cgroup or port boundary differs from review')
        counters.append(found_counter)
    return {'installed': True, 'environment': environment, 'ownIp': PUBLIC_IP,
            'serviceCgroupBound': True, 'cgroupPath': cgroup, 'cgroupId': expected_id,
            'sourceRange': [minimum, maximum], 'destinationRange': [minimum, maximum],
            'allowedOwnRelayCounter': counters[0], 'blockedOwnIpCounter': counters[1]}


def inspect(environment):
    table, _cgroup = binding(environment)
    expected_id = cgroup_id(environment)
    text = nft(['--numeric', 'list', 'table', 'inet', table]).stdout
    result = inspect_document(environment, json.loads(nft(['--json', '--numeric', 'list', 'table', 'inet', table]).stdout), expected_id, text)
    if cgroup_id(environment) != expected_id:
        raise ValueError('TURN service cgroup changed during guard inspection')
    return result


def install(environment):
    current_cgroup(environment, Path('/proc/self/cgroup').read_text())
    table, _cgroup = binding(environment)
    listed = json.loads(nft(['--json', 'list', 'tables']).stdout)
    entries = listed.get('nftables')
    if not isinstance(entries, list):
        raise ValueError('Invalid nft table listing')
    replace = any(isinstance(entry, dict) and isinstance(entry.get('table'), dict)
                  and entry['table'].get('family') == 'inet' and entry['table'].get('name') == table for entry in entries)
    batch = rules(environment, replace)
    nft(['--check', '--file', '-'], batch)
    # Delete+create is one kernel transaction. A validation/application failure
    # preserves all existing tables and propagates to abort ExecStartPre.
    nft(['--file', '-'], batch)
    return inspect(environment)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inspect', action='store_true', help='Read-only verification and counters')
    parser.add_argument('environment', choices=tuple(SITES))
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != 'dg-nxttrack-01':
        raise ValueError('Run as root on the fixed TURN host')
    print(json.dumps(inspect(args.environment) if args.inspect else install(args.environment)))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({'installed': False, 'status': 'failed', 'category': type(error).__name__,
                          'message': 'TURN peer guard failed; service startup must remain blocked.'}))
        raise SystemExit(1)
