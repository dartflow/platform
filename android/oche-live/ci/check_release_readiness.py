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

def validate_deployment(capabilities,health,ready,sha):
    if not re.fullmatch(r'[a-f0-9]{40}',sha):raise ValueError('Volledige geteste web-SHA vereist.')
    if capabilities.get('layouts',{}).get('version')!=1 or capabilities.get('layouts',{}).get('dualLocation') is not True:
        raise ValueError('De productiebackend bevestigt de vereiste schermindeling nog niet.')
    if health.get('sha')!=sha or health.get('status')!='ok' or health.get('mode')!='supabase':
        raise ValueError('De gezonde productiebackend gebruikt niet de expliciete web-SHA.')
    if ready.get('sha')!=sha or ready.get('status')!='ready' or ready.get('database')!='ok' or ready.get('auth')!='reachable':
        raise ValueError('Database en authenticatie van de expliciete webrelease zijn niet gereed.')
    if not health.get('releaseId') or health.get('releaseId')!=ready.get('releaseId') or not health.get('buildConfigId') or any(value.get('buildConfigId')!=health['buildConfigId'] or value.get('runtimeConfigId')!=health['buildConfigId'] for value in (health,ready)):
        raise ValueError('De backend veranderde tijdens de deploymentcontrole.')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--package',required=True);parser.add_argument('--fingerprint',required=True);parser.add_argument('--sha');args=parser.parse_args()
    try:
        capabilities=get_json('/api/oche/v1/capabilities')
        validate(capabilities,get_json('/.well-known/assetlinks.json'),args.package,args.fingerprint)
        if args.sha:validate_deployment(capabilities,get_json('/api/health'),get_json('/api/ready'),args.sha)
    except (ValueError,OSError,http.client.HTTPException) as error:
        parser.exit(1,f'Play-preflight gestopt: {error}\n')
    print('Productiebackend en Play App Links bevestigd; er zijn geen gegevens gewijzigd.')
if __name__=='__main__':main()
