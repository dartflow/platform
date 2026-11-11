import {test} from 'node:test';
import assert from 'node:assert/strict';
import {navigationFor, routeAfterScopeChange, renderShell} from '../public/navigation.js';

test('organizer desktop and mobile expose the same workspaces', () => {
  const {groups, mobile} = navigationFor('dashboard', true);
  assert.deepEqual(mobile, groups.flatMap(([, links]) => links));
  assert.equal(navigationFor('hall', true).parent, 'events');
  assert.equal(navigationFor('hall', true).label, 'Toernooien');
  assert.equal(navigationFor('venue-cast', true).parent, 'operations');
  assert.equal(navigationFor('registrations', true).parent, 'manage');
  assert.equal(navigationFor('mail', true).parent, 'manage');
  assert.equal(navigationFor('mail', true).label, 'Mailbeheer');
  assert.ok(navigationFor('mail', true).tabs.some(([route]) => route === 'mail'));
  assert.ok(!navigationFor('home', false).groups.flatMap(([,links]) => links).some(([route]) => route === 'mail'));
});

test('scope changes preserve the correct role and exit event-specific controls', () => {
  assert.equal(routeAfterScopeChange('dashboard', true), 'dashboard');
  assert.equal(routeAfterScopeChange('venue-cast', true), 'operations');
  assert.equal(routeAfterScopeChange('venue', false), 'events');
  assert.equal(routeAfterScopeChange('mymatches', false), 'mymatches');
  assert.equal(navigationFor('baan', false).mobileActive, 'baan');
});

test('scoped workspaces do not offer a different club’s event as the default', () => {
  const shell = {route:'operations', organizer:true, page:'', esc:String, icon:() => '', avatar:() => '', scopeOptions:''};
  assert.doesNotMatch(renderShell(shell), /data-to="venue-cast\/studio"/);
  assert.match(renderShell({...shell,venueId:7}), /data-event-id="7" data-to="venue-cast\/studio"/);
});
