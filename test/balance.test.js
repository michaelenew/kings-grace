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

// KNOWN GAP. Usurpation was 40% of four-player games on the light tax ladder
// and is ~22% on the heavy one: a coup is bought with gold, and there is much
// less gold. The road is still open, but it has narrowed, and 20% is a floor
// rather than a target. Raising the cost of an appeal pushes it straight back
// past 40% (see the note on the appeal in RULES.md) at the price of dead turns.
test('both roads to the throne stay live at four players', async () => {
  const { summary } = await at(4);
  assert.ok(summary.usurp > 18, `usurpation should be common, saw ${summary.usurp.toFixed(0)}%`);
  assert.ok(summary.inherit > 20, `inheritance should stay reachable, saw ${summary.inherit.toFixed(0)}%`);
});

// The deck is 10 cards. Games run into the back half but now end before the
// last card on purpose: the crown starts lower and decays a full point per
// house, so a breakout can force a coup around round seven or eight rather than
// only on the final flip. The floor is "a real game happened", not "the deck
// ran dry"; the ceiling still guards against a game that never ends.
test('the game uses most of its crown deck', async () => {
  const { summary } = await at(4);
  assert.ok(summary.meanRound > 6.5, `mean ending round ${summary.meanRound.toFixed(1)}, wanted past 6.5 of 10`);
  assert.ok(summary.meanRound <= 10, `mean ending round ${summary.meanRound.toFixed(1)} exceeds the deck`);
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

// This measures a CORRELATION and should be read as one: titles are granted at
// +2 and +3, so the houses holding them are by definition the ones already
// climbing. It cannot separate "the title won the game" from "winning the game
// got you the title". tools/title-value.js runs the causal version — gift one
// title at setup, compare against the identical game without it — and finds a
// much smaller effect: Marshal +11.8 points on a 26.5% baseline, Herald +7.2,
// Warden +6.5, and the rest between 0 and +2.
//
// Kept as a cheap regression guard on the correlational number only.
test('no title correlates with winning to an absurd degree', async () => {
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

// KNOWN GAP. This was 5.9 battles a game before the levy started asking for
// troops instead of coin. Serving takes the attack order off the table for a
// third of the deck, so the floor came down with it — 4.4 at four players. The
// levy is meant to open gates, not close swords, and against these bots it has
// so far done more of the second than the first: see the coronets line in
// tools/simulate.js, where theft in the field is still 0.03 a game.
test('swords come out, and no single order is the whole game', async () => {
  const { summary } = await at(4);
  assert.ok(summary.battlesPerGame > 3.8, `only ${summary.battlesPerGame.toFixed(1)} battles per game`);
  for (const [order, share] of Object.entries(summary.orderMix)) {
    if (['attackCrown', 'ransom', 'hold', 'support'].includes(order)) continue;
    assert.ok(share < 45, `${order} is ${share.toFixed(0)}% of all orders`);
  }
});

// The complaint that started this: being priced out of everything but attack
// and support is a dead turn, not a decision. Measured as "cannot afford an
// appeal or a develop", so a house whose host is away with the levy does not
// count — that is a cost the player chose, not a purse that ran out.
// KNOWN GAP, and a deliberate trade that has now been measured twice. A heavy
// Tax is what makes plunder worth chasing: backing it off to 4/5/6 takes
// starvation to 11% and the enjoyment score from 72 to 65, because houses with
// money in hand go straight back to parking it on Support. Paying failed taxes
// in land costs another 7 points of starvation and buys 3 points of mix.
//
// The real guard is now the options component of the enjoyment score, which
// prices the same thing on a scale rather than a threshold and weighs it
// against everything else a turn could be. This assertion is a floor under the
// unplayable, not the target.
test('players are rarely reduced to attack-or-support', async () => {
  for (const players of [3, 4, 6]) {
    const { summary } = await at(players);
    assert.ok(
      summary.starvedChoices < 28,
      `at ${players} players, ${summary.starvedChoices.toFixed(0)}% of turns cannot afford an appeal or a develop`,
    );
  }
});

// The point of the whole change: a coronet has to be able to change hands.
// Before it, titles moved 0.06 times a game and the first house to the Herald
// kept it for the rest of the game.
test('titles change hands', async () => {
  const { summary } = await at(4);
  const moved = summary.titlesTakenPerGame + summary.titlesClaimedPerGame;
  // Around one a game. The floor dropped from 1 to 0.75 with the shorter game:
  // a coup forced by round seven or eight simply leaves fewer rounds in which a
  // coronet can move, but move it still does.
  assert.ok(moved > 0.75, `only ${moved.toFixed(2)} coronets change hands per game`);
});

test('every table size from three to six plays a whole game', async () => {
  for (let players = PLAYER_MIN; players <= PLAYER_MAX; players++) {
    const { summary } = await at(players);
    assert.equal(summary.games, GAMES);
    // Shorter now on purpose: the coup window opens earlier, and the more houses
    // at the table the faster the throne weakens, so big tables end soonest.
    assert.ok(summary.meanRound > 6, `at ${players} players the game ends at round ${summary.meanRound.toFixed(1)}`);
    assert.ok(summary.usurp > 10, `at ${players} players usurpation is ${summary.usurp.toFixed(0)}% — that road is shut`);
    // Inheritance is thin at small tables and healthy at large ones; the
    // gradient is real, the floor is a regression guard.
    assert.ok(summary.inherit > 3, `at ${players} players inheritance is ${summary.inherit.toFixed(0)}% — that road is shut`);
    assert.ok(summary.battlesPerGame > 3, `at ${players} players only ${summary.battlesPerGame.toFixed(1)} battles per game`);
  }
});

// REVERSED, on evidence. This test used to assert that the crown never weakens
// as the table grows, on the reasoning that a bigger table already supplies more
// houses who might rally to the throne. The first half of that is true and the
// conclusion does not follow: a bigger table raises a bigger *crowd*, not a
// bigger coalition, and the largest-single-contributor rule gets harder to
// satisfy as a conspiracy grows. Measured, coups are tried more often at six
// players and land at 18% against 43% at three.
//
// So the crown now weakens slightly with the table, and what is asserted is the
// thing that actually matters: the same rules should play as the same game at
// every size. Raising it instead shuts usurpation down to 1% at five and six.
test('the same rules play as the same game at every table size', async () => {
  const usurp = [];
  for (const players of [3, 4, 5, 6]) {
    const { summary } = await at(players);
    usurp.push(summary.usurp);
  }
  const spread = Math.max(...usurp) - Math.min(...usurp);
  assert.ok(spread < 25, `usurpation runs ${usurp.map((u) => u.toFixed(0)).join('/')}% across three to six players`);
  for (const u of usurp) {
    assert.ok(u > 15 && u < 80, `usurpation at ${u.toFixed(0)}% shuts one road`);
  }
});
