"""Bind an Oche publication to the exact gated signing run and immutable bundle bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

PACKAGE = 'nl.dartflow.ochelive'
UPLOAD_CERTIFICATE = '91:55:1C:31:71:01:D4:D2:57:56:41:8C:FA:AC:93:50:0D:29:9F:66:61:D2:93:B3:6E:B4:A8:7F:67:0F:ED:9B'
APP_CERTIFICATE = 'D1:1D:97:4C:3B:F6:B0:1A:97:92:90:D9:C7:F5:D4:63:D7:DB:50:93:78:7C:F2:E6:8B:E5:1E:74:B1:6D:CB:62'
REQUIRED_JOBS = ('Android lint, tests en debugbuild', 'Android UI · google_apis', 'Android UI · android-tv', 'AAB signeren en intern publiceren')
REQUIRED_TESTS = {'unitPerVariant': 44, 'uiPerTarget': 24, 'failures': 0, 'errors': 0, 'skipped': 0}


def require(value, message):
    if not value:
        raise ValueError(message)


def integer(value):
    return type(value) is int and 1 <= value <= 2_100_000_000


def identity(source, digest, code, version, run_id, run_number):
    require(isinstance(source, str) and re.fullmatch(r'[a-f0-9]{40}', source), 'Full lowercase source SHA required.')
    require(isinstance(digest, str) and re.fullmatch(r'[a-f0-9]{64}', digest), 'Full bundle SHA-256 required.')
    require(isinstance(version, str) and re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version), 'Invalid versionName.')
    require(integer(code) and integer(run_number) and code == 1000 + run_number and code > 1063, 'The unique versionCode must follow the reviewed Oche run counter.')
    require(type(run_id) is int and 0 < run_id < 10**20, 'Invalid signing run identity.')


def bundle_digest(bundle):
    require(not bundle.is_symlink() and bundle.is_file() and 0 < bundle.stat().st_size <= 200 * 1024 * 1024, 'Invalid bundle file.')
    with zipfile.ZipFile(bundle) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)) and {'base/manifest/AndroidManifest.xml', 'BundleConfig.pb'} <= set(names), 'Invalid Android bundle structure.')
    with bundle.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def make_receipt(bundle, source, code, version, run_id, run_number):
    digest = bundle_digest(bundle)
    identity(source, digest, code, version, run_id, run_number)
    return {'schemaVersion': 1, 'package': PACKAGE, 'sourceCommit': source,
            'versionCode': code, 'versionName': version, 'runId': run_id, 'runNumber': run_number,
            'bundleSha256': digest, 'bundleBytes': bundle.stat().st_size,
            'uploadCertificateSha256': UPLOAD_CERTIFICATE, 'requiredTests': REQUIRED_TESTS}


def validate(receipt, run, jobs, artifacts, release, rulesets, bundle, source, digest, code, tag, run_id, version):
    identity(source, digest, code, version, run_id, run.get('run_number'))
    require(run.get('id') == run_id and run.get('path') == '.github/workflows/oche-android-ci.yml'
            and run.get('event') == 'workflow_dispatch' and run.get('head_sha') == source
            and run.get('head_branch') == 'main' and run.get('head_repository', {}).get('full_name') == 'dartflow/platform'
            and run.get('status') == 'completed' and run.get('conclusion') == 'success'
            and integer(run.get('run_attempt')), 'Exact successful Oche signing run on main required.')
    for name in REQUIRED_JOBS:
        matches = [job for job in jobs.get('jobs', []) if job.get('name') == name]
        require(len(matches) == 1 and matches[0].get('run_id') == run_id
                and matches[0].get('head_sha') == source and matches[0].get('status') == 'completed'
                and matches[0].get('conclusion') == 'success', 'A required Oche build, native UI or signing job did not succeed.')
    for name in ('oche-signed-aab', 'oche-signing-receipt'):
        matches = [artifact for artifact in artifacts.get('artifacts', []) if artifact.get('name') == name]
        require(len(matches) == 1 and matches[0].get('expired') is False
                and matches[0].get('workflow_run', {}).get('id') == run_id
                and matches[0].get('workflow_run', {}).get('head_sha') == source
                and matches[0].get('workflow_run', {}).get('head_branch') == 'main', 'Exact unexpired signing artifacts required.')
    expected = make_receipt(bundle, source, code, version, run_id, run['run_number'])
    require(receipt == expected and expected['bundleSha256'] == digest, 'Signing receipt or bundle bytes differ from the tested CI artifact.')
    immutable = [rule for rule in rulesets if rule.get('target') == 'tag' and rule.get('enforcement') == 'active'
                 and rule.get('conditions', {}).get('ref_name') == {'include': ['refs/tags/oche-v*'], 'exclude': []}
                 # GitHub redacts bypass_actors from read-only tokens. Reject a visible
                 # bypass, without claiming a redacted field proves absence of bypass.
                 and ('bypass_actors' not in rule or rule['bypass_actors'] == [])
                 and {'update', 'deletion'} <= {item.get('type') for item in rule.get('rules', [])}]
    require(immutable, 'Oche release tags must have active update and deletion protection.')
    require(tag == f'oche-v{version}' and release.get('tagName') == tag
            and release.get('targetCommitish') == source and release.get('isDraft') is False, 'Published GitHub release must identify the exact tested source and Oche version.')
    return expected


def read_json(path):
    require(not path.is_symlink() and path.is_file() and path.stat().st_size <= 2 * 1024 * 1024, 'Invalid bounded provenance file.')
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    receipt = commands.add_parser('receipt')
    verify = commands.add_parser('verify')
    for command in (receipt, verify):
        command.add_argument('--bundle', required=True, type=Path)
        command.add_argument('--source-sha', required=True)
        command.add_argument('--run-id', required=True, type=int)
        command.add_argument('--version-code', required=True, type=int)
        command.add_argument('--version-name', required=True)
    receipt.add_argument('--run-number', required=True, type=int)
    receipt.add_argument('--output', required=True, type=Path)
    verify.add_argument('--sha256', required=True)
    verify.add_argument('--tag', required=True)
    verify.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.action == 'receipt':
            result = make_receipt(args.bundle, args.source_sha, args.version_code, args.version_name, args.run_id, args.run_number)
            args.output.write_text(json.dumps(result, sort_keys=True, indent=2) + '\n')
        else:
            values = [read_json(args.directory / name) for name in ('oche-signing-receipt.json', 'run.json', 'jobs.json', 'artifacts.json', 'release.json', 'rulesets.json')]
            result = validate(*values, args.bundle, args.source_sha, args.sha256, args.version_code, args.tag, args.run_id, args.version_name)
        print(json.dumps(result, sort_keys=True))
    except (ValueError, OSError, TypeError, AttributeError, zipfile.BadZipFile):
        parser.exit(1, 'Oche publication stopped: signing provenance or bundle verification failed.\n')


if __name__ == '__main__':
    main()
