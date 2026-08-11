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

// KNOWN GAP — these bounds are far looser than they should be, and they are
// loose on purpose rather than by accident.
//
// The climbing lane currently takes about half of all four-player games, and it
// takes them *by force*: roughly fifteen coups for every inheritance. Climbing
// is simply the road to Marshal and Herald, and those two decide fights. Combat
// resolves on very small integers, so "+1 attack" and "win every tie" are worth
// more than everything else on offer. No constant fixes that — see the note in
// RULES.md — and the heuristic bots cannot be the instrument for fixing it
// either, because this game is decided at the deal table and a scoring function
// cannot bargain. tools/agent-harness.js exists for that next pass.
//
// So: this asserts only that no lane is completely dead and none is a lock.
// Tighten it when the titles are reworked.
test('no strategy is dead and none is a lock', async () => {
  const { summary } = await at(4);
  for (const d of summary.doctrineRates) {
    assert.ok(d.rate >= 4, `${d.name} wins only ${d.rate.toFixed(0)}% — that lane is dead`);
    assert.ok(d.rate <= 65, `${d.name} wins ${d.rate.toFixed(0)}% — that lane is a lock`);
  }
});

// KNOWN GAP, and the most important open problem in the game. Marshal and
// Herald are worth well over twice the baseline while Chancellor and Spymaster
// are worth about half. The grant at +2 is not a choice, it is a formality.
// This guard only catches a *further* slide; the real fix is new title text.
test('the combat titles have not run further away', async () => {
  const { summary } = await at(4);
  for (const t of summary.titleRates) {
    assert.ok(t.edge < 3.2, `${t.name} holders win ${t.edge.toFixed(2)}x the baseline`);
    assert.ok(t.edge > 0.25, `${t.name} is worthless at ${t.edge.toFixed(2)}x`);
  }
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
  for (const players of [3, 4, 6]) {
    const { summary } = await at(players);
    assert.ok(
      summary.starvedChoices < 16,
      `at ${players} players, ${summary.starvedChoices.toFixed(0)}% of turns offer only attack or support`,
    );
  }
});

test('every table size from three to six plays a whole game', async () => {
  for (let players = PLAYER_MIN; players <= PLAYER_MAX; players++) {
    const { summary } = await at(players);
    assert.equal(summary.games, GAMES);
    assert.ok(summary.meanRound > 8, `at ${players} players the game ends at round ${summary.meanRound.toFixed(1)}`);
    assert.ok(summary.usurp > 10, `at ${players} players usurpation is ${summary.usurp.toFixed(0)}% — that road is shut`);
    // Inheritance is thin at small tables and healthy at large ones; the
    // gradient is real, the floor is a regression guard.
    assert.ok(summary.inherit > 3, `at ${players} players inheritance is ${summary.inherit.toFixed(0)}% — that road is shut`);
    assert.ok(summary.battlesPerGame > 3, `at ${players} players only ${summary.battlesPerGame.toFixed(1)} battles per game`);
  }
});

// The crown does not get *weaker* as the table grows — that was tried and it is
// wrong. It is flat by default: a bigger table already supplies more houses who
// might rally to the throne, so adding strength on top of that shut the coup
// down entirely at five and six players. The per-player term is still a knob.
test('the crown never weakens as the table grows', async () => {
  const strengths = [];
  for (const players of [3, 4, 5, 6]) {
    const { tuning } = await tournament({}, { n: 1, players });
    strengths.push(tuning.crownBase + tuning.crownPerPlayer * players);
  }
  for (let i = 1; i < strengths.length; i++) {
    assert.ok(strengths[i] >= strengths[i - 1], `crown offsets ${strengths}`);
  }
});
