import assert from 'node:assert/strict';
import test from 'node:test';
import {androidAppLinks} from '../lib/android-app-links';
import {safeNext} from '../lib/config';
import {analyticsAllowedOnPath} from '../lib/analytics-consent';

test('an unregistered Play app has no invented signing association',()=>{
  const empty={production:{packageName:'nl.dartflow.ochelive',sha256CertFingerprints:[]},staging:{packageName:'nl.dartflow.ochelive.staging',sha256CertFingerprints:[]}};
  assert.deepEqual(androidAppLinks('production',empty),[]);
  assert.deepEqual(androidAppLinks('staging',empty),[]);
  assert.deepEqual(androidAppLinks('development'),[]);
  const fingerprint=Array(32).fill('A1').join(':');
  const configured={...empty,production:{...empty.production,sha256CertFingerprints:[fingerprint,fingerprint]}};
  assert.equal(androidAppLinks('production',configured)[0].target.sha256_cert_fingerprints.length,1);
  assert.deepEqual(androidAppLinks('staging',configured),[]);
  assert.throws(()=>androidAppLinks('production',{...empty,production:{...empty.production,sha256CertFingerprints:['VUL-IN']}}));
});
test('pairing resumes only through an allowlisted account route, without codes in the return URL',()=>{
  assert.equal(safeNext('/koppel-scherm'),'/koppel-scherm');
  assert.equal(safeNext('/app/schermen'),'/app/schermen');
  assert.equal(safeNext('/koppel-scherm?code=K8G4P7RW'),'/');
  assert.equal(safeNext('/koppel-scherm#code=K8G4P7RW'),'/');
  assert.equal(analyticsAllowedOnPath('/koppel-scherm'),false);
  assert.equal(analyticsAllowedOnPath('/oche-live'),false);
  assert.equal(analyticsAllowedOnPath('/app/schermen'),false);
});
test('the actual signed player APK verifies only its own production or staging package',()=>{
  const production=androidAppLinks('production').find(entry=>entry.target.package_name==='nl.dartflow.app');
  const staging=androidAppLinks('staging').find(entry=>entry.target.package_name==='nl.dartflow.app.staging');
  assert.ok(production);assert.ok(staging);
  assert.ok(!androidAppLinks('production').some(entry=>entry.target.package_name.endsWith('.staging')));
  assert.equal(production.target.sha256_cert_fingerprints[0],'97:C8:A2:78:FF:67:14:BD:E4:F1:BC:B5:4E:BA:15:12:28:D4:2E:83:8F:11:D4:3B:CF:6E:71:C7:DE:08:A0:09');
});
