#!/usr/bin/env python3
"""Fixed native DartFlow TURN provisioning. No app credentials leave this host.

Source: coturn 4.18.0, upstream commit 23c6c1d32a3d2b21a56cee65d3203bcc4ea82d2b.
No Docker, vendor service, existing firewall rule or other application is changed.
"""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import secrets
import socket
import stat
import subprocess
import tarfile
import urllib.request

COMMIT='23c6c1d32a3d2b21a56cee65d3203bcc4ea82d2b'
SOURCE_SHA='d7e2ee337b5298c30cc5cd365c3173d05b97c749d28e9416afa4ca907925ce15'
PREFIX=Path('/opt/dg-coturn-4.18.0')
PUBLIC_IP='128.140.93.95'
BUILDER='build-dg-turn'
ROOT=Path('/var/lib/dg-turn-build')
SITES={'staging':(3478,49160,49179),'production':(3479,49180,49199)}
DENIED=['0.0.0.0-0.255.255.255','10.0.0.0-10.255.255.255','100.64.0.0-100.127.255.255','127.0.0.0-127.255.255.255','169.254.0.0-169.254.255.255','172.16.0.0-172.31.255.255','192.0.0.0-192.0.0.255','192.168.0.0-192.168.255.255','198.18.0.0-198.19.255.255','224.0.0.0-255.255.255.255',PUBLIC_IP,'::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']

def run(args,**kwargs):
    return subprocess.run(args,check=True,text=True,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','LC_ALL':'C.UTF-8'},**kwargs)

def directory(path,mode=0o700,uid=0,gid=0):
    path=Path(path)
    if path.exists() or path.is_symlink():
        info=path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=uid: raise RuntimeError('Unexpected directory owner/type: '+str(path))
    else:path.mkdir(mode=mode)
    os.chown(path,uid,gid);os.chmod(path,mode)

def protected_write(path,data,mode=0o600):
    path=Path(path)
    if path.exists() or path.is_symlink():
        info=path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1: raise RuntimeError('Unexpected file owner/type: '+str(path))
        if path.read_bytes()==data:os.chmod(path,mode);return
    temp=path.with_name(path.name+'.new')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
    try:
        with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.replace(temp,path);os.chmod(path,mode)
    finally:
        if temp.exists():temp.unlink()

def build():
    metadata=PREFIX/'source.json'
    if metadata.exists():
        value=json.loads(metadata.read_text())
        if value.get('commit')!=COMMIT or value.get('archiveSha256')!=SOURCE_SHA:raise RuntimeError('Existing native TURN installation has a different source')
        for name,digest in value['binaries'].items():
            path=PREFIX/'bin'/name
            if path.is_symlink() or path.stat().st_uid!=0 or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:raise RuntimeError('Native TURN binary seal mismatch')
        return
    simulated=run(['/usr/bin/apt-get','--simulate','--no-install-recommends','install','libevent-dev','libssl-dev','pkg-config'],capture_output=True).stdout
    if '0 upgraded,' not in simulated:raise RuntimeError('Build prerequisites would upgrade shared packages; review separately')
    run(['/usr/bin/apt-get','--assume-yes','--no-install-recommends','--no-upgrade','install','libevent-dev','libssl-dev','pkg-config'],stdout=subprocess.DEVNULL)
    try:account=pwd.getpwnam(BUILDER)
    except KeyError:
        run(['/usr/sbin/useradd','--system','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',BUILDER]);account=pwd.getpwnam(BUILDER)
    directory(ROOT,0o750,0,account.pw_gid)
    work=ROOT/'4.18.0'
    if work.exists():raise RuntimeError('Previous native TURN build needs review before retry')
    directory(work,0o700,account.pw_uid,account.pw_gid)
    with urllib.request.urlopen('https://codeload.github.com/coturn/coturn/tar.gz/'+COMMIT,timeout=30) as response:archive=response.read(10*1024*1024+1)
    if len(archive)>10*1024*1024 or hashlib.sha256(archive).hexdigest()!=SOURCE_SHA:raise RuntimeError('Upstream source archive hash mismatch')
    with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as source:
        for member in source.getmembers():
            relative=PurePosixPath(member.name)
            if relative.is_absolute() or '..' in relative.parts or relative.parts[0]!='coturn-'+COMMIT:raise RuntimeError('Unsafe source archive path')
            if member.issym() or member.islnk():continue # Only unused example certificate/manpage links exist upstream.
            if not(member.isfile() or member.isdir()) or member.size>5*1024*1024:raise RuntimeError('Unsafe source archive member')
            target=work.joinpath(*relative.parts)
            if member.isdir():target.mkdir(mode=0o700,parents=True,exist_ok=True)
            else:
                target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                with source.extractfile(member) as stream:target.write_bytes(stream.read())
                os.chmod(target,0o700 if member.mode&0o111 else 0o600)
            os.chown(target,account.pw_uid,account.pw_gid)
    for current,dirs,_files in os.walk(work):
        os.chown(current,account.pw_uid,account.pw_gid)
        for name in dirs:os.chown(Path(current)/name,account.pw_uid,account.pw_gid)
    script=work/'build.sh'
    script.write_text('#!/bin/sh\nset -eu\nexport TURN_NO_PQ=1 TURN_NO_MYSQL=1 TURN_NO_SQLITE=1 TURN_NO_MONGO=1 TURN_NO_HIREDIS=1 TURN_NO_PROMETHEUS=1 TURN_NO_SYSTEMD=1 TURN_NO_SCTP=1\nexport CFLAGS="-O2 -D_FORTIFY_SOURCE=3 -fstack-protector-strong -fPIE"\nexport LDFLAGS="-Wl,-z,relro,-z,now -pie"\n./configure --prefix=/opt/dg-coturn-4.18.0\nmake -j2\n')
    os.chown(script,account.pw_uid,account.pw_gid);os.chmod(script,0o700)
    command=['/usr/bin/systemd-run','--wait','--collect','--quiet','--unit=dg-coturn-native-build','--property=User='+BUILDER,'--property=Group='+BUILDER,'--property=WorkingDirectory='+str(work/('coturn-'+COMMIT)),'--property=MemoryMax=1G','--property=CPUQuota=100%','--property=TasksMax=128','--property=RuntimeMaxSec=600','--property=ProtectSystem=strict','--property=ProtectHome=true','--property=PrivateTmp=true','--property=PrivateNetwork=true','--property=PrivateDevices=true','--property=NoNewPrivileges=true','--property=ReadWritePaths='+str(work),str(script)]
    run(command)
    directory(PREFIX,0o755);directory(PREFIX/'bin',0o755)
    digests={}
    for name in ['turnserver','turnutils_uclient','turnutils_peer']:
        source=work/('coturn-'+COMMIT)/'bin'/name
        if source.is_symlink() or not source.is_file() or source.stat().st_size>20*1024*1024:raise RuntimeError('Unexpected build artifact')
        data=source.read_bytes()
        if not data.startswith(b'\x7fELF'):raise RuntimeError('Build artifact is not an ELF binary')
        protected_write(PREFIX/'bin'/name,data,0o755);digests[name]=hashlib.sha256(data).hexdigest()
    protected_write(metadata,(json.dumps({'version':'4.18.0','commit':COMMIT,'archiveSha256':SOURCE_SHA,'binaries':digests},indent=2)+'\n').encode(),0o644)

def provision(environment,ports):
    port,minimum,maximum=ports
    site=Path('/etc/dg-sites')/('dartflow-'+environment)
    if not site.is_dir() or site.is_symlink() or site.stat().st_uid!=0:raise RuntimeError('Existing site root required')
    secret_path=site/'turn-secret'
    if secret_path.exists():
        info=secret_path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_mode&0o077:raise RuntimeError('TURN secret permissions are unsafe')
        secret=secret_path.read_text().strip()
        if len(base64.b64decode(secret,validate=True))!=32:raise RuntimeError('Existing TURN secret is invalid')
    else:
        secret=base64.b64encode(secrets.token_bytes(32)).decode();protected_write(secret_path,(secret+'\n').encode())
    lines=[f'listening-port={port}',f'listening-ip={PUBLIC_IP}',f'relay-ip={PUBLIC_IP}',f'external-ip={PUBLIC_IP}',f'min-port={minimum}',f'max-port={maximum}',f'realm=dartflow-{environment}',f'server-name=dartflow-{environment}','fingerprint','use-auth-secret','static-auth-secret='+secret,'no-tls','no-tcp-relay','no-multicast-peers','no-stun','stale-nonce=600','max-allocate-lifetime=600','user-quota=2','total-quota=10','max-bps=1500000','bps-capacity=8000000','relay-threads=2','log-file=stdout','simple-log','no-stdout-log=0','pidfile=/run/dg-turn-'+environment+'/turnserver.pid']
    lines += ['denied-peer-ip='+address for address in DENIED]
    config=site/'turnserver.conf';protected_write(config,('\n'.join(lines)+'\n').encode())
    unit='dg-turn-'+environment+'.service'
    content=f'''[Unit]
Description=DartFlow {environment} native TURN relay
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
DynamicUser=yes
LoadCredential=turn.conf:{config}
ExecStart={PREFIX}/bin/turnserver -c %d/turn.conf
RuntimeDirectory=dg-turn-{environment}
RuntimeDirectoryMode=0700
Restart=on-failure
RestartSec=5s
TimeoutStopSec=15s
MemoryMax=256M
CPUQuota=100%
TasksMax=64
LimitNOFILE=8192
NoNewPrivileges=yes
CapabilityBoundingSet=
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
IPAddressDeny=localhost
IPAddressDeny=10.0.0.0/8
IPAddressDeny=100.64.0.0/10
IPAddressDeny=169.254.0.0/16
IPAddressDeny=172.16.0.0/12
IPAddressDeny=192.168.0.0/16
IPAddressDeny=::/0
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictSUIDSGID=yes
LockPersonality=yes
UMask=0077
[Install]
WantedBy=multi-user.target
'''
    path=Path('/etc/systemd/system')/unit;protected_write(path,content.encode(),0o644)
    run(['/usr/bin/systemd-analyze','verify',str(path)],stdout=subprocess.DEVNULL)
    return unit,secret_path

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if os.geteuid()!=0 or socket.gethostname()!='dg-nxttrack-01':raise RuntimeError('Run as root on the fixed target host')
    if not args.apply:print(json.dumps({'host':'dg-nxttrack-01','sourceCommit':COMMIT,'sourceSha256':SOURCE_SHA,'sites':SITES,'mode':'preflight'}));return
    os.umask(0o077)
    if subprocess.run(['/usr/bin/systemctl','is-active','--quiet','coturn'],check=False).returncode==0:raise RuntimeError('The vendor coturn service is active; review its ownership before proceeding')
    build();units=[provision(environment,ports) for environment,ports in SITES.items()]
    run(['/usr/bin/systemctl','daemon-reload'])
    for unit,_path in units:run(['/usr/bin/systemctl','enable','--now',unit],stdout=subprocess.DEVNULL)
    for unit,_path in units:run(['/usr/bin/systemctl','is-active','--quiet',unit])
    for environment,(port,minimum,maximum) in SITES.items():
        for protocol in ['udp','tcp']:run(['/usr/sbin/ufw','allow',str(port)+'/'+protocol,'comment','DartFlow '+environment+' TURN'],stdout=subprocess.DEVNULL)
        run(['/usr/sbin/ufw','allow',str(minimum)+':'+str(maximum)+'/udp','comment','DartFlow '+environment+' relay'],stdout=subprocess.DEVNULL)
    print(json.dumps({'status':'installed','nativeVersion':'4.18.0','environments':[{ 'environment':unit.removeprefix('dg-turn-').removesuffix('.service'),'unit':unit,'secretFile':str(path)} for unit,path in units]}))

if __name__=='__main__':
    try:main()
    except (RuntimeError,subprocess.CalledProcessError,OSError,ValueError) as error:
        print(json.dumps({'status':'failed','category':type(error).__name__,'message':str(error) if isinstance(error,RuntimeError) else 'Native TURN provisioning failed; inspect the protected host journal.'}));raise SystemExit(1)
