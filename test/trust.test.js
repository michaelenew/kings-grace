import test from 'node:test';
import assert from 'node:assert/strict';

import { ORDER } from '../src/engine/constants.js';
import {
  TRUST_MAX, adjustTrust, decayTrust, makePromise, recentPartners,
  settleDeeds, settlePromises, trustOf,
} from '../src/engine/trust.js';
import { viewFor } from '../src/engine/state.js';
import { fillOrders, makeGame } from './_helpers.js';

test('a stranger is neither trusted nor distrusted, and you always trust yourself', () => {
  const g = makeGame();
  assert.equal(trustOf(g.state, 'p0', 'p1'), 0);
  assert.equal(trustOf(g.state, 'p0', 'p0'), TRUST_MAX);
});

test('trust is directional and bounded', () => {
  const g = makeGame();
  adjustTrust(g.state, 'p0', 'p1', 2);
  assert.equal(trustOf(g.state, 'p0', 'p1'), 2);
  assert.equal(trustOf(g.state, 'p1', 'p0'), 0, 'they have no reason to like you back');
  adjustTrust(g.state, 'p0', 'p1', 5);
  assert.equal(trustOf(g.state, 'p0', 'p1'), TRUST_MAX, 'clamped');
  adjustTrust(g.state, 'p0', 'p1', -99);
  assert.equal(trustOf(g.state, 'p0', 'p1'), -3, 'and clamped the other way');
});

test('keeping your word pays a little; breaking it costs the whole court', async () => {
  const kept = makeGame();
  kept.state.round = 1;
  makePromise(kept.state, 'p0', { to: 'p1', kind: 'standDown' });
  kept.commit('p0', { order: ORDER.DEVELOP });
  settlePromises(kept.state);
  assert.equal(trustOf(kept.state, 'p1', 'p0'), 1);
  assert.equal(trustOf(kept.state, 'p2', 'p0'), 0.25, 'the table noticed that too');

  const broken = makeGame();
  broken.state.round = 1;
  makePromise(broken.state, 'p0', { to: 'p1', kind: 'standDown' });
  broken.commit('p0', { order: ORDER.ATTACK, target: 'p1', gold: 2 });
  settlePromises(broken.state);
  assert.equal(trustOf(broken.state, 'p1', 'p0'), -2);
  assert.equal(trustOf(broken.state, 'p2', 'p0'), -1, 'a betrayal in open court is not private');
});

test('a promise is scored once, and restating it does not stack', () => {
  const g = makeGame();
  g.state.round = 1;
  makePromise(g.state, 'p0', { to: 'p1', kind: 'standDown' });
  makePromise(g.state, 'p0', { to: 'p1', kind: 'supportDefense' });
  assert.equal(g.state.promises.length, 1, 'saying it twice is still saying it once');
  assert.equal(g.state.promises[0].kind, 'supportDefense', 'the latest word is the word');
  g.commit('p0', { order: ORDER.SUPPORT, target: 'p1', gold: 1 });
  settlePromises(g.state);
  settlePromises(g.state); // idempotent
  assert.equal(trustOf(g.state, 'p1', 'p0'), 1);
});

test('striking a house you just bargained with costs you, promise or no promise', () => {
  const g = makeGame();
  g.state.round = 2;
  g.state.deals.push({ round: 2, offers: { p0: { gold: 3 } }, takes: { p1: { gold: 3 } } });
  assert.deepEqual([...recentPartners(g.state, 'p0')], ['p1']);
  g.commit('p0', { order: ORDER.ATTACK, target: 'p1', gold: 2 });
  settleDeeds(g.state);
  assert.equal(trustOf(g.state, 'p1', 'p0'), -2);
  assert.equal(trustOf(g.state, 'p2', 'p0'), -0.5);
});

test('holding somebody else’s wall is the cheapest way to be believed', () => {
  const g = makeGame();
  fillOrders(g, {
    p0: { order: ORDER.SUPPORT, target: 'p1', gold: 2 },
    p1: { order: ORDER.DEVELOP },
    p2: { order: ORDER.SUPPORT, target: 'p3', gold: 2 },
    p3: { order: ORDER.ATTACK, target: 'p0', gold: 2 },
  });
  settleDeeds(g.state);
  assert.equal(trustOf(g.state, 'p1', 'p0'), 0.75, 'p0 held their wall');
  assert.equal(trustOf(g.state, 'p3', 'p2'), 0, 'p2 rode with the army instead');
});

test('grudges fade toward indifference but do not vanish in a round', () => {
  const g = makeGame();
  adjustTrust(g.state, 'p0', 'p1', -2);
  decayTrust(g.state);
  const after = trustOf(g.state, 'p0', 'p1');
  assert.ok(after > -2 && after < -1.8, `decayed to ${after}`);
  for (let i = 0; i < 40; i++) decayTrust(g.state);
  assert.equal(trustOf(g.state, 'p0', 'p1'), 0, 'the court forgets eventually');
});

test('the ledger and the promises are public, but a bargain’s contents are not', () => {
  const g = makeGame();
  g.state.round = 1;
  adjustTrust(g.state, 'p1', 'p0', -2);
  makePromise(g.state, 'p0', { to: 'p1', kind: 'standDown' });
  g.state.deals.push({ round: 1, offers: { p0: { gold: 5 } }, takes: { p1: { gold: 5 } } });

  const outsider = viewFor(g.state, 'p2');
  assert.equal(outsider.trust['p1>p0'], -2, 'everyone can see what the court thinks');
  assert.equal(outsider.promises.length, 1, 'and what was said out loud');
  assert.deepEqual(Object.keys(outsider.deals[0].offers).sort(), ['p0', 'p1'], 'and who dealt with whom');
  assert.deepEqual(outsider.deals[0].offers.p0, {}, 'but not what changed hands');

  const insider = viewFor(g.state, 'p0');
  assert.equal(insider.deals[0].offers.p0.gold, 5, 'their own bargain is theirs to see');
});

test('a promise cannot be given to yourself, or after the orders resolve', () => {
  const g = makeGame();
  g.state.round = 1;
  g.setPhase('commit');
  assert.equal(g.declarePromise('p0', { to: 'p0', kind: 'standDown' }).ok, false);
  assert.equal(g.declarePromise('p0', { to: 'p1', kind: 'nonsense' }).ok, false);
  assert.equal(g.declarePromise('p0', { to: 'p1', kind: 'standDown' }).ok, true);
  g.setPhase('resolve');
  assert.equal(g.declarePromise('p0', { to: 'p2', kind: 'standDown' }).ok, false);
});
