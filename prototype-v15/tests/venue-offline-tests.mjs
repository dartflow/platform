import assert from 'node:assert/strict';
import {createVenueDemo} from '../public/venue-engine.js';
import {createVenueOffline} from '../public/venue-offline.js';

class MemoryStorage {
  #items = new Map();
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, value); }
  removeItem(key) { this.#items.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
const appKey = 'puinruimers-demo-v3';
const outboxKey = 'dartflow-venue-score-outbox-v1';

const db = {version: 3, venue: createVenueDemo()};
const board = db.venue.boards.find(item => item.matchId);
const officialMatch = () => db.venue.matches.find(item => item.id === board.matchId);
const messages = [];
const ctx = {
  db, routeParam: () => `board-${board.id}`,
  toast: text => messages.push(text), render: () => {},
  showModal: () => {}, closeModal: () => {}, esc: String, button: () => ''
};
const save = () => localStorage.setItem(appKey, JSON.stringify(db));
save();

const offline = createVenueOffline(ctx);
assert.equal(offline.setOffline(true), true);
const action = {matchId: board.matchId, score: 40, darts: 1};
assert.equal(offline.dispatch('score', action).needsDouble, true);
assert.equal(offline.info(), 0);
assert.equal(offline.dispatch('score', {...action, doubleConfirmed: true}).error, undefined);
assert.equal(offline.info(), 1);
assert.equal(officialMatch().game.remaining[0], 40);
assert.deepEqual(offline.game(officialMatch()).legs, [3, 1]);
assert.ok(offline.dispatch('finalize', {matchId: board.matchId, score: [3,1]}).error);

const savedBuffer = sessionStorage.getItem(outboxKey);
assert.equal(offline.setOffline(false), true);
assert.equal(offline.offline(), false);
assert.deepEqual(officialMatch().game.legs, [3, 1]);
const delivered = db.venue.log.length;

// Replaying an outbox after the tab closes between saving and clearing it is a no-op.
sessionStorage.setItem(outboxKey, savedBuffer);
const reopened = createVenueOffline(ctx);
assert.equal(reopened.setOffline(false), true);
assert.equal(db.venue.log.length, delivered);
assert.deepEqual(officialMatch().game.legs, [3, 1]);

// Keep the writer's buffer if someone corrected the same game while disconnected.
db.venue = createVenueDemo();
save();
const conflicted = createVenueOffline(ctx);
assert.equal(conflicted.setOffline(true), true);
conflicted.dispatch('score', {...action, doubleConfirmed: true});
const otherWriter = JSON.parse(localStorage.getItem(appKey));
otherWriter.venue.matches.find(item => item.id === board.matchId).game.remaining[0] = 32;
localStorage.setItem(appKey, JSON.stringify(otherWriter));
assert.equal(conflicted.setOffline(false), false);
assert.equal(conflicted.info(), 1);
assert.match(messages.at(-1), /gewijzigd/);
assert.equal(JSON.parse(localStorage.getItem(appKey)).venue.matches.find(item => item.id === board.matchId).game.remaining[0], 32);
