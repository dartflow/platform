#!/usr/bin/env python3
"""Explicit, bounded smoke test against only the two owned DartFlow TURN endpoints.

Obtains five-minute HMAC credentials through the approved SSH account; shared
TURN secrets stay on the target. Exercises public UDP data relay, TCP control,
private-peer denial and cross-environment credential rejection. No browser media
or third-party peer is contacted. Run with --run-target to enable network work.
"""
import argparse
import hashlib
import hmac
import json
import secrets
import socket
import struct
import subprocess
import time
from datetime import datetime,timezone

HOST='128.140.93.95'
COOKIE=0x2112A442
SITES={'staging':(3478,49160,49179),'production':(3479,49180,49199)}

def attr(kind,value):return struct.pack('!HH',kind,len(value))+value+b'\0'*((-len(value))%4)
def packet(kind,attributes,key=None):
    tx=secrets.token_bytes(12);body=b''.join(attr(t,v) for t,v in attributes)
    header=struct.pack('!HHI12s',kind,len(body)+(24 if key else 0),COOKIE,tx)
    if key:body+=attr(0x0008,hmac.new(key,header+body,hashlib.sha1).digest())
    return header+body,tx

def exact(sock,length):
    data=b''
    while len(data)<length:
        chunk=sock.recv(length-len(data))
        if not chunk:raise RuntimeError('TURN TCP connection closed')
        data+=chunk
    return data

def receive(sock,tcp=False):
    if tcp:
        header=exact(sock,20);return header+exact(sock,struct.unpack('!H',header[2:4])[0])
    return sock.recvfrom(65535)[0]

def parse(data):
    if len(data)<20:raise RuntimeError('Invalid STUN response')
    kind,length,cookie,tx=struct.unpack('!HHI12s',data[:20])
    if cookie!=COOKIE or len(data)!=length+20:raise RuntimeError('Invalid STUN frame')
    attributes={};offset=20
    while offset<len(data):
        code,size=struct.unpack('!HH',data[offset:offset+4]);attributes.setdefault(code,data[offset+4:offset+4+size]);offset+=4+size+(-size)%4
    return kind,attributes,tx

def address(value):
    if len(value)!=8 or value[1]!=1:raise RuntimeError('Expected IPv4 relay address')
    return socket.inet_ntoa(struct.pack('!I',struct.unpack('!I',value[4:])[0]^COOKIE)),struct.unpack('!H',value[2:4])[0]^(COOKIE>>16)

def xor_address(value):
    ip,port=value;return struct.pack('!BBHI',0,1,port^(COOKIE>>16),struct.unpack('!I',socket.inet_aton(ip))[0]^COOKIE)

def error_code(attributes):
    value=attributes.get(0x0009,b'\0\0\0\0');return value[2]*100+value[3]

def credential(environment):
    source=f"""import base64,hashlib,hmac,json,time
from pathlib import Path
secret=Path('/etc/dg-sites/dartflow-{environment}/turn-secret').read_text().strip()
username=str(int(time.time())+300)+':codex-media-smoke:{environment}'
print(json.dumps({{'username':username,'credential':base64.b64encode(hmac.new(secret.encode(),username.encode(),hashlib.sha1).digest()).decode()}}))
"""
    result=subprocess.run(['ssh','-F','/home/codex/.ssh/dg-nxttrack-admin.conf','dg-nxttrack-01-admin','sudo -n python3 -'],input=source,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=15)
    return json.loads(result.stdout)

class Turn:
    def __init__(self,environment,credential_value,tcp=False):
        self.environment=environment;self.port=SITES[environment][0];self.tcp=tcp
        self.sock=socket.socket(socket.AF_INET,socket.SOCK_STREAM if tcp else socket.SOCK_DGRAM);self.sock.settimeout(5);self.sock.connect((HOST,self.port))
        self.credentials=credential_value;self.key=None;self.auth=[]
    def request(self,kind,attrs,authenticated=True):
        data,tx=packet(kind,(self.auth if authenticated else [])+attrs,self.key if authenticated else None);self.sock.send(data)
        response=receive(self.sock,self.tcp);response_kind,attributes,response_tx=parse(response)
        if response_tx!=tx:raise RuntimeError('Unexpected STUN transaction')
        return response_kind,attributes
    def allocate(self,expect_success=True):
        kind,challenge=self.request(0x0003,[(0x0019,struct.pack('!I',0x11000000))],False)
        if kind!=0x0113 or error_code(challenge)!=401:raise RuntimeError('TURN did not require authentication')
        realm=challenge[0x0014];nonce=challenge[0x0015]
        if realm.decode()!='dartflow-'+self.environment:raise RuntimeError('Wrong TURN environment realm')
        user=self.credentials['username'].encode();password=self.credentials['credential'].encode();self.key=hashlib.md5(user+b':'+realm+b':'+password).digest();self.auth=[(0x0006,user),(0x0014,realm),(0x0015,nonce)]
        kind,attrs=self.request(0x0003,[(0x0019,struct.pack('!I',0x11000000))])
        if not expect_success:
            if kind==0x0103:raise RuntimeError('Cross-environment TURN credential was accepted')
            return
        if kind!=0x0103:raise RuntimeError('Authenticated TURN allocation failed '+str(error_code(attrs)))
        self.relay=address(attrs[0x0016]);self.mapped=address(attrs[0x0020]);minimum,maximum=SITES[self.environment][1:]
        if self.relay[0]!=HOST or not minimum<=self.relay[1]<=maximum:raise RuntimeError('Relay escaped the environment port range')
    def permissions(self,peer,allowed):
        kind,attrs=self.request(0x0008,[(0x0012,xor_address(peer))])
        if allowed and kind!=0x0108:raise RuntimeError('Public owned peer permission failed')
        if not allowed and (kind!=0x0118 or error_code(attrs)!=403):raise RuntimeError('Private peer was not denied')
    def relay_test(self,peer_socket,peer_address):
        self.permissions(peer_address,True);payload=b'dartflow-native-turn-smoke:'+secrets.token_bytes(24)
        data,_tx=packet(0x0016,[(0x0012,xor_address(peer_address)),(0x0013,payload)]);self.sock.send(data)
        received,relay=peer_socket.recvfrom(65535)
        if received!=payload or relay!=self.relay:raise RuntimeError('Outbound relay payload or source mismatch')
        peer_socket.sendto(payload,relay)
        kind,attributes,_=parse(receive(self.sock,self.tcp))
        if kind!=0x0017 or attributes.get(0x0013)!=payload:raise RuntimeError('Return relay payload mismatch')
    def release(self):
        kind,_attrs=self.request(0x0004,[(0x000d,struct.pack('!I',0))])
        if kind!=0x0104:raise RuntimeError('TURN allocation cleanup failed')
    def close(self):self.sock.close()

def test_environment(environment,value,other):
    udp=Turn(environment,value);udp.allocate()
    try:
        # One socket acts both as control client and its owned public UDP peer.
        for peer in [('127.0.0.1',9),('10.0.0.1',9),('100.79.0.26',9),(HOST,9)]:udp.permissions(peer,False)
        udp.relay_test(udp.sock,udp.mapped);udp.release()
        tcp=Turn(environment,value,True)
        try:tcp.allocate();tcp.relay_test(udp.sock,udp.mapped);tcp.release()
        finally:tcp.close()
        wrong=Turn(environment,other)
        try:wrong.allocate(False)
        finally:wrong.close()
    finally:udp.close()
    return {'environment':environment,'listenerPort':SITES[environment][0],'relayRange':list(SITES[environment][1:]),'unauthenticatedAllocation':'rejected','udpRelayRoundTrip':'passed','tcpRelayRoundTrip':'passed','privateAndOwnHostPeers':'rejected','otherEnvironmentCredential':'rejected','allocationCleanup':'passed'}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run-target',action='store_true');args=parser.parse_args()
    if not args.run_target:print('Explicit --run-target is required; no network activity performed.');return
    stage=credential('staging');prod=credential('production')
    results=[test_environment('staging',stage,prod),test_environment('production',prod,stage)]
    print(json.dumps({'checkedAt':datetime.now(timezone.utc).isoformat(),'host':HOST,'nativeVersion':'4.18.0','results':results},indent=2))

if __name__=='__main__':main()
