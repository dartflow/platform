#!/usr/bin/python3 -I
"""Root-only, per-environment TURN TLS upgrade and certificate refresh.

Preserves existing UDP ports, relay ranges, auth secret and peer guard. No firewall,
Caddy configuration, unrelated unit or application runtime configuration is edited.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import socket
import stat
import subprocess
import sys
import time

HOST='dg-nxttrack-01'
SITES={'staging':('staging.dartflow.nl',3478),'production':('dartflow.nl',3479)}
SITES_ROOT=Path('/etc/dg-sites')
UNITS=Path('/etc/systemd/system')
STATE=Path('/var/lib/dg-turn-tls')
BACKUPS=Path('/var/backups/dg-turn-tls')
CADDY=Path('/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory')
HELPER=Path('/usr/local/libexec/dg-turn-tls.py')

def run(args,input=None):
    result=subprocess.run(args,input=input,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False,timeout=45,
        env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8'})
    if result.returncode:raise RuntimeError('A protected TLS validation or service operation failed')
    return result.stdout

def secure_directory(path):
    path=Path(path)
    if path.exists() or path.is_symlink():
        info=path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=0 or info.st_mode&0o022:raise RuntimeError('Unsafe protected directory')
    else:path.mkdir(mode=0o700,parents=True)
    os.chown(path,0,0);os.chmod(path,0o700)

def read_protected(path,owner=0,max_bytes=1048576):
    path=Path(path)
    before=path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_uid!=owner or before.st_mode&0o022 or before.st_nlink!=1:raise RuntimeError('Unsafe protected file')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    with os.fdopen(fd,'rb') as stream:
        info=os.fstat(stream.fileno())
        if (info.st_dev,info.st_ino)!=(before.st_dev,before.st_ino):raise RuntimeError('Protected file changed during access')
        value=stream.read(max_bytes+1)
    if len(value)>max_bytes:raise RuntimeError('Protected file exceeds its limit')
    return value

def atomic(path,data,mode=0o600):
    path=Path(path)
    if path.exists() or path.is_symlink():read_protected(path)
    temporary=path.with_name('.'+path.name+'.'+secrets.token_hex(8))
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    try:
        with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path);os.chmod(path,mode)
    finally:
        if temporary.exists():temporary.unlink()

def settings(data):
    result={}
    for line in data.decode().splitlines():
        line=line.strip()
        if not line or line.startswith('#'):continue
        key,separator,value=line.partition('=')
        result.setdefault(key.strip(),[]).append(value.strip() if separator else 'true')
    return result

def tls_config(data,environment):
    _host,port=SITES[environment];parsed=settings(data)
    if parsed.get('listening-port')!=[str(port)] or len(parsed.get('static-auth-secret',[]))!=1 or parsed.get('use-auth-secret')!=['true']:
        raise RuntimeError('Unexpected existing TURN port or authentication configuration')
    if parsed.get('no-udp') not in (None,['false'],['0']):raise RuntimeError('Existing UDP must remain enabled')
    managed={'tls-listening-port','cert','pkey','no-tls','no-tcp','no-dtls','dtls'}
    lines=[line for line in data.decode().splitlines() if line.strip().split('=',1)[0] not in managed]
    credentials=f'/run/credentials/dg-turn-{environment}.service'
    lines.extend([f'tls-listening-port={port}','no-tcp','no-dtls',f'cert={credentials}/turn.crt',f'pkey={credentials}/turn.key'])
    return ('\n'.join(lines)+'\n').encode()

def dropin(environment,generation):
    return f'''# Managed by dg-turn-tls.py. Root-only source files become service credentials.
[Service]
LoadCredential=turn.crt:{generation}/fullchain.pem
LoadCredential=turn.key:{generation}/privkey.pem
'''.encode()

def refresh_unit(environment):
    return f'''[Unit]
Description=Refresh DartFlow {environment} TURN certificate credentials
After=caddy.service
[Service]
Type=oneshot
User=root
Group=root
ExecStart=/usr/bin/python3 -I {HELPER} --refresh {environment}
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
'''.encode()

def refresh_timer(environment):
    return f'''[Unit]
Description=Hourly DartFlow {environment} TURN certificate refresh
[Timer]
OnCalendar=hourly
RandomizedDelaySec=300
Persistent=true
Unit=dg-turn-tls-refresh-{environment}.service
[Install]
WantedBy=timers.target
'''.encode()

def certificate_pair(environment):
    host,_port=SITES[environment];directory=CADDY/host;caddy_uid=pwd.getpwnam('caddy').pw_uid
    # Caddy is expected to own its certificate store; neither group nor other
    # users may write any of its ancestors beneath the fixed store root.
    for parent in [CADDY.parent,CADDY,directory]:
        info=parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in(0,caddy_uid) or info.st_mode&0o022:raise RuntimeError('Unsafe Caddy certificate store')
    cert=read_protected(directory/(host+'.crt'),caddy_uid,65536)
    key=read_protected(directory/(host+'.key'),caddy_uid,16384)
    # Neither private-key bytes nor public-key output are printed or placed in
    # argv. Require name, validity and an exact certificate/key public-key match.
    run(['/usr/bin/openssl','x509','-noout','-checkend','86400'],cert)
    name_check=run(['/usr/bin/openssl','x509','-noout','-checkhost',host],cert)
    if f'Hostname {host} does match certificate'.encode() not in name_check:raise RuntimeError('Certificate does not match this environment host')
    public_cert=run(['/usr/bin/openssl','x509','-pubkey','-noout'],cert)
    public_key=run(['/usr/bin/openssl','pkey','-pubout'],key)
    if public_cert!=public_key:raise RuntimeError('Caddy certificate and private key do not match')
    return cert,key

def managed_paths(environment):
    site=SITES_ROOT/('dartflow-'+environment)
    unit=f'dg-turn-{environment}.service'
    return site,unit,[site/'turnserver.conf',UNITS/(unit+'.d')/'30-tls.conf',UNITS/f'dg-turn-tls-refresh-{environment}.service',UNITS/f'dg-turn-tls-refresh-{environment}.timer']

def snapshot(environment,paths):
    secure_directory(BACKUPS);secure_directory(BACKUPS/environment)
    location=BACKUPS/environment/(time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+secrets.token_hex(6));secure_directory(location)
    records=[]
    for index,path in enumerate(paths):
        present=path.exists() or path.is_symlink()
        record={'path':str(path),'present':present,'backup':str(location/str(index))}
        if present:
            data=read_protected(path);record['mode']=stat.S_IMODE(path.stat().st_mode);atomic(location/str(index),data)
        records.append(record)
    secure_directory(STATE)
    atomic(STATE/(environment+'-last.json'),json.dumps({'environment':environment,'records':records}).encode())
    return records

def restore(records):
    for record in records:
        path=Path(record['path'])
        if record['present']:atomic(path,read_protected(record['backup']),record['mode'])
        elif path.exists():read_protected(path);path.unlink()

def rollback(environment):
    site,unit,paths=managed_paths(environment)
    stored=json.loads(read_protected(STATE/(environment+'-last.json')))
    if stored.get('environment')!=environment or [r['path'] for r in stored.get('records',[])]!=[str(p) for p in paths]:raise RuntimeError('Unexpected rollback inventory')
    run(['/usr/bin/systemctl','disable','--now',f'dg-turn-tls-refresh-{environment}.timer'])
    restore(stored['records']);run(['/usr/bin/systemctl','daemon-reload']);run(['/usr/bin/systemctl','restart',unit]);run(['/usr/bin/systemctl','is-active','--quiet',unit])
    if paths[-1].exists():run(['/usr/bin/systemctl','enable','--now',paths[-1].name])
    return {'status':'rolled-back','environment':environment,'serviceActive':True}

def apply(environment,refresh=False):
    site,unit,paths=managed_paths(environment);host,port=SITES[environment]
    if not site.is_dir() or site.is_symlink() or site.stat().st_uid!=0:raise RuntimeError('Owned DartFlow site root is required')
    original=read_protected(paths[0]);updated=tls_config(original,environment)
    if refresh and original!=updated:raise RuntimeError('Refresh requires an already provisioned TLS configuration')
    details=run(['/usr/bin/systemctl','show',unit,'--property=DynamicUser','--property=User','--property=LoadState']).decode().splitlines()
    if 'DynamicUser=yes' not in details or f'User=dg-turn-{environment}' not in details or 'LoadState=loaded' not in details:raise RuntimeError('Unexpected TURN service identity')
    cert,key=certificate_pair(environment);fingerprint=hashlib.sha256(cert).hexdigest()
    tls_root=site/'turn-tls';secure_directory(tls_root);generation=tls_root/fingerprint[:32];secure_directory(generation)
    atomic(generation/'fullchain.pem',cert);atomic(generation/'privkey.pem',key)
    expected=dropin(environment,generation)
    if refresh and paths[1].exists() and read_protected(paths[1])==expected:
        return {'status':'unchanged','environment':environment,'certificateSha256':fingerprint}
    secure_directory(paths[1].parent)
    records=snapshot(environment,paths)
    try:
        atomic(paths[0],updated);atomic(paths[1],expected,0o644)
        if not refresh:
            # The source is copied only after it has been reviewed and installed
            # in a root-owned non-writable operator directory.
            source=Path(__file__).resolve()
            if source!=HELPER:
                if source.parent.stat().st_uid!=0 or source.parent.stat().st_mode&0o022:raise RuntimeError('Unsafe operator source directory')
                data=read_protected(source,max_bytes=65536)
                if not data.startswith(b'#!/usr/bin/python3 -I\n'):raise RuntimeError('Unexpected operator helper format')
                atomic(HELPER,data,0o700)
            atomic(paths[2],refresh_unit(environment),0o644);atomic(paths[3],refresh_timer(environment),0o644)
        run(['/usr/bin/systemctl','daemon-reload']);run(['/usr/bin/systemd-analyze','verify',str(paths[2]),str(paths[3])])
        run(['/usr/bin/systemctl','restart',unit]);run(['/usr/bin/systemctl','is-active','--quiet',unit])
        run(['/usr/bin/systemctl','enable','--now',paths[3].name])
    except BaseException:
        restore(records);run(['/usr/bin/systemctl','daemon-reload']);run(['/usr/bin/systemctl','restart',unit]);run(['/usr/bin/systemctl','is-active','--quiet',unit]);raise RuntimeError('TLS upgrade failed; prior configuration restored and relay restarted')
    return {'status':'refreshed' if refresh else 'installed','environment':environment,'host':host,'port':port,'tlsOnlyTcp':True,'legacyUdpPreserved':True,'certificateSha256':fingerprint,'externalProbeRequired':True}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--apply',action='store_true');mode.add_argument('--refresh',action='store_true');mode.add_argument('--rollback',action='store_true')
    parser.add_argument('environment',choices=SITES);args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!=HOST:raise RuntimeError('Run as root on the fixed DartFlow target host')
    os.umask(0o077)
    lock=Path('/run/lock')/('dg-turn-tls-'+args.environment+'.lock')
    fd=os.open(lock,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
    try:
        if os.fstat(fd).st_uid!=0:raise RuntimeError('Unsafe operation lock')
        fcntl.flock(fd,fcntl.LOCK_EX)
        print(json.dumps(rollback(args.environment) if args.rollback else apply(args.environment,args.refresh)))
    finally:os.close(fd)

if __name__=='__main__':
    try:main()
    except Exception:
        print(json.dumps({'status':'failed','message':'TURN TLS operation failed. Inspect protected service state; no credentials were logged.'}));sys.exit(1)
