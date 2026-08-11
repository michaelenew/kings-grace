// Balance tests. These are not rules checks — engine.test.js does that. These
// assert that the *tuned* preset still produces a game worth playing, measured
// the same way it was tuned: bot tournaments where each seat is a committed
// strategy rather than a personality flavour.
//
// If you retune, expect to move these numbers. They are deliberately loose
// enough to absorb sampling noise and tight enough to catch a regression that
// would kill a strategy or a road to the throne.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS } from '../src/engine/tuning.js';
import { tournament } from '../tools/tournament.js';

const GAMES = 400; // ~1.5s; enough to hold the assertions below well clear
const tuned = () => tournament(PRESETS.tuned.tuning, { n: GAMES });

test('both roads to the throne stay live', async () => {
  const { summary } = await tuned();
  assert.ok(summary.usurp > 25, `usurpation should be common, saw ${summary.usurp.toFixed(0)}%`);
  assert.ok(summary.inherit > 25, `inheritance should be common, saw ${summary.inherit.toFixed(0)}%`);
});

test('the game uses most of its crown deck', async () => {
  const { summary } = await tuned();
  assert.ok(summary.meanRound > 10, `mean ending round ${summary.meanRound.toFixed(1)}, wanted past 10 of 12`);
  assert.ok(summary.meanRound <= 12, `mean ending round ${summary.meanRound.toFixed(1)} exceeds the deck`);
});

test('every strategy can win, and none runs away with it', async () => {
  const { summary } = await tuned();
  for (const d of summary.doctrineRates) {
    assert.ok(d.rate >= 12, `${d.name} wins only ${d.rate.toFixed(0)}% — that lane is dead`);
    assert.ok(d.rate <= 40, `${d.name} wins ${d.rate.toFixed(0)}% — that lane dominates`);
  }
  assert.ok(summary.doctrineSpread <= 24, `spread ${summary.doctrineSpread.toFixed(0)}pt between best and worst doctrine`);
});

test('no seat has an edge', async () => {
  const { summary } = await tuned();
  for (const [seat, rate] of summary.seatRates.entries()) {
    assert.ok(Math.abs(rate - 25) < 6, `seat ${seat} wins ${rate.toFixed(0)}% (expected about 25%)`);
  }
});

test('a usurpation is a real gamble, taken and lost often enough to matter', async () => {
  const { summary } = await tuned();
  assert.ok(summary.coupAttemptsPerGame > 0.8, `only ${summary.coupAttemptsPerGame.toFixed(2)} coup attempts per game`);
  assert.ok(summary.coupSuccess > 15, `coups succeed only ${summary.coupSuccess.toFixed(0)}% of the time`);
  assert.ok(summary.coupSuccess < 70, `coups succeed ${summary.coupSuccess.toFixed(0)}% of the time — too safe`);
});

test('swords come out, and no single order is the whole game', async () => {
  const { summary } = await tuned();
  assert.ok(summary.battlesPerGame > 5, `only ${summary.battlesPerGame.toFixed(1)} battles per game`);
  for (const [order, share] of Object.entries(summary.orderMix)) {
    if (order === 'attackCrown' || order === 'ransom' || order === 'hold' || order === 'support') continue;
    assert.ok(share < 45, `${order} is ${share.toFixed(0)}% of all orders`);
  }
});

test('the tuned preset beats the rules as written on every headline number', async () => {
  const [{ summary: raw }, { summary: fixed }] = await Promise.all([
    tournament(PRESETS['v0.1'].tuning, { n: GAMES }),
    tuned(),
  ]);
  assert.ok(raw.usurp > 75, `v0.1 should still be coup-dominated, saw ${raw.usurp.toFixed(0)}%`);
  assert.ok(fixed.meanRound > raw.meanRound + 1.5, 'the tuned game should last meaningfully longer');
  assert.ok(fixed.battlesPerGame > raw.battlesPerGame, 'the tuned game should have more fighting');
  assert.ok(
    Math.abs(fixed.usurp - 50) < Math.abs(raw.usurp - 50),
    'the tuned game should be closer to an even split between the two roads',
  );
});
