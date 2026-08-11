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

test('a winner who hits the target mix and uses every lane scores well', () => {
  const tally = blankTally();
  tally.games = 1;
  // 40 / 40 / 20, every lane genuinely used.
  tally.winnerTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  tally.allTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  tally.thinnestLane = [0.2];
  tally.optionTurns = 100;
  tally.optionShare = 100; // the whole board affordable every turn
  const s = summariseEnjoyment(tally);
  assert.equal(s.score, 100);
  assert.deepEqual(s.notes, []);
  assert.equal(s.winnerMix.build, MIX_TARGET.build);
});

test('a winner who never had to fight loses the breadth points and is told why', () => {
  const tally = blankTally();
  tally.games = 1;
  tally.winnerTurns = { build: 50, attack: 0, connive: 50, idle: 0 };
  tally.allTurns = { build: 50, attack: 0, connive: 50, idle: 0 };
  tally.thinnestLane = [0];
  tally.optionTurns = 100;
  tally.optionShare = 100;
  const s = summariseEnjoyment(tally);
  assert.equal(s.breadthScore, 0);
  assert.ok(s.score < 60);
  assert.ok(s.notes.some((n) => /skip a lane/.test(n)));
  assert.ok(s.notes.some((n) => /attack under/.test(n)));
});

test('being priced out of half the board costs the whole options score', () => {
  const tally = blankTally();
  tally.games = 1;
  tally.winnerTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  tally.allTurns = { build: 40, attack: 40, connive: 20, idle: 0 };
  tally.thinnestLane = [0.2];
  tally.optionTurns = 100;
  tally.optionShare = 50; // half the orders affordable, on average
  tally.pinchedTurns = 60;
  const s = summariseEnjoyment(tally);
  assert.equal(s.optionScore, 0);
  assert.equal(s.score, 75);
  assert.ok(s.notes.some((n) => /affordable/.test(n)));
});
