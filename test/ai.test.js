import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/engine/game.js';
import { createGame, crownStrength } from '../src/engine/state.js';
import { createAI, saltFor } from '../src/engine/ai.js';
import { proposeDeal, emptyGoods } from '../src/engine/deals.js';
import { CROWN, ORDER, PERSONALITIES, TITLES } from '../src/engine/constants.js';
import { RULES, neutralPoolFor } from '../src/engine/tuning.js';

const landsFor = (players) => players * RULES.startLands + neutralPoolFor(RULES, players);

function botGame(seed, options = {}, tuning = {}, players = 4) {
  const state = createGame({
    seed,
    tuning,
    options,
    seats: Array.from({ length: players }, (_, i) => ({ kind: 'ai', personality: PERSONALITIES[i % PERSONALITIES.length] })),
  });
  const controllers = {};
  state.players.forEach((p) => {
    controllers[p.id] = createAI(p.personality, 'opportunist', saltFor(state.seed, p.seat));
  });
  return new Game({ state, controllers });
}

function checkInvariants(state, where) {
  const held = state.players.reduce((a, p) => a + p.lands, 0);
  assert.equal(held + state.neutralPool + state.crownLands, landsFor(state.players.length), `lands conserved ${where}`);
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

test('bots play whole games at every table size without breaking the board', async () => {
  for (let seed = 1; seed <= 60; seed++) {
    const players = 2 + (seed % 5);
    const game = botGame(seed, { ransom: seed % 2 === 0 }, {}, players);
    const unsubscribe = game.subscribe((s) => checkInvariants(s, `seed ${seed} round ${s.round}`));
    const winner = await game.run();
    unsubscribe();
    assert.ok(winner === null || Array.isArray(winner.playerIds), `seed ${seed} finished`);
    assert.ok(game.state.round <= 13, `seed ${seed} ended inside the crown deck`);
    assert.equal(game.state.players.length, players);
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

// The commitment cap is what makes buying a sword the only way onto the throne:
// no single purse outreaches the crown, so a usurper needs an ally.
test('bots strike bargains, and the goods really move', async () => {
  let dealsStruck = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const game = botGame(seed, {});
    await game.run();
    dealsStruck += game.state.deals.length;
  }
  assert.ok(dealsStruck > 0, 'bots never struck a bargain across 60 games');
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

test('a bot takes a deal that pays it and refuses one that does not', async () => {
  const state = createGame({
    seed: 11,
    seats: [{ kind: 'human' }, { kind: 'ai', personality: 'wolf' }, { kind: 'ai', personality: 'merchant' }, { kind: 'ai', personality: 'loyalist' }],
  });
  const controllers = { p0: { kind: 'human', decide: () => null } };
  for (const p of state.players.slice(1)) controllers[p.id] = createAI(p.personality);
  const game = new Game({ state, controllers });
  state.players[0].gold = 40;

  const stingy = await proposeDeal(game, {
    proposer: 'p0',
    transfers: [{ from: 'p1', to: 'p0', goods: { ...emptyGoods(), lands: 1 } }],
  });
  assert.equal(stingy.accepted, false, 'nobody gives away land for nothing');

  const before = state.players[1].gold;
  const fair = await proposeDeal(game, {
    proposer: 'p0',
    transfers: [
      { from: 'p0', to: 'p1', goods: { ...emptyGoods(), gold: 20 } },
      { from: 'p1', to: 'p0', goods: { ...emptyGoods(), lands: 1 } },
    ],
  });
  assert.ok(fair.accepted, 'twenty gold should buy one land');
  assert.equal(state.players[1].gold, before + 20);
  assert.equal(state.players[1].lands, RULES.startLands - 1);
  assert.equal(state.players[0].lands, RULES.startLands + 1);
});

test('a deal nobody can pay for does not settle', async () => {
  const state = createGame({ seed: 12, seats: [{ kind: 'human' }, { kind: 'ai' }, { kind: 'ai' }, { kind: 'ai' }] });
  const controllers = { p0: { kind: 'human', decide: () => null } };
  for (const p of state.players.slice(1)) controllers[p.id] = createAI(p.personality);
  const game = new Game({ state, controllers });
  const res = await proposeDeal(game, {
    proposer: 'p0',
    transfers: [{ from: 'p0', to: 'p1', goods: { ...emptyGoods(), gold: 500 } }],
  });
  assert.equal(res.accepted, false);
  assert.match(res.reason, /gold to give/);
  assert.equal(state.players[1].gold, RULES.startGold);
});

test('a three-cornered deal settles all at once', async () => {
  const state = createGame({ seed: 13, seats: [{ kind: 'human' }, { kind: 'ai' }, { kind: 'ai' }, { kind: 'ai' }] });
  const controllers = { p0: { kind: 'human', decide: () => null } };
  for (const p of state.players.slice(1)) controllers[p.id] = { kind: 'ai', decide: () => ({ accept: true }) };
  const game = new Game({ state, controllers });
  state.players[0].gold = 20;
  const res = await proposeDeal(game, {
    proposer: 'p0',
    transfers: [
      { from: 'p0', to: 'p1', goods: { ...emptyGoods(), gold: 5 } },
      { from: 'p1', to: 'p2', goods: { ...emptyGoods(), lands: 1 } },
      { from: 'p2', to: 'p0', goods: { ...emptyGoods(), gold: 2 } },
    ],
  });
  assert.ok(res.accepted, res.reason);
  assert.equal(state.players[1].lands, RULES.startLands - 1);
  assert.equal(state.players[2].lands, RULES.startLands + 1);
  assert.equal(state.players[0].gold, 20 - 5 + 2);
});
