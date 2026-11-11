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
OWNED_WORKER='65.108.158.112'
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
    source=f"""import base64,hashlib,hmac,json,secrets,time
from pathlib import Path
secret=Path('/etc/dg-sites/dartflow-{environment}/turn-secret').read_text().strip()
username=str(int(time.time())+300)+':codex-media-smoke:{environment}:'+secrets.token_hex(12)
print(json.dumps({{'username':username,'credential':base64.b64encode(hmac.new(secret.encode(),username.encode(),hashlib.sha1).digest()).decode()}}))
"""
    result=subprocess.run(['ssh','-F','/home/codex/.ssh/dg-nxttrack-admin.conf','dg-nxttrack-01-admin','sudo -n python3 -'],input=source,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=15)
    return json.loads(result.stdout)

def guard_snapshot(environment):
    if environment not in SITES:raise RuntimeError('Unknown guard environment')
    command=['ssh','-F','/home/codex/.ssh/dg-nxttrack-admin.conf','dg-nxttrack-01-admin',
             'sudo -n /usr/bin/python3 /usr/local/libexec/dg-turn-peer-guard.py --inspect '+environment]
    result=subprocess.run(command,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=15)
    if len(result.stdout)>16384:raise RuntimeError('Unexpected peer guard inspection size')
    value=json.loads(result.stdout);expected=list(SITES[environment][1:])
    if value.get('environment')!=environment or value.get('ownIp')!=HOST or value.get('cgroupPath')!='/system.slice/dg-turn-'+environment+'.service' or type(value.get('cgroupId')) is not int or value['cgroupId']<=0 or type(value.get('allowedOwnRelayCounter')) is not int or value['allowedOwnRelayCounter']<0 or value.get('installed') is not True or value.get('serviceCgroupBound') is not True or value.get('sourceRange')!=expected or value.get('destinationRange')!=expected or type(value.get('blockedOwnIpCounter')) is not int or value['blockedOwnIpCounter']<0:raise RuntimeError('Exact source/destination per-service peer guard is not verified')
    value['_environment']=environment
    return value

class AllocationFailure(RuntimeError):
    def __init__(self,message,code):
        super().__init__(message);self.code=code

class Turn:
    def __init__(self,environment,credential_value,tcp=False,connected=True):
        self.environment=environment;self.port=SITES[environment][0];self.tcp=tcp;self.connected=tcp or connected;self.allocated=False;self.allocation_pending=False;self.closed=False
        self.credentials=credential_value;self.key=None;self.auth=[]
        self.sock=socket.socket(socket.AF_INET,socket.SOCK_STREAM if tcp else socket.SOCK_DGRAM);self.sock.settimeout(5)
        try:
            if self.connected:self.sock.connect((HOST,self.port))
            else:self.sock.bind(('0.0.0.0',0))
        except BaseException:
            self.sock.close();raise
    def request(self,kind,attrs,authenticated=True):
        data,tx=packet(kind,(self.auth if authenticated else [])+attrs,self.key if authenticated else None)
        if self.connected:self.sock.send(data)
        else:self.sock.sendto(data,(HOST,self.port))
        if self.tcp:response=receive(self.sock,True)
        else:
            response,source=self.sock.recvfrom(65535)
            if source!=(HOST,self.port):raise RuntimeError(f'Unexpected TURN control source {source[0]}:{source[1]}')
        response_kind,attributes,response_tx=parse(response)
        if response_tx!=tx:raise RuntimeError('Unexpected STUN transaction')
        return response_kind,attributes
    def diagnostic(self,kind,attrs):
        return f'environment={self.environment} transport={"tcp" if self.tcp else "udp"} kind=0x{kind:04x} error={error_code(attrs)}'
    def allocate(self,expect_success=True,requested_family=None):
        kind,challenge=self.request(0x0003,[(0x0019,struct.pack('!I',0x11000000))],False)
        if kind==0x0103:self.allocated=True
        if kind!=0x0113 or error_code(challenge)!=401:raise RuntimeError('TURN did not require authentication '+self.diagnostic(kind,challenge))
        realm=challenge[0x0014];nonce=challenge[0x0015]
        if realm.decode()!='dartflow-'+self.environment:raise RuntimeError('Wrong TURN environment realm')
        user=self.credentials['username'].encode();password=self.credentials['credential'].encode();self.key=hashlib.md5(user+b':'+realm+b':'+password).digest();self.auth=[(0x0006,user),(0x0014,realm),(0x0015,nonce)]
        attributes=[(0x0019,struct.pack('!I',0x11000000))]
        if requested_family is not None:attributes.append((0x0017,bytes([requested_family,0,0,0])))
        self.allocation_pending=True
        kind,attrs=self.request(0x0003,attributes)
        self.allocation_pending=False
        # Record allocation before parsing its addresses, so validation failures also release it.
        if kind==0x0103:self.allocated=True
        if requested_family==2:
            if kind!=0x0113 or error_code(attrs) not in (440,508):raise RuntimeError('IPv6 relay allocation was not explicitly denied '+self.diagnostic(kind,attrs))
            # Some native failure paths keep provisional session/quota state.
            # Explicitly request lifetime zero; 437 proves no allocation exists.
            self.allocation_pending=True
            return error_code(attrs)
        if not expect_success:
            if kind!=0x0113 or error_code(attrs)!=401:raise RuntimeError('Cross-environment credential was not explicitly rejected '+self.diagnostic(kind,attrs))
            return
        if kind!=0x0103:raise AllocationFailure('Authenticated TURN allocation failed '+self.diagnostic(kind,attrs),error_code(attrs))
        self.relay=address(attrs[0x0016]);self.mapped=address(attrs[0x0020]);minimum,maximum=SITES[self.environment][1:]
        if self.relay[0]!=HOST or not minimum<=self.relay[1]<=maximum:raise RuntimeError(f'Relay escaped environment range relay={self.relay[0]}:{self.relay[1]}')
        if self.mapped[0]!=OWNED_WORKER:raise RuntimeError(f'Mapped peer is outside the owned worker mapped={self.mapped[0]}:{self.mapped[1]}')
    def permissions(self,peer,allowed,guard=None,blocked_probe=False):
        if allowed and peer[0]!=OWNED_WORKER:
            minimum,maximum=SITES[self.environment][1:]
            permitted=peer[0]==HOST and guard and guard.get('_environment')==self.environment and (minimum<=peer[1]<=maximum or blocked_probe)
            if not permitted:raise RuntimeError('Public relay probe restricted to the owned worker or verified same-environment relay')
        kind,attrs=self.request(0x0008,[(0x0012,xor_address(peer))])
        detail=f'{self.diagnostic(kind,attrs)} peer={peer[0]}:{peer[1]} mapped={self.mapped[0]}:{self.mapped[1]} relay={self.relay[0]}:{self.relay[1]}'
        if allowed and kind!=0x0108:raise RuntimeError('Public owned peer permission failed '+detail)
        if not allowed and (kind!=0x0118 or error_code(attrs)!=403):raise RuntimeError('Private peer was not denied '+detail)
    def relay_test(self,peer_socket,peer_address):
        self.permissions(peer_address,True);payload=b'dartflow-native-turn-smoke:'+secrets.token_bytes(24)
        # An ICE peer sends its connectivity check first. This also opens a
        # stateful worker/NAT path to the exact server relay endpoint.
        peer_socket.sendto(payload,self.relay)
        kind,attributes,_=parse(receive(self.sock,self.tcp))
        if kind!=0x0017 or attributes.get(0x0013)!=payload or address(attributes.get(0x0012,b''))!=peer_address:raise RuntimeError('Inbound relay payload or peer mismatch')
        data,_tx=packet(0x0016,[(0x0012,xor_address(peer_address)),(0x0013,payload)]);self.sock.send(data)
        received,relay=peer_socket.recvfrom(65535)
        if received!=payload or relay!=self.relay:raise RuntimeError('Outbound relay payload or source mismatch')
    def release(self):
        if not self.allocated and not self.allocation_pending:return False
        kind,attrs=self.request(0x0004,[(0x000d,struct.pack('!I',0))])
        if kind!=0x0104 and not(self.allocation_pending and kind==0x0114 and error_code(attrs)==437):raise RuntimeError('TURN allocation cleanup failed '+self.diagnostic(kind,attrs))
        if kind==0x0104 and attrs.get(0x000d)!=struct.pack('!I',0):raise RuntimeError('Refresh did not acknowledge lifetime zero')
        self.allocated=False;self.allocation_pending=False
        return kind==0x0104
    def close(self):
        if not self.closed:self.sock.close();self.closed=True

def test_environment(environment,value,other,guarded=False):
    resources=[];failure=None;release_acknowledged=False
    def endpoint(credentials,tcp=False,connected=True):
        instance=Turn(environment,credentials,tcp,connected);resources.append(instance);return instance
    def allocate_after_release(instance):
        for attempt,delay in enumerate([0,0.6,0.6]):
            if delay:time.sleep(delay)
            try:instance.allocate();return
            except AllocationFailure as error:
                # Retry only a real 486 after this environment's acknowledged
                # lifetime-zero release. Authentication/IPv6 proofs never retry.
                if error.code!=486 or not release_acknowledged or attempt==2:raise
    try:
        # This unconnected peer accepts packets from the relay's 491xx port.
        # Its own authenticated allocation discovers the real public mapping
        # against the same owned server, without any third-party STUN endpoint.
        guard=guard_snapshot(environment) if guarded else None
        private_peers=[('127.0.0.1',9),('10.0.0.1',9),('100.79.0.26',9)]+([] if guarded else [(HOST,9)])
        peer=endpoint(credential(environment),connected=False);peer.allocate()
        release_acknowledged=peer.release()
        udp=endpoint(value);allocate_after_release(udp)
        udp.relay_test(peer.sock,peer.mapped)
        for private in private_peers:udp.permissions(private,False)
        release_acknowledged=udp.release();udp.close()
        # The mapping socket stays bound, but only one test allocation is live.
        tcp=endpoint(credential(environment),True);allocate_after_release(tcp)
        tcp.relay_test(peer.sock,peer.mapped)
        for private in private_peers:tcp.permissions(private,False)
        tcp.release();tcp.close()
        for transport in [False,True]:
            wrong=endpoint(other,transport)
            try:wrong.allocate(False)
            finally:
                try:wrong.release()
                finally:wrong.close()
        same_server=[];guard_drops=[];ipv6_denial={};ipv6_cleanup={}
        if guarded:
            for transport,tcp_control in [('udp',False),('tcp',True)]:
                current_guard=guard_snapshot(environment)
                first=endpoint(credential(environment),tcp_control);first.allocate()
                second=endpoint(credential(environment),tcp_control);second.allocate()
                first.permissions(second.relay,True,current_guard);second.permissions(first.relay,True,current_guard)
                payload=b'dartflow-same-server-relay:'+secrets.token_bytes(24)
                data,_=packet(0x0016,[(0x0012,xor_address(second.relay)),(0x0013,payload)]);first.sock.send(data)
                kind,attrs,_=parse(receive(second.sock,second.tcp))
                if kind!=0x0017 or attrs.get(0x0013)!=payload or address(attrs.get(0x0012,b''))!=first.relay:raise RuntimeError('Same-server first relay hop failed')
                data,_=packet(0x0016,[(0x0012,xor_address(first.relay)),(0x0013,payload)]);second.sock.send(data)
                kind,attrs,_=parse(receive(first.sock,first.tcp))
                if kind!=0x0017 or attrs.get(0x0013)!=payload or address(attrs.get(0x0012,b''))!=second.relay:raise RuntimeError('Same-server return relay hop failed')
                after_pair=guard_snapshot(environment)
                if after_pair['cgroupId']!=current_guard['cgroupId'] or after_pair['allowedOwnRelayCounter']<current_guard['allowedOwnRelayCounter']+2:raise RuntimeError('Same-server relay guard binding or allowed counter changed unexpectedly')
                same_server.append({'transport':transport,'roundTrip':'passed','relayPorts':[first.relay[1],second.relay[1]],'kernelAllowedDatagrams':after_pair['allowedOwnRelayCounter']-current_guard['allowedOwnRelayCounter']})
                second.release();second.close();first.release();first.close()
                if not tcp_control:
                    other_environment='production' if environment=='staging' else 'staging'
                    for port in [9,3478,3479,443,2019,SITES[other_environment][1]]:
                        # Pinned coturn closes a relay after a kernel EPERM.
                        # Each denial therefore needs an independent allocation;
                        # reusing a poisoned socket would never reach nft again.
                        probe=endpoint(credential(environment),True);probe.allocate()
                        before=guard_snapshot(environment)
                        probe.permissions((HOST,port),True,before,blocked_probe=True)
                        data,_=packet(0x0016,[(0x0012,xor_address((HOST,port))),(0x0013,b'dartflow-guard-denied:'+secrets.token_bytes(24))]);probe.sock.send(data)
                        # SSH inspection allows packet processing before reading its counter.
                        after=guard_snapshot(environment)
                        if after['cgroupId']!=before['cgroupId'] or after['blockedOwnIpCounter']!=before['blockedOwnIpCounter']+1:raise RuntimeError(f'Own-IP guard did not record exactly one dropped datagram destinationPort={port}')
                        guard_drops.append({'destinationPort':port,'egressTransport':'udp','controlTransport':'tcp','kernelDroppedDatagrams':1,'independentAllocation':True})
                        try:probe.release()
                        finally:probe.close()
        # Failed family allocation can reserve provisional quota/BPS until
        # teardown. Run these strict negative proofs last and close each
        # control immediately; 437 proves absence, not synchronous quota release.
        for name,tcp_control in [('udp',False),('tcp',True)]:
            negative=endpoint(credential(environment),tcp_control)
            try:
                ipv6_denial[name]=negative.allocate(requested_family=2)
                acknowledged=negative.release()
                ipv6_cleanup[name]={'refreshZero':'acknowledged' if acknowledged else '437-no-allocation',
                                    'controlSocket':'closed',
                                    'quotaRelease':'not-synchronously-asserted; server teardown/watchdog or external host reset'}
            finally:
                try:negative.release()
                finally:negative.close()
    except BaseException as error:
        failure=error;raise
    finally:
        cleanup_errors=[]
        for instance in reversed(resources):
            try:
                if not instance.closed:instance.release()
            except Exception as error:cleanup_errors.append(str(error))
            finally:instance.close()
        if cleanup_errors:
            message='TURN cleanup errors: '+'; '.join(cleanup_errors)
            if failure is not None:failure.add_note(message)
            else:raise RuntimeError(message)
    return {'environment':environment,'listenerPort':SITES[environment][0],'relayRange':list(SITES[environment][1:]),'unauthenticatedAllocation':'rejected','udpRelayRoundTrip':'passed','tcpRelayRoundTrip':'passed','privatePeers':'rejected-both-transports','ownHostPorts':'kernel-drop-verified' if guarded else 'permission-rejected-both-transports','otherEnvironmentCredential':'rejected-both-transports','allocationCleanup':{'normalRefreshZero':'acknowledged','controlSockets':'closed-before-return','quotaRelease':'asynchronous; not-synchronously-asserted','failedIpv6':ipv6_cleanup},'peerMapping':'owned-server-authenticated-allocation','maximumAcknowledgedLiveAllocationsPerCredential':1,'quotaRetryAfterAcknowledgedRelease':{'maximumAttempts':3,'delaysSeconds':[0,0.6,0.6]},'authenticatedIpv6AllocationDenied':ipv6_denial,'sameEnvironmentRelayRoundTrips':same_server,'ownIpKernelGuardDrops':guard_drops}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run-target',action='store_true');parser.add_argument('--run-guarded-relay',action='store_true',help='Require installed exact per-service peer guard and test own-IP relay/denied ports');args=parser.parse_args()
    if not args.run_target:print('Explicit --run-target is required; no network activity performed.');return
    stage=credential('staging');prod=credential('production')
    results=[test_environment('staging',stage,prod,args.run_guarded_relay),test_environment('production',prod,stage,args.run_guarded_relay)]
    print(json.dumps({'checkedAt':datetime.now(timezone.utc).isoformat(),'host':HOST,'nativeVersion':'4.18.0','results':results},indent=2))

if __name__=='__main__':main()
