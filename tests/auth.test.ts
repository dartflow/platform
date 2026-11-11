import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appConfig,safeNext} from '../lib/config';

test('login intent only accepts explicit internal routes and immutable match identity',()=>{
  for(const input of ['https://evil.example','//evil.example','/\\evil','/%2f%2fevil','/wedstrijd/x','/spelen?next=evil','/\nspelen','/scherm/secret']) assert.equal(safeNext(input),'/');
  assert.equal(safeNext('/wedstrijd/30000000-0000-4000-8000-000000000001'),'/wedstrijd/30000000-0000-4000-8000-000000000001');
  assert.equal(safeNext('/baan/B1'),'/baan/B1');
  assert.equal(safeNext('/app/platform/integraties'),'/app/platform/integraties');
  const invitation='/app/lobby/30000000-0000-4000-8000-000000000001?code=abcdefghijklmnopqrstuvwx';
  assert.equal(safeNext(invitation),invitation);
  const studio='/app/venue-cast/studio?event=30000000-0000-4000-8000-000000000001';
  assert.equal(safeNext(studio),studio);
  assert.equal(safeNext(studio+'&next=https://evil.example'),'/');
  assert.equal(safeNext(studio.replace('event=','next=')),'/');
  for(const invalid of [invitation+'&next=https://evil.example',invitation+'?x=y',invitation.replace('code=','other='),'/app/lobby/x?code=abcdefghijklmnopqrstuvwx'])assert.equal(safeNext(invalid),'/');
});
test('public origin rejects local identities and staging requires HTTPS',()=>{
  const oldMode=process.env.DARTFLOW_DATA_MODE,oldOrigin=process.env.DARTFLOW_APP_ORIGIN;
  try {
    process.env.DARTFLOW_DATA_MODE='local'; process.env.DARTFLOW_APP_ORIGIN='https://staging.dartflow.nl'; assert.throws(appConfig);
    process.env.DARTFLOW_DATA_MODE='supabase'; process.env.DARTFLOW_APP_ORIGIN='http://staging.dartflow.nl'; assert.throws(appConfig);
    process.env.DARTFLOW_APP_ORIGIN='https://staging.dartflow.nl'; assert.equal(appConfig().origin,'https://staging.dartflow.nl');
  } finally {
    if(oldMode===undefined) delete process.env.DARTFLOW_DATA_MODE; else process.env.DARTFLOW_DATA_MODE=oldMode;
    if(oldOrigin===undefined) delete process.env.DARTFLOW_APP_ORIGIN; else process.env.DARTFLOW_APP_ORIGIN=oldOrigin;
  }
});
