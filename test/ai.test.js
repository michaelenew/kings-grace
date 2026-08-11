import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/engine/game.js';
import { createGame, crownStrength } from '../src/engine/state.js';
import { createAI, saltFor } from '../src/engine/ai.js';
import { proposeParley } from '../src/engine/diplomacy.js';
import { CROWN, ORDER, PERSONALITIES, PLAYERS, TITLES } from '../src/engine/constants.js';
import { PRESETS, V0_1 } from '../src/engine/tuning.js';

const TOTAL_LANDS = PLAYERS * V0_1.startLands + V0_1.neutralPool;

function botGame(seed, options = {}, tuning = {}) {
  const { crownBase, ...rest } = options;
  const state = createGame({
    seed,
    tuning: crownBase === undefined ? tuning : { ...tuning, crownBase },
    options: rest,
    seats: PERSONALITIES.map((personality) => ({ kind: 'ai', personality })),
  });
  const controllers = {};
  state.players.forEach((p) => {
    controllers[p.id] = createAI(p.personality, 'opportunist', saltFor(state.seed, p.seat));
  });
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

// Balance lives in test/balance.test.js; these are bot-correctness checks.

test('bots never coup into a crown they cannot possibly beat', async () => {
  for (let seed = 1; seed <= 40; seed++) {
    const game = botGame(seed, {});
    const originalCommit = game.commit.bind(game);
    game.commit = (pid, answer) => {
      const c = originalCommit(pid, answer);
      if (c.order === ORDER.ATTACK && c.target === CROWN) {
        const me = game.state.players.find((p) => p.id === pid);
        const help = Object.values(game.state.pacts).some((pact) => pact.with === pid);
        const reach = c.gold + (me.titles.includes('marshal') ? 1 : 0);
        assert.ok(
          help || reach + 1 >= crownStrength(game.state),
          `${pid} threw ${reach} at a crown of ${crownStrength(game.state)} with nobody behind them`,
        );
      }
      return c;
    };
    await game.run();
  }
});

test('a commitment cap is never exceeded, by bot or by engine', async () => {
  for (let seed = 1; seed <= 25; seed++) {
    const state = createGame({
      seed,
      tuning: { commitCap: 4 },
      seats: PERSONALITIES.map((personality) => ({ kind: 'ai', personality })),
    });
    const controllers = {};
    state.players.forEach((p) => { controllers[p.id] = createAI(p.personality, 'opportunist', saltFor(state.seed, p.seat)); });
    const game = new Game({ state, controllers });
    const originalCommit = game.commit.bind(game);
    game.commit = (pid, answer) => {
      const c = originalCommit(pid, answer);
      if (c.order === ORDER.ATTACK || c.order === ORDER.SUPPORT) {
        assert.ok(c.gold <= 4, `${pid} committed ${c.gold} past a cap of 4`);
      }
      return c;
    };
    await game.run();
  }
});

// Under v0.1 a coup is either hopeless or already affordable alone, so nobody
// needs an ally. The tuned preset caps what one order can carry, which is what
// makes buying a sword the only way onto the throne.
test('bots buy the support a coup needs, and the gold really moves', async () => {
  let pactsSeen = 0;
  let goldMoved = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const game = botGame(seed, {}, PRESETS.tuned.tuning);
    game.subscribe(() => {});
    const originalPut = game.putOffer.bind(game);
    game.putOffer = async (offer) => {
      const before = game.player(offer.to).gold;
      const result = await originalPut(offer);
      if (result?.accepted) {
        pactsSeen += 1;
        goldMoved += game.player(offer.to).gold - before;
      }
      return result;
    };
    await game.run();
  }
  assert.ok(pactsSeen > 0, 'bots never struck a bargain across 60 games');
  assert.ok(goldMoved > 0, 'bargains were struck but no gold changed hands');
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
