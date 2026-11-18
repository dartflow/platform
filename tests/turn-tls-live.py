#!/usr/bin/env python3
"""Explicit staging/production TLS acceptance against only owned TURN endpoints.

Reuses transient five-minute smoke credentials from the target; the static secret
never leaves that host and no credential is printed or written to a report.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import ssl
import time

spec=importlib.util.spec_from_file_location('turn_live',Path(__file__).with_name('turn-relay-live.py'))
turn=importlib.util.module_from_spec(spec);spec.loader.exec_module(turn)

class TlsTurn(turn.Turn):
    def __init__(self,environment,credentials):
        self.environment=environment;self.port=turn.SITES[environment][0];self.tcp=True;self.connected=True;self.allocated=False;self.allocation_pending=False;self.closed=False
        self.credentials=credentials;self.key=None;self.auth=[]
        context=ssl.create_default_context();context.minimum_version=ssl.TLSVersion.TLSv1_2
        host='staging.dartflow.nl' if environment=='staging' else 'dartflow.nl'
        raw=socket.create_connection((host,self.port),timeout=8)
        try:self.sock=context.wrap_socket(raw,server_hostname=host)
        except BaseException:raw.close();raise
        self.sock.settimeout(8)
        self.proof={'tlsVersion':self.sock.version(),'cipher':self.sock.cipher()[0],'certificateSha256':hashlib.sha256(self.sock.getpeercert(binary_form=True)).hexdigest(),'hostnameVerified':True,'trustedChain':True}

def plaintext_rejected(environment):
    host='staging.dartflow.nl' if environment=='staging' else 'dartflow.nl';port=turn.SITES[environment][0]
    with socket.create_connection((host,port),timeout=5) as client:
        client.settimeout(3);request,_=turn.packet(0x0003,[(0x0019,b'\x11\0\0\0')]);client.sendall(request)
        try:response=client.recv(20)
        except ConnectionResetError:return True
        except socket.timeout:return True # TLS listener may await its handshake timeout; no plaintext STUN response is allowed.
        if response:raise RuntimeError('Plain TCP unexpectedly received a protocol response')
        return True

def check(environment):
    secure=None;legacy=None
    try:
        secure=TlsTurn(environment,turn.credential(environment));secure.allocate()
        legacy=turn.Turn(environment,turn.credential(environment),connected=False);legacy.allocate()
        secure.relay_test(legacy.sock,legacy.mapped)
        private_denied=True
        for peer in [('127.0.0.1',9),('10.0.0.1',9),('100.79.0.26',9)]:secure.permissions(peer,False)
        tls_release=secure.release();udp_release=legacy.release()
        proof={**secure.proof,'environment':environment,'port':turn.SITES[environment][0],'tlsAuthenticatedAllocation':True,'tlsOwnedPeerRoundTrip':True,'legacyUdpAuthenticatedAllocation':True,'privatePeersDenied':private_denied,'tlsAllocationReleased':tls_release,'udpAllocationReleased':udp_release,'plaintextTcpRejected':plaintext_rejected(environment),'plaintextProbe':'no STUN response within three seconds or immediate connection close','testedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
        return proof
    finally:
        for client in [secure,legacy]:
            if client:
                try:client.release()
                finally:client.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run-target',action='store_true',required=True);parser.add_argument('environment',choices=turn.SITES);args=parser.parse_args()
    try:print(json.dumps({'status':'passed',**check(args.environment)}))
    except Exception:print(json.dumps({'status':'failed','environment':args.environment,'message':'Owned TURN TLS acceptance failed; no credentials logged.'}));raise SystemExit(1)
