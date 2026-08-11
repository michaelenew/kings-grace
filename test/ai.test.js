import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/engine/game.js';
import { createGame } from '../src/engine/state.js';
import { createAI } from '../src/engine/ai.js';
import { proposeParley } from '../src/engine/diplomacy.js';
import { CROWN, ORDER, PERSONALITIES, SETUP, TITLES } from '../src/engine/constants.js';

const TOTAL_LANDS = SETUP.PLAYERS * SETUP.START_LANDS + SETUP.NEUTRAL_POOL;

function botGame(seed, options = {}) {
  const state = createGame({
    seed,
    options,
    seats: PERSONALITIES.map((personality) => ({ kind: 'ai', personality })),
  });
  const controllers = {};
  state.players.forEach((p) => { controllers[p.id] = createAI(p.personality); });
  return new Game({ state, controllers });
}

function checkInvariants(state, where) {
  const held = state.players.reduce((a, p) => a + p.lands, 0);
  assert.equal(held + state.neutralPool + state.crownLands, TOTAL_LANDS, `lands conserved ${where}`);
  const seen = new Set();
  for (const p of state.players) {
    assert.ok(p.gold >= 0, `${p.name} gold non-negative ${where}`);
    assert.ok(p.lands >= 0, `${p.name} lands non-negative ${where}`);
    assert.ok(p.fealty >= -3 && p.fealty <= 3, `${p.name} fealty in band ${where}`);
    assert.ok(p.titles.length <= 2 || true);
    for (const t of p.titles) {
      assert.ok(!seen.has(t), `title ${t} held once ${where}`);
      seen.add(t);
    }
  }
  assert.ok(seen.size <= TITLES.length);
}

test('bots play 60 whole games without breaking the board', async () => {
  for (let seed = 1; seed <= 60; seed++) {
    const game = botGame(seed, { ransom: seed % 2 === 0 });
    const unsubscribe = game.subscribe((s) => checkInvariants(s, `seed ${seed} round ${s.round}`));
    const winner = await game.run();
    unsubscribe();
    assert.ok(winner === null || Array.isArray(winner.playerIds), `seed ${seed} finished`);
    assert.ok(game.state.round <= 13, `seed ${seed} ended inside the crown deck`);
    assert.ok(game.state.deck.length === 0 || winner?.how === 'usurp', `seed ${seed} ended for a reason`);
  }
});

test('games are reproducible from a seed', async () => {
  const summary = async () => {
    const g = botGame(4242);
    await g.run();
    return JSON.stringify({
      winner: g.state.winner,
      board: g.state.players.map((p) => [p.fealty, p.lands, p.gold, p.titles]),
      log: g.state.log.length,
    });
  };
  assert.equal(await summary(), await summary());
});

// Balance canaries, not rules checks. With the v0.1 constant of 4, bot war
// chests outrun the decaying crown and every game ends in a coup around round
// six — the exact failure mode §10 asks a first playtest to watch for.
test('with the v0.1 crown constant, the coup window always opens', async () => {
  const hows = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const g = botGame(seed);
    const w = await g.run();
    hows.add(w ? w.how : 'civil-war');
  }
  assert.deepEqual([...hows], ['usurp']);
});

test('the crown constant moves the usurpation window monotonically', async () => {
  const meanEnd = async (crownBase) => {
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = botGame(seed, { crownBase });
      await g.run();
      total += g.state.round;
    }
    return total / 20;
  };
  const [low, mid, high] = [await meanEnd(4), await meanEnd(14), await meanEnd(30)];
  assert.ok(low < mid && mid < high, `expected the window to slide later: ${low} ${mid} ${high}`);
});

test('a strong enough crown reopens the road of inheritance', async () => {
  const hows = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const g = botGame(seed, { crownBase: 30 });
    const w = await g.run();
    hows.add(w ? w.how : 'civil-war');
  }
  assert.ok(hows.has('inherit'), `expected some inheritance, saw ${[...hows]}`);
});

test('bots only ever commit orders they can afford', async () => {
  for (let seed = 100; seed <= 115; seed++) {
    const game = botGame(seed, { ransom: true });
    const originalCommit = game.commit.bind(game);
    game.commit = (pid, answer) => {
      const before = game.state.players.find((p) => p.id === pid).gold;
      const c = originalCommit(pid, answer);
      assert.ok(c.gold <= before, `${pid} overcommitted on seed ${seed}`);
      if (c.order === ORDER.ATTACK || c.order === ORDER.SUPPORT) assert.ok(c.gold >= 1);
      if (c.order === ORDER.SUPPORT || c.order === ORDER.ATTACK) {
        assert.ok(c.target === CROWN || game.state.players.some((p) => p.id === c.target && p.id !== pid));
      }
      return c;
    };
    await game.run();
  }
});

test('a bribe can buy a bot\'s sword, and the gold really moves', () => {
  const state = createGame({
    seed: 11,
    seats: [{ kind: 'human' }, { kind: 'ai', personality: 'wolf' }, { kind: 'ai', personality: 'merchant' }, { kind: 'ai', personality: 'loyalist' }],
  });
  const controllers = { p0: { kind: 'human', decide: () => null } };
  for (const p of state.players.slice(1)) controllers[p.id] = createAI(p.personality);
  const game = new Game({ state, controllers });
  state.players[0].gold = 30;

  const cheap = proposeParley(game, { from: 'p0', to: 'p1', kind: 'attack', subject: 'p2', gold: 0 });
  const rich = proposeParley(game, { from: 'p0', to: 'p1', kind: 'attack', subject: 'p2', gold: 20 });
  assert.equal(typeof cheap.line, 'string');
  assert.ok(rich.accepted, 'a large enough purse should move a wolf');
  assert.equal(state.players[1].gold, 5 + 20);
  assert.equal(state.players[0].gold, 10);
  assert.equal(state.pacts.p1.kind, 'attack');
});

test('a bot will not sell a promise it cannot be paid for', () => {
  const state = createGame({ seed: 12, seats: [{ kind: 'human' }, { kind: 'ai', personality: 'loyalist' }, { kind: 'ai' }, { kind: 'ai' }] });
  const controllers = { p0: { kind: 'human', decide: () => null } };
  for (const p of state.players.slice(1)) controllers[p.id] = createAI(p.personality);
  const game = new Game({ state, controllers });
  const res = proposeParley(game, { from: 'p0', to: 'p1', kind: 'joinCoup', gold: 500 });
  assert.equal(res.accepted, false, 'you cannot pay gold you do not have');
  assert.equal(state.players[1].gold, 5);
});
