"""Read-only production checks required before submitting an Oche Live AAB to Play."""
import argparse
import http.client
import json
import re

HOST='dartflow.nl'
def get_json(path):
    connection=http.client.HTTPSConnection(HOST,timeout=20)
    try:
        connection.request('GET',path,headers={'Accept':'application/json','User-Agent':'DartFlow-Oche-Release-Check/1'})
        response=connection.getresponse()
        content=response.read(131073)
        if response.status!=200 or len(content)>131072 or response.getheader('Content-Type','').split(';')[0]!='application/json':
            raise ValueError(f'{path} moet zonder redirect begrensde JSON met HTTP 200 geven.')
        return json.loads(content)
    finally:connection.close()

def validate(capabilities,associations,package,fingerprint):
    if not re.fullmatch(r'(?:[A-F0-9]{2}:){31}[A-F0-9]{2}',fingerprint):
        raise ValueError('Vul PLAY_APP_SIGNING_SHA256 in met het echte Play App signing-certificaat.')
    if capabilities.get('apiVersion')!=1 or capabilities.get('origin')!='https://dartflow.nl' or capabilities.get('permissions')!={'read':True,'score':False,'extend':False}:
        raise ValueError('De productiebackend bevestigt schermcontract v1 met uitsluitend leesrechten niet.')
    if not isinstance(associations,list):raise ValueError('assetlinks.json moet een array zijn.')
    for entry in associations:
        if not isinstance(entry,dict):continue
        target=entry.get('target',{})
        if 'delegate_permission/common.handle_all_urls' in entry.get('relation',[]) and target.get('namespace')=='android_app' and target.get('package_name')==package and fingerprint in target.get('sha256_cert_fingerprints',[]):
            return
    raise ValueError('De productiehost bevestigt de opgegeven package en het Play app-signingcertificaat nog niet.')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--package',required=True);parser.add_argument('--fingerprint',required=True);args=parser.parse_args()
    try:validate(get_json('/api/oche/v1/capabilities'),get_json('/.well-known/assetlinks.json'),args.package,args.fingerprint)
    except (ValueError,OSError,http.client.HTTPException) as error:
        parser.exit(1,f'Play-preflight gestopt: {error}\n')
    print('Productiebackend en Play App Links bevestigd; er zijn geen gegevens gewijzigd.')
if __name__=='__main__':main()
