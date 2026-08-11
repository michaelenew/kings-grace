#!/usr/bin/env node
// What do the houses actually *do*, round by round?
//
// A headline order mix hides the shape of a game. "Develop 16%" could mean
// everyone builds a little all game, or everyone builds flat out until the
// unclaimed land runs out and then never builds again — and those are
// completely different games. This prints the mix per round alongside the
// unclaimed land remaining, so the shape is visible.
//
// It also splits attacks by the band of the target, because the standing cost
// of attacking is charged by band and that is the likeliest reason a sword
// stays sheathed.
//
//   node tools/order-diary.js -n 400 --players 4

import { Game } from '../src/engine/game.js';
import { createGame } from '../src/engine/state.js';
import { createAI, saltFor } from '../src/engine/ai.js';
import { BAND, CROWN, ORDER, bandOf } from '../src/engine/constants.js';
import { POOL } from './tournament.js';
import { makeRng } from '../src/engine/rng.js';

const argv = process.argv.slice(2);
const N = Number(argv[argv.indexOf('-n') + 1]) || 300;
const PLAYERS = Number(argv[argv.indexOf('--players') + 1]) || 4;

const ORDERS = [ORDER.ATTACK, ORDER.SUPPORT, ORDER.PETITION, ORDER.DEVELOP, ORDER.HOLD];
const blank = () => Object.fromEntries(ORDERS.map((o) => [o, 0]));

const perRound = [];
const row = (i) => (perRound[i] ??= {
  orders: blank(), pool: 0, poolZero: 0, games: 0, seats: 0,
  attackTargets: { favorite: 0, neutral: 0, outlaw: 0, crown: 0 },
  developWanted: 0, developBlocked: 0,
  // How far apart the houses are. A table that has already separated by the
  // midpoint is a table where the back half is a formality; one that stays
  // level is a table where nobody has a reason to swing at anybody.
  landGap: 0, goldGap: 0, fealtyGap: 0, leadShare: 0,
});

/** Spread as the leader's margin over the median, in the leader's units. */
function gap(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.max(...sorted) - median;
}

for (let seed = 1; seed <= N; seed++) {
  const rng = makeRng(seed ^ 0x51ed270b);
  const doctrines = Array.from({ length: PLAYERS }, (_, i) => rng.shuffle(POOL)[i % POOL.length]);
  const state = createGame({ seed, seats: doctrines.map((doctrine) => ({ kind: 'ai', doctrine })) });
  const controllers = {};
  state.players.forEach((p) => { controllers[p.id] = createAI(p.personality, p.doctrine, saltFor(state.seed, p.seat)); });
  const game = new Game({ state, controllers });

  // Sample at the moment orders are sealed: the pool as the choice was made,
  // and how many houses wanted to build but had nowhere to build.
  const originalCommit = game.commitPhase.bind(game);
  game.commitPhase = async () => {
    const i = state.round - 1;
    const r = row(i);
    r.pool += state.neutralPool;
    if (state.neutralPool === 0) r.poolZero += 1;
    r.games += 1;
    const lands = state.players.map((p) => p.lands);
    const golds = state.players.map((p) => p.gold);
    r.landGap += gap(lands);
    r.goldGap += gap(golds);
    r.fealtyGap += gap(state.players.map((p) => p.fealty));
    const totalLand = lands.reduce((a, b) => a + b, 0) || 1;
    r.leadShare += Math.max(...lands) / totalLand;
    const before = state.neutralPool;
    await originalCommit();
    for (const p of state.players) {
      const c = state.commitments[p.id];
      if (!c) continue;
      r.seats += 1;
      r.orders[c.order] = (r.orders[c.order] || 0) + 1;
      if (c.order === ORDER.ATTACK) {
        if (c.target === CROWN) r.attackTargets.crown += 1;
        else {
          const t = state.players.find((x) => x.id === c.target);
          if (t) r.attackTargets[bandOf(t.fealty)] += 1;
        }
      }
      // Would they have built, if there had been anywhere to build?
      if (before === 0 && p.gold >= state.tuning.developCost) r.developBlocked += 1;
      if (before === 0) r.developWanted += 1;
    }
  };
  await game.run();
}

const pct = (a, b) => (b ? (100 * a) / b : 0);
console.log(`\n${N} games, ${PLAYERS} players. What each round looks like from the inside.\n`);
console.log('  rd  land left   attack  support   appeal  develop    hold    |  leader ahead by');
for (let i = 0; i < perRound.length; i++) {
  const r = perRound[i];
  if (!r || r.seats < N * 0.2) continue; // stop once most games have ended
  const o = r.orders;
  const at = r.attackTargets;
  const atTotal = at.favorite + at.neutral + at.outlaw + at.crown;
  const share = (n) => `${pct(n, r.seats).toFixed(0).padStart(5)}%`;
  const tgt = `${(r.landGap / r.games).toFixed(1)} land  ${(r.goldGap / r.games).toFixed(0).padStart(2)} gold`
    + `  ${(r.fealtyGap / r.games).toFixed(1)} fealty   (top house holds ${(100 * r.leadShare / r.games).toFixed(0)}% of all land)`;
  void atTotal; void at;
  console.log(`  ${String(i + 1).padStart(2)}  ${(r.pool / r.games).toFixed(1).padStart(9)}`
    + `   ${share(o[ORDER.ATTACK])}   ${share(o[ORDER.SUPPORT])}   ${share(o[ORDER.PETITION])}`
    + `   ${share(o[ORDER.DEVELOP])}  ${share(o[ORDER.HOLD])}    |  ${tgt}`);
}

const emptyIdx = perRound.findIndex((r) => r && r.poolZero > r.games * 0.5);
const emptyFrom = emptyIdx === -1 ? Math.ceil(perRound.length / 2) : emptyIdx;
console.log(emptyIdx === -1
  ? `\nThe unclaimed land never runs out. Splitting at round ${emptyFrom + 1} instead.`
  : `\nThe unclaimed land is gone in most games from round ${emptyFrom + 1} of ${perRound.length}.`);
const late = perRound.slice(emptyFrom).filter(Boolean);
const lateSeats = late.reduce((a, r) => a + r.seats, 0);
const lateAttack = late.reduce((a, r) => a + r.orders[ORDER.ATTACK], 0);
const latePetition = late.reduce((a, r) => a + r.orders[ORDER.PETITION], 0);
const lateSupport = late.reduce((a, r) => a + r.orders[ORDER.SUPPORT], 0);
console.log(`After that, the same turns go: attack ${pct(lateAttack, lateSeats).toFixed(0)}%, `
  + `support ${pct(lateSupport, lateSeats).toFixed(0)}%, appeal ${pct(latePetition, lateSeats).toFixed(0)}%.`);
const early = perRound.slice(0, Math.max(1, emptyFrom)).filter(Boolean);
const earlySeats = early.reduce((a, r) => a + r.seats, 0);
console.log(`Before it: attack ${pct(early.reduce((a, r) => a + r.orders[ORDER.ATTACK], 0), earlySeats).toFixed(0)}%, `
  + `support ${pct(early.reduce((a, r) => a + r.orders[ORDER.SUPPORT], 0), earlySeats).toFixed(0)}%, `
  + `appeal ${pct(early.reduce((a, r) => a + r.orders[ORDER.PETITION], 0), earlySeats).toFixed(0)}%, `
  + `develop ${pct(early.reduce((a, r) => a + r.orders[ORDER.DEVELOP], 0), earlySeats).toFixed(0)}%.`);
