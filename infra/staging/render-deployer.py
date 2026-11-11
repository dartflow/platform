#!/usr/bin/python3 -I
"""Produce two fixed broker variants for review; this does not install or run them."""
import argparse
import hashlib
import json
from pathlib import Path

SOURCE = Path(__file__).resolve().parent
REPOSITORY_ROOT = SOURCE.parents[1]
ENVIRONMENTS = {
    'staging': {'site': 'dartflow-staging', 'entry': 'dg-dartflow-deploy', 'helper': 'dg-dartflow-deploy-helper', 'extractor': 'dartflow-extract-source.py', 'guardian': 'dartflow-lock-guardian.py', 'gate': 'dartflow-release-gate.mjs', 'origin': 'https://staging.dartflow.nl', 'projectRef': 'dsnqnvbckkqpzadblshu', 'port': 4174, 'suffix': 'stg', 'workflow': 'deploy-staging.yml'},
    'production': {'site': 'dartflow-production', 'entry': 'dg-dartflow-production-deploy', 'helper': 'dg-dartflow-production-deploy-helper', 'extractor': 'dartflow-production-extract-source.py', 'guardian': 'dartflow-production-lock-guardian.py', 'gate': 'dartflow-production-release-gate.mjs', 'origin': 'https://dartflow.nl', 'projectRef': 'wlrnowuownakqqgjxnbb', 'port': 4175, 'suffix': 'prd', 'workflow': 'deploy-production.yml'},
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fixed_source(text, environment):
    """Only these reviewed compile-time literals differ; runtime selection is absent."""
    if environment == 'staging':
        return text
    for before, after in [
        ('dartflow-staging', 'dartflow-production'),
        ('staging.dartflow.nl', 'dartflow.nl'),
        ('dsnqnvbckkqpzadblshu', 'wlrnowuownakqqgjxnbb'),
        ('PORT = 4174', 'PORT = 4175'),
        ('run-dart-stg', 'run-dart-prd'), ('build-dart-stg', 'build-dart-prd'), ('app-dart-stg', 'app-dart-prd'),
        ('dg-dartflow-deploy-helper', 'dg-dartflow-production-deploy-helper'),
        ('dartflow-extract-source.py', 'dartflow-production-extract-source.py'),
        ('dartflow-release-gate.mjs', 'dartflow-production-release-gate.mjs'),
        ('dartflow-lock-guardian.py', 'dartflow-production-lock-guardian.py'),
        ('deploy-staging.yml', 'deploy-production.yml'),
        ('Description=Dartflow staging native release', 'Description=Dartflow production native release'),
    ]:
        text = text.replace(before, after)
    text = text.replace("SIBLING_ACCOUNTS = ('run-dart-prd', 'build-dart-prd', 'app-dart-prd')", "SIBLING_ACCOUNTS = ('run-dart-stg', 'build-dart-stg', 'app-dart-stg')")
    return text


def render(environment, output):
    if environment not in ENVIRONMENTS:
        raise ValueError('Choose one of the two fixed environments')
    spec = ENVIRONMENTS[environment]
    output = Path(output)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    contents = {}

    def put(path, data, executable=False):
        data = data.encode() if isinstance(data, str) else data
        destination = output / path.lstrip('/')
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with destination.open('xb') as stream:
            stream.write(data)
        destination.chmod(0o700 if executable else 0o600)
        contents[path] = {'sha256': digest(data), 'bytes': len(data)}
        return digest(data)

    helper = fixed_source((SOURCE / 'deploy-helper.py').read_text(), environment)
    helper_hash = put('/usr/local/libexec/' + spec['helper'], helper, True)
    extractor_hash = put('/usr/local/libexec/' + spec['extractor'], (SOURCE / 'extract-source.py').read_bytes(), True)
    guardian_hash = put('/usr/local/libexec/' + spec['guardian'], fixed_source((SOURCE / 'lock-guardian.py').read_text(), environment), True)
    put('/usr/local/libexec/dartflow-probe-lock-lifetime.py', (SOURCE / 'probe-lock-lifetime.py').read_bytes(), True)
    # Gate code supports only the two exact workflow identities. The helper sends
    # its own fixed value; runner input cannot choose a workflow or environment.
    gate_hash = put('/usr/local/libexec/' + spec['gate'], (REPOSITORY_ROOT / 'ops/release-gate.mjs').read_bytes(), True)
    entry = fixed_source((SOURCE / 'deploy-entry.py').read_text(), environment).replace('__REVIEWED_HELPER_SHA256__', helper_hash)
    put('/usr/local/bin/' + spec['entry'], entry, True)
    sudoers = fixed_source((SOURCE / 'dartflow-staging.sudoers.example').read_text(), environment).replace('__REVIEWED_HELPER_SHA256__', helper_hash)
    put('/etc/sudoers.d/' + spec['site'], sudoers)
    put('/etc/systemd/system/' + spec['site'] + '.service', fixed_source((SOURCE / 'dartflow-staging.service.example').read_text(), environment))
    policy = json.loads(fixed_source((SOURCE / 'deploy-policy.example.json').read_text(), environment))
    policy.update(repository='dartflow/platform', integrationBranch='main', port=spec['port'], backend={'projectRef': spec['projectRef']}, gateSha256=gate_hash, extractorSha256=extractor_hash, guardianSha256=guardian_hash,
                  node='/opt/node-v24.18.0-linux-x64/bin/node', npm='/opt/node-v24.18.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js')
    # Account IDs and config allowlist need host verification; never invent them.
    put('/etc/dg-sites/' + spec['site'] + '/deploy.example.json', json.dumps(policy, indent=2) + '\n')
    manifest = {'format': 'dartflow-fixed-broker-v1', 'environment': environment, **spec, 'repository': 'dartflow/platform', 'integrationBranch': 'main', 'files': contents}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'manifest.json').chmod(0o600)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', choices=tuple(ENVIRONMENTS), required=True)
    parser.add_argument('--output', type=Path, required=True, help='New empty render directory; no installation is performed')
    args = parser.parse_args()
    manifest = render(args.environment, args.output)
    print(json.dumps({'environment': args.environment, 'output': str(args.output.resolve()), 'files': len(manifest['files'])}))


if __name__ == '__main__':
    main()
