import {test}from'node:test';
import assert from'node:assert/strict';
import {readFileSync}from'node:fs';
import {buildPlayRuleVectors}from'./helpers/play-rule-vectors';
test('native shared vectors retain every accepted rule transition and canonical outcome',()=>{const saved=JSON.parse(readFileSync(new URL('./fixtures/play-rules.json',import.meta.url),'utf8'));assert.deepEqual(saved,buildPlayRuleVectors());assert.equal(saved.cases.length,8);});
