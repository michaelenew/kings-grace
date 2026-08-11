import test from 'node:test';
import assert from 'node:assert/strict';

import { CROWN, ORDER } from '../src/engine/constants.js';
import { MIX_TARGET, blankTally, summariseEnjoyment, verbOf } from '../tools/enjoyment.js';

test('support is attacking or conniving depending on where the gold ended up', () => {
  const commitments = {
    p0: { order: ORDER.SUPPORT, target: 'p1' },
    p1: { order: ORDER.ATTACK, target: 'p2' },
    p2: { order: ORDER.SUPPORT, target: 'p3' },
    p3: { order: ORDER.DEVELOP },
    p4: { order: ORDER.SUPPORT, target: CROWN },
  };
  assert.equal(verbOf(commitments.p0, commitments), 'attack', 'rode with the army');
  assert.equal(verbOf(commitments.p2, commitments), 'connive', 'held a wall');
  assert.equal(verbOf(commitments.p4, commitments), 'connive', 'shielding the throne is politics');
});

test('the three verbs cover every order', () => {
  const seen = new Set();
  for (const order of [ORDER.ATTACK, ORDER.SUPPORT, ORDER.PETITION, ORDER.DEVELOP, ORDER.RANSOM]) {
    seen.add(verbOf({ order, target: 'p1' }, { p1: { order: ORDER.DEVELOP } }));
  }
  assert.deepEqual([...seen].sort(), ['attack', 'build', 'connive']);
  assert.equal(verbOf(null, {}), 'idle');
  assert.equal(verbOf({ order: ORDER.HOLD }, {}), 'idle');
});

/** `n` winners with the given split, as the tally records them. */
function winners(n, mix, how = 'inherit') {
  return Array.from({ length: n }, () => ({ ...mix, how }));
}

test('the main line is a good split, and a few winners still skip a lane', () => {
  const tally = blankTally();
  tally.games = 1;
  tally.winnerTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  tally.allTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  // 85 balanced winners and 15 who never fought: many paths, one main road.
  tally.winnerMixes = [
    ...winners(85, { build: 0.4, attack: 0.4, connive: 0.2 }),
    ...winners(15, { build: 0.55, attack: 0.0, connive: 0.45 }),
  ];
  tally.optionTurns = 100;
  tally.optionShare = 100;
  const s = summariseEnjoyment(tally);
  assert.equal(s.score, 100);
  assert.deepEqual(s.notes, []);
  assert.equal(s.winnerMix.build, MIX_TARGET.build);
});

test('a game with only one viable line loses the alternative-roads points', () => {
  const tally = blankTally();
  tally.games = 1;
  tally.winnerTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  tally.allTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  tally.winnerMixes = winners(100, { build: 0.4, attack: 0.4, connive: 0.2 });
  tally.optionTurns = 100;
  tally.optionShare = 100;
  const s = summariseEnjoyment(tally);
  assert.equal(s.mainLine, 18, 'the split itself is perfect');
  assert.equal(s.openRoads, 0, 'but nothing else ever wins');
  assert.ok(s.notes.some((n) => /one line and no strategy/.test(n)));
});

test('a game where skipping a lane IS the line loses the main-line points', () => {
  const tally = blankTally();
  tally.games = 1;
  tally.winnerTurns = { build: 50, attack: 0, connive: 50, idle: 0 };
  tally.allTurns = { build: 50, attack: 0, connive: 50, idle: 0 };
  tally.winnerMixes = winners(100, { build: 0.5, attack: 0.0, connive: 0.5 });
  tally.optionTurns = 100;
  tally.optionShare = 100;
  const s = summariseEnjoyment(tally);
  assert.equal(s.mainLine, 0);
  assert.equal(s.openRoads, 0, 'everybody deviating is not a deviation');
  assert.ok(s.notes.some((n) => /skip a lane outright, usually attack/.test(n)));
  assert.ok(s.notes.some((n) => /attack under/.test(n)));
});

test('the two roads to the throne are reported separately', () => {
  const tally = blankTally();
  tally.games = 1;
  tally.winnerTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  tally.allTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  tally.winnerMixes = [
    ...winners(50, { build: 0.4, attack: 0.5, connive: 0.1 }, 'usurp'),
    ...winners(50, { build: 0.4, attack: 0.1, connive: 0.5 }, 'inherit'),
  ];
  tally.optionTurns = 100;
  tally.optionShare = 100;
  const s = summariseEnjoyment(tally);
  assert.equal(s.byRoad.usurp.share, 0.5);
  assert.ok(s.byRoad.usurp.mix.attack > s.byRoad.inherit.mix.attack);
  assert.ok(s.byRoad.inherit.mix.connive > s.byRoad.usurp.mix.connive);
  assert.equal(s.byRoad.usurp.usedAll, 0, 'neither road needed all three');
});

test('being priced out of half the board costs the whole options score', () => {
  const tally = blankTally();
  tally.games = 1;
  tally.winnerTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  tally.allTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  tally.winnerMixes = [
    ...winners(85, { build: 0.4, attack: 0.4, connive: 0.2 }),
    ...winners(15, { build: 0.55, attack: 0.0, connive: 0.45 }),
  ];
  tally.optionTurns = 100;
  tally.optionShare = 50; // half the orders affordable, on average
  tally.pinchedTurns = 60;
  const s = summariseEnjoyment(tally);
  assert.equal(s.optionScore, 0);
  assert.equal(s.score, 75);
  assert.ok(s.notes.some((n) => /affordable/.test(n)));
});
