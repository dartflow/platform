import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ANALYTICS_CONSENT_KEY, analyticsAllowedOnPath, browserBlocksAnalytics, publishAnalyticsConsent, readAnalyticsConsent, saveAnalyticsConsent} from '../lib/analytics-consent';

test('analytics default off; explicit versioned choices expire and malformed or blocked storage never grants consent', () => {
  let value: string | null = null;
  const storage = {getItem: (key: string) => {assert.equal(key, ANALYTICS_CONSENT_KEY); return value;}, setItem: (key: string, next: string) => {assert.equal(key, ANALYTICS_CONSENT_KEY); value = next;}};
  assert.equal(readAnalyticsConsent(storage, 1000), null);
  assert.equal(saveAnalyticsConsent(storage, 'granted', 1000), true);
  assert.equal(readAnalyticsConsent(storage, 1000), 'granted');
  assert.equal(readAnalyticsConsent(storage, 1000 + 180 * 86400000), null);
  assert.equal(readAnalyticsConsent(storage, 999), null);
  saveAnalyticsConsent(storage, 'denied', 1000);
  assert.equal(readAnalyticsConsent(storage, 1001), 'denied');
  for (const invalid of ['true', 'false', 'broken', '{"choice":"granted"}', '{"choice":"granted","at":"1000"}', '{"choice":"other","at":1000}']) {value = invalid; assert.equal(readAnalyticsConsent(storage, 1001), null);}
  assert.equal(readAnalyticsConsent({getItem: () => {throw new Error('blocked');}}), null);
  assert.equal(saveAnalyticsConsent({setItem: () => {throw new Error('blocked');}}, 'denied'), false);
  value = JSON.stringify({choice: 'granted', at: 1000});
  assert.equal(saveAnalyticsConsent({setItem: () => {throw new Error('quota');}, removeItem: key => {assert.equal(key, ANALYTICS_CONSENT_KEY); value = null;}}, 'denied'), false);
  assert.equal(readAnalyticsConsent(storage, 1001), null);
  value = JSON.stringify({choice: 'granted', at: 1000});
  const blockedWrites = {getItem: storage.getItem, setItem: () => {throw new Error('blocked');}, removeItem: () => {throw new Error('blocked');}};
  assert.equal(saveAnalyticsConsent(blockedWrites, 'denied', 1001), false);
  assert.equal(readAnalyticsConsent(blockedWrites, 1002, true), 'denied');
});

test('analytics callback sets the early-load flag before the exact consent and withdrawal events', () => {
  const target = new EventTarget() as EventTarget & {socialheroConsent?: boolean};
  const seen: boolean[] = [];
  target.addEventListener('socialhero:consent', event => {const value = (event as CustomEvent<boolean>).detail; assert.equal(target.socialheroConsent, value); seen.push(value);});
  publishAnalyticsConsent(target, false);
  publishAnalyticsConsent(target, true);
  publishAnalyticsConsent(target, false);
  assert.deepEqual(seen, [false, true, false]);
  assert.equal(target.socialheroConsent, false);
});

test('browser privacy and immersive screen routes retain analytics exclusion', () => {
  assert.equal(browserBlocksAnalytics({}), false);
  assert.equal(browserBlocksAnalytics({doNotTrack: '1'}), true);
  assert.equal(browserBlocksAnalytics({globalPrivacyControl: true}), true);
  for (const path of ['/', '/speler', '/inloggen', '/app', '/app/feed']) assert.equal(analyticsAllowedOnPath(path), true);
  for (const path of ['/oche-live/id/', '/baanscherm/id', '/scorebord', '/wedstrijd/id', '/app/match/id', '/app/training/id']) assert.equal(analyticsAllowedOnPath(path), false);
});
