// Balance tests. Not rules checks — engine.test.js does that. These assert the
// rules in play still produce a game worth playing, measured the way they were
// tuned: bot tournaments where each seat is a committed strategy rather than a
// personality flavour.
//
// If you retune, expect to move these numbers. They are deliberately loose
// enough to absorb sampling noise and tight enough to catch a regression that
// would kill a strategy, a road to the throne, or a table size.

import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAYER_MAX, PLAYER_MIN } from '../src/engine/tuning.js';
import { tournament } from '../tools/tournament.js';

const GAMES = 400; // ~1.5s per table size
const at = (players) => tournament({}, { n: GAMES, players });

test('both roads to the throne stay live at four players', async () => {
  const { summary } = await at(4);
  assert.ok(summary.usurp > 25, `usurpation should be common, saw ${summary.usurp.toFixed(0)}%`);
  assert.ok(summary.inherit > 20, `inheritance should stay reachable, saw ${summary.inherit.toFixed(0)}%`);
});

test('the game uses most of its crown deck', async () => {
  const { summary } = await at(4);
  assert.ok(summary.meanRound > 9.5, `mean ending round ${summary.meanRound.toFixed(1)}, wanted past 9.5 of 12`);
  assert.ok(summary.meanRound <= 12, `mean ending round ${summary.meanRound.toFixed(1)} exceeds the deck`);
});

test('every strategy can win, and none runs away with it', async () => {
  const { summary } = await at(4);
  for (const d of summary.doctrineRates) {
    assert.ok(d.rate >= 14, `${d.name} wins only ${d.rate.toFixed(0)}% — that lane is dead`);
    assert.ok(d.rate <= 38, `${d.name} wins ${d.rate.toFixed(0)}% — that lane dominates`);
  }
});

// The reason the crown's offset is as low as it is. A crown nobody can reach
// makes the first player to +3 unassailable, and the Herald then wins every tie
// forever. Raising the offset to 8 pushed the Herald's holder to 1.76x.
test('no single title decides the game', async () => {
  const { summary } = await at(4);
  for (const t of summary.titleRates) {
    assert.ok(t.edge < 1.6, `${t.name} holders win ${t.edge.toFixed(2)}x the baseline`);
  }
  assert.ok(summary.titleSpread < 0.8, `best-to-worst title spread is ${summary.titleSpread.toFixed(2)}x`);
});

test('no seat has an edge', async () => {
  for (const players of [3, 4, 5]) {
    const { summary } = await at(players);
    const baseline = 100 / players;
    for (const [seat, rate] of summary.seatRates.entries()) {
      assert.ok(
        Math.abs(rate - baseline) < baseline * 0.35,
        `at ${players} players, seat ${seat} wins ${rate.toFixed(0)}% (expected about ${baseline.toFixed(0)}%)`,
      );
    }
  }
});

test('a usurpation is a real gamble, taken and lost often enough to matter', async () => {
  const { summary } = await at(4);
  assert.ok(summary.coupAttemptsPerGame > 0.8, `only ${summary.coupAttemptsPerGame.toFixed(2)} coup attempts per game`);
  assert.ok(summary.coupSuccess > 12, `coups succeed only ${summary.coupSuccess.toFixed(0)}% of the time`);
  assert.ok(summary.coupSuccess < 70, `coups succeed ${summary.coupSuccess.toFixed(0)}% of the time — too safe`);
});

test('swords come out, and no single order is the whole game', async () => {
  const { summary } = await at(4);
  assert.ok(summary.battlesPerGame > 5, `only ${summary.battlesPerGame.toFixed(1)} battles per game`);
  for (const [order, share] of Object.entries(summary.orderMix)) {
    if (['attackCrown', 'ransom', 'hold', 'support'].includes(order)) continue;
    assert.ok(share < 45, `${order} is ${share.toFixed(0)}% of all orders`);
  }
});

// The complaint that started this: being priced out of everything but attack
// and support is a dead turn, not a decision.
test('players are rarely reduced to attack-or-support', async () => {
  for (const players of [2, 4, 6]) {
    const { summary } = await at(players);
    assert.ok(
      summary.starvedChoices < 16,
      `at ${players} players, ${summary.starvedChoices.toFixed(0)}% of turns offer only attack or support`,
    );
  }
});

test('every table size from two to six plays a whole game', async () => {
  for (let players = PLAYER_MIN; players <= PLAYER_MAX; players++) {
    const { summary } = await at(players);
    assert.equal(summary.games, GAMES);
    assert.ok(summary.meanRound > 8, `at ${players} players the game ends at round ${summary.meanRound.toFixed(1)}`);
    assert.ok(summary.usurp > 15, `at ${players} players usurpation is ${summary.usurp.toFixed(0)}% — that road is shut`);
    assert.ok(summary.inherit > 15, `at ${players} players inheritance is ${summary.inherit.toFixed(0)}% — that road is shut`);
    assert.ok(summary.battlesPerGame > 3, `at ${players} players only ${summary.battlesPerGame.toFixed(1)} battles per game`);
  }
});

// The crown stands taller at a small table because there are fewer nobles left
// to rally to it. Without the per-player term two-handed games were 81% coups.
test('the crown scales with the table', async () => {
  const strengths = [];
  for (const players of [2, 4, 6]) {
    const { tuning } = await tournament({}, { n: 1, players });
    strengths.push(tuning.crownBase + tuning.crownPerPlayer * players);
  }
  assert.ok(strengths[0] > strengths[1] && strengths[1] > strengths[2], `crown offsets ${strengths}`);
});
