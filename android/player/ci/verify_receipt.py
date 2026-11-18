"""Validate the exact signed player bundle from a reviewed GitHub release."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

UPLOAD_CERTIFICATE='97:C8:A2:78:FF:67:14:BD:E4:F1:BC:B5:4E:BA:15:12:28:D4:2E:83:8F:11:D4:3B:CF:6E:71:C7:DE:08:A0:09'

def validate(receipt,source,expected_digest,version_code,tag,bundle):
    if not re.fullmatch(r'[a-f0-9]{40}',source) or not re.fullmatch(r'[a-f0-9]{64}',expected_digest):
        raise ValueError('Use the full source SHA and bundle SHA-256.')
    if not isinstance(receipt,dict) or receipt.get('schemaVersion')!=1 or receipt.get('package')!='nl.dartflow.app':
        raise ValueError('The receipt must identify the native production player package.')
    version=receipt.get('versionName','')
    if not isinstance(version,str) or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',version):
        raise ValueError('Invalid player version.')
    if receipt.get('sourceCommit')!=source or receipt.get('versionCode')!=version_code or isinstance(receipt.get('versionCode'),bool) or not 1<=version_code<=2100000000:
        raise ValueError('Source or version differs from the requested release.')
    if tag!=f'android-player-{version}-{version_code}' or receipt.get('uploadCertificateSha256')!=UPLOAD_CERTIFICATE:
        raise ValueError('The release tag or upload certificate differs.')
    entries=[a for a in receipt.get('artifacts',[]) if isinstance(a,dict) and a.get('file')=='app-production-release.aab']
    if len(entries)!=1 or entries[0].get('sha256')!=expected_digest:
        raise ValueError('Exactly one matching signed AAB receipt is required.')
    if bundle.is_symlink() or not bundle.is_file() or not 0<bundle.stat().st_size<=200*1024*1024 or entries[0].get('bytes')!=bundle.stat().st_size:
        raise ValueError('Bundle file size does not match the receipt.')
    with bundle.open('rb') as handle:digest=hashlib.file_digest(handle,'sha256').hexdigest()
    if digest!=expected_digest:raise ValueError('The bundle bytes have changed.')
    with zipfile.ZipFile(bundle) as archive:
        names=archive.namelist()
        if len(names)!=len(set(names)) or not {'base/manifest/AndroidManifest.xml','BundleConfig.pb'}<=set(names):
            raise ValueError('Invalid Android app bundle structure.')
    return {'package':'nl.dartflow.app','versionName':version,'versionCode':version_code,'sourceCommit':source,'bundleSha256':digest}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for flag in ('source-sha','sha256','tag'):parser.add_argument('--'+flag,required=True)
    parser.add_argument('--version-code',type=int,required=True)
    args=parser.parse_args()
    try:
        path=Path('release-receipt.json')
        if path.is_symlink() or path.stat().st_size>65536:raise ValueError('Invalid receipt file.')
        result=validate(json.loads(path.read_text()),args.source_sha,args.sha256,args.version_code,args.tag,Path('app-production-release.aab'))
    except (ValueError,OSError,TypeError,zipfile.BadZipFile) as error:parser.exit(1,f'Player release verification stopped: {error}\n')
    print(json.dumps(result))
if __name__=='__main__':main()
