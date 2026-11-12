import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardActivityClock} from '../lib/board-activity-types';

const activityAt = Date.UTC(2026, 10, 12, 18, 0, 0);

test('board activity remains active until the exact 120-second warning boundary', () => {
  for (const elapsed of [0, 1, 119000, 119999]) {
    const clock = boardActivityClock(activityAt, activityAt + elapsed);
    assert.equal(clock.phase, 'active');
    assert.equal(clock.warningAt, activityAt + 120000);
    assert.equal(clock.deadlineAt, activityAt + 180000);
    assert.equal(clock.remainingSeconds, Math.ceil((180000 - elapsed) / 1000));
  }
});

test('board warning includes the first warning millisecond and the last pre-deadline millisecond', () => {
  for (const [elapsed, remaining] of [[120000, 60], [120001, 60], [179000, 1], [179999, 1]]) {
    const clock = boardActivityClock(activityAt, activityAt + elapsed);
    assert.equal(clock.phase, 'warning');
    assert.equal(clock.remainingSeconds, remaining);
    assert.equal(clock.warningAt, activityAt + 120000);
    assert.equal(clock.deadlineAt, activityAt + 180000);
  }
});

test('board expiration takes precedence at exactly 180 seconds and never yields a negative countdown', () => {
  for (const elapsed of [180000, 180001, 240000, 86400000]) {
    const clock = boardActivityClock(activityAt, activityAt + elapsed);
    assert.equal(clock.phase, 'expired');
    assert.equal(clock.remainingSeconds, 0);
    assert.equal(clock.deadlineAt, activityAt + 180000);
  }
});

test('late polling, reconnect and a delayed worker preserve the original absolute inactivity deadline', () => {
  const readings = [119999, 120000, 179999, 180000, 300000].map(elapsed => boardActivityClock(activityAt, activityAt + elapsed));
  assert.deepEqual(readings.map(clock => clock.phase), ['active', 'warning', 'warning', 'expired', 'expired']);
  assert.deepEqual(readings.map(clock => clock.warningAt), Array(5).fill(activityAt + 120000));
  assert.deepEqual(readings.map(clock => clock.deadlineAt), Array(5).fill(activityAt + 180000));
  const reconnected = boardActivityClock(activityAt, activityAt + 300000);
  assert.equal(reconnected.remainingSeconds, 0);
  assert.notEqual(reconnected.deadlineAt, activityAt + 300000 + 180000);
});

test('an accepted extension starts a new 120-plus-60-second window from the server acceptance time', () => {
  const acceptedAt = activityAt + 145123;
  assert.equal(boardActivityClock(activityAt, acceptedAt).phase, 'warning');
  const renewed = boardActivityClock(acceptedAt, acceptedAt);
  assert.equal(renewed.phase, 'active');
  assert.equal(renewed.warningAt, acceptedAt + 120000);
  assert.equal(renewed.deadlineAt, acceptedAt + 180000);
  assert.equal(renewed.remainingSeconds, 180);
  assert.equal(boardActivityClock(acceptedAt, acceptedAt + 119999).phase, 'active');
  assert.equal(boardActivityClock(acceptedAt, acceptedAt + 120000).phase, 'warning');
  assert.equal(boardActivityClock(acceptedAt, acceptedAt + 180000).phase, 'expired');
});

test('only the canonical activity timestamp changes the clock origin; repeated observations are pure', () => {
  const before = boardActivityClock(activityAt, activityAt + 130000);
  for (let count = 0; count < 10; count++) assert.deepEqual(boardActivityClock(activityAt, activityAt + 130000), before);
  const nextAcceptedScoreAt = activityAt + 130100;
  const next = boardActivityClock(nextAcceptedScoreAt, nextAcceptedScoreAt);
  assert.equal(next.phase, 'active');
  assert.equal(next.deadlineAt, nextAcceptedScoreAt + 180000);
  assert.equal(boardActivityClock(activityAt, nextAcceptedScoreAt).phase, 'warning');
});
