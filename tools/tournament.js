// Bot tournament core. tools/simulate.js is the CLI over this; test/balance.js
// asserts against it, so the balance targets in the README are checked rather
// than remembered.
//
// Doctrines (src/engine/ai.js) are whole strategies rather than personality
// flavours, so a doctrine's win rate is a readable answer to "is this line
// viable?". Four seats are drawn from the doctrine pool per game and rotated
// across seeds so seat order washes out.

import { Game } from '../src/engine/game.js';
import { createGame } from '../src/engine/state.js';
import { DOCTRINE_NAMES, createAI, saltFor } from '../src/engine/ai.js';
import { BAND, CROWN, ORDER, PERSONALITIES, bandOf } from '../src/engine/constants.js';
import { resolveTuning } from '../src/engine/tuning.js';
import { makeRng } from '../src/engine/rng.js';

const POOL = DOCTRINE_NAMES.filter((d) => d !== 'opportunist');

function parseOverride(text) {
  const out = {};
  for (const pair of text.split(',')) {
    const [k, v] = pair.split('=');
    mergeTuning(out, expand(k, v));
  }
  return out;
}

/**
 * Shorthands for the sweeps. `tax=3` means "favorites 3, and one more for each
 * step down the track", which is how the rules sheet shapes it.
 */
function expand(key, raw) {
  const v = raw === 'null' ? null : Number(raw);
  if (key === 'tax') return { taxByBand: { favorite: v, neutral: v + 1, outlaw: v + 2 } };
  if (key === 'taxFavorite') return { taxByBand: { favorite: v } };
  if (key === 'taxNeutral') return { taxByBand: { neutral: v } };
  if (key === 'taxOutlaw') return { taxByBand: { outlaw: v } };
  if (key === 'hitFavorite') return { attackFealty: { favorite: v } };
  if (key === 'hitOutlaw') return { attackFealty: { outlaw: v } };
  if (key.startsWith('deck')) return { deck: { [key.slice(4).toLowerCase()]: v } };
  return { [key]: v };
}

/** Merge an expansion into a tuning override without clobbering taxByBand. */
function mergeTuning(into, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'taxByBand') into.taxByBand = { ...(into.taxByBand || {}), ...v };
    else if (k === 'attackFealty') into.attackFealty = { ...(into.attackFealty || {}), ...v };
    else if (k === 'deck') into.deck = { ...(into.deck || {}), ...v };
    else into[k] = v;
  }
  return into;
}

/**
 * How far a configuration is from a game worth playing. Lower is better.
 * Every term is a thing a first playtest would complain about out loud.
 */
function imbalance(s) {
  let penalty = 0;
  const notes = [];
  const add = (n, why) => { if (n > 0.5) { penalty += n; notes.push(`${why} ${n.toFixed(0)}`); } };

  // Both roads to the throne should be live.
  add(Math.abs(s.usurp - 50) * 0.9, 'road-mix');
  // No strategy should be dead or dominant.
  add(s.doctrineSpread * 1.6, 'doctrine-spread');
  // The game should use most of its deck without dragging past it.
  add(Math.max(0, 8.5 - s.meanRound) * 9, 'too-short');
  add(Math.max(0, s.meanRound - 11.5) * 6, 'too-long');
  // A coup should be a real gamble, not a formality or a suicide.
  add(Math.max(0, 30 - s.coupSuccess) * 0.8, 'coups-futile');
  add(Math.max(0, s.coupSuccess - 70) * 0.7, 'coups-free');
  add(Math.max(0, 0.5 - s.coupAttemptsPerGame) * 30, 'no-coups');
  // Swords should come out.
  add(Math.max(0, 3.5 - s.battlesPerGame) * 8, 'no-fighting');
  // No single order should dominate the round, and none should be dead.
  for (const [k, v] of Object.entries(s.orderMix)) {
    if (k === 'attackCrown' || k === 'ransom' || k === 'hold') continue;
    add(Math.max(0, v - 42) * 1.2, `${k}-spam`);
    // Support is exempt from the dead-order check: the bots only ever use it
    // to shield the throne, so a low figure measures bot coverage, not the game.
    if (k !== 'support') add(Math.max(0, 8 - v) * 1.2, `${k}-dead`);
  }
  // The three bands are the game's whole identity. If everyone ends up in one
  // of them the archetype system has collapsed, however even the win rates look.
  for (const [k, v] of Object.entries(s.bands)) {
    add(Math.max(0, 18 - v) * 1.3, `${k}-empty`);
    add(Math.max(0, v - 50) * 1.3, `${k}-crowd`);
  }
  return { penalty, notes };
}

function blankStats() {
  return {
    games: 0,
    rounds: 0,
    outcomes: { usurp: 0, inherit: 0, civilWar: 0 },
    coupAttempts: 0,
    coupsWon: 0,
    coupRounds: [],
    battles: 0,
    battlesWon: 0,
    orders: { attack: 0, support: 0, petition: 0, develop: 0, ransom: 0, hold: 0, attackCrown: 0 },
    bandRounds: { favorite: 0, neutral: 0, outlaw: 0 },
    endBandCount: { favorite: 0, neutral: 0, outlaw: 0 },
    bandSamples: 0,
    endGold: [],
    titlesHeld: 0,
    byDoctrine: {},
    bySeat: [0, 0, 0, 0],
    seatGames: [0, 0, 0, 0],
    winnerFealty: [],
    winnerLands: [],
    lastCoupWindow: [],
  };
}

function noteDoctrine(stats, doctrine) {
  if (!stats.byDoctrine[doctrine]) stats.byDoctrine[doctrine] = { games: 0, wins: 0, usurps: 0, inherits: 0 };
  return stats.byDoctrine[doctrine];
}

async function runGame(seed, tuning, options, doctrinePool) {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const chosen = rng.shuffle(doctrinePool).slice(0, 4);
  const personalities = rng.shuffle(PERSONALITIES);
  const state = createGame({
    seed,
    tuning,
    options,
    seats: chosen.map((doctrine, i) => ({ kind: 'ai', doctrine, personality: personalities[i] })),
  });
  const controllers = {};
  state.players.forEach((p) => { controllers[p.id] = createAI(p.personality, p.doctrine, saltFor(state.seed, p.seat)); });
  const game = new Game({ state, controllers });
  // Sample band occupancy every round, not just at the end: the endgame is a
  // fealty race by design, so end-state alone says nothing about the middle.
  const bandRounds = { favorite: 0, neutral: 0, outlaw: 0 };
  let samples = 0;
  const originalIncome = game.incomeStep.bind(game);
  game.incomeStep = () => {
    originalIncome();
    for (const p of game.state.players) bandRounds[bandOf(p.fealty)] += 1;
    samples += 1;
  };
  const winner = await game.run();
  return { state, winner, doctrines: chosen, bandRounds, samples };
}

function measure(stats, { state, winner, doctrines, bandRounds, samples }) {
  for (const [k, v] of Object.entries(bandRounds || {})) stats.bandRounds[k] += v;
  stats.bandSamples += (samples || 0) * 4;
  stats.games += 1;
  stats.rounds += state.round;

  const how = winner ? winner.how : 'civilWar';
  if (how === 'usurp') stats.outcomes.usurp += 1;
  else if (how === 'inherit') stats.outcomes.inherit += 1;
  else stats.outcomes.civilWar += 1;

  for (const entry of state.log) {
    if (entry.kind === 'coup' && entry.text.startsWith('Usurpation')) {
      stats.coupAttempts += 1;
      stats.coupRounds.push(entry.round);
    }
    if (entry.kind === 'victory' && entry.text.includes('by force')) stats.coupsWon += 1;
    if (entry.kind === 'combat' && entry.text.includes('strikes at')) {
      stats.battles += 1;
      if (entry.text.includes('breaks through')) stats.battlesWon += 1;
    }
    if (entry.kind === 'reveal') {
      const t = entry.text;
      if (t.includes(': Attack the Crown')) { stats.orders.attack += 1; stats.orders.attackCrown += 1; } else if (t.includes(': Attack')) stats.orders.attack += 1;
      else if (t.includes(': Support')) stats.orders.support += 1;
      else if (t.includes(': Petition')) stats.orders.petition += 1;
      else if (t.includes(': Develop')) stats.orders.develop += 1;
      else if (t.includes(': Ransom')) stats.orders.ransom += 1;
      else if (t.includes(': Hold')) stats.orders.hold += 1;
      // Which band was the player in when they sealed it?
    }
  }

  for (const p of state.players) {
    stats.endBandCount[bandOf(p.fealty)] += 1;
    stats.endGold.push(p.gold);
    stats.titlesHeld += p.titles.length;
    const d = noteDoctrine(stats, p.doctrine);
    d.games += 1;
    stats.seatGames[p.seat] += 1;
    if (winner && winner.playerIds.includes(p.id)) {
      d.wins += 1;
      if (how === 'usurp') d.usurps += 1; else d.inherits += 1;
      stats.bySeat[p.seat] += 1;
      stats.winnerFealty.push(p.fealty);
      stats.winnerLands.push(p.lands);
    }
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (n, d) => (d ? (100 * n) / d : 0);

async function tournament(tuningOverride, { n, ransom, doctrines }) {
  const tuning = resolveTuning(tuningOverride);
  const stats = blankStats();
  const pool = doctrines || POOL;
  for (let seed = 1; seed <= n; seed++) {
    measure(stats, await runGame(seed, tuningOverride, { ransom }, pool));
  }
  const totalOrders = Object.entries(stats.orders)
    .filter(([k]) => k !== 'attackCrown')
    .reduce((a, [, v]) => a + v, 0);
  const doctrineRates = Object.entries(stats.byDoctrine)
    .map(([name, d]) => ({ name, rate: pct(d.wins, d.games), games: d.games, usurps: d.usurps, inherits: d.inherits }))
    .sort((a, b) => b.rate - a.rate);
  const spread = doctrineRates.length
    ? doctrineRates[0].rate - doctrineRates[doctrineRates.length - 1].rate
    : 0;
  return {
    tuning,
    stats,
    summary: {
      games: stats.games,
      meanRound: stats.rounds / stats.games,
      usurp: pct(stats.outcomes.usurp, stats.games),
      inherit: pct(stats.outcomes.inherit, stats.games),
      civilWar: pct(stats.outcomes.civilWar, stats.games),
      coupAttemptsPerGame: stats.coupAttempts / stats.games,
      coupSuccess: pct(stats.coupsWon, stats.coupAttempts),
      meanCoupRound: mean(stats.coupRounds),
      battlesPerGame: stats.battles / stats.games,
      battleSuccess: pct(stats.battlesWon, stats.battles),
      orderMix: Object.fromEntries(Object.entries(stats.orders).map(([k, v]) => [k, pct(v, totalOrders)])),
      bands: Object.fromEntries(Object.entries(stats.bandRounds).map(([k, v]) => [k, pct(v, stats.bandSamples)])),
      endBands: Object.fromEntries(Object.entries(stats.endBandCount).map(([k, v]) => [k, pct(v, stats.games * 4)])),
      meanEndGold: mean(stats.endGold),
      titlesPerGame: stats.titlesHeld / stats.games,
      doctrineRates,
      doctrineSpread: spread,
      seatRates: stats.bySeat.map((w, i) => pct(w, stats.seatGames[i])),
      meanWinnerFealty: mean(stats.winnerFealty),
    },
  };
}

function fmtRow(label, s) {
  return [
    label.padEnd(22),
    `r${s.meanRound.toFixed(1).padStart(4)}`,
    `usurp ${s.usurp.toFixed(0).padStart(3)}%`,
    `inherit ${s.inherit.toFixed(0).padStart(3)}%`,
    `war ${s.civilWar.toFixed(0).padStart(2)}%`,
    `coups/g ${s.coupAttemptsPerGame.toFixed(2)}`,
    `coup win ${s.coupSuccess.toFixed(0).padStart(3)}%`,
    `fights/g ${s.battlesPerGame.toFixed(1).padStart(4)}`,
    `spread ${s.doctrineSpread.toFixed(0).padStart(2)}pt`,
  ].join('  ');
}

function detail(name, s) {
  console.log(`\n=== ${name} ===`);
  console.log(fmtRow('', s).trim());
  console.log('  order mix   ', Object.entries(s.orderMix)
    .filter(([k]) => k !== 'attackCrown')
    .map(([k, v]) => `${k} ${v.toFixed(0)}%`).join('  '));
  console.log('  band-rounds ', Object.entries(s.bands).map(([k, v]) => `${k} ${v.toFixed(0)}%`).join('  '),
    '   at the end:', Object.entries(s.endBands).map(([k, v]) => `${k} ${v.toFixed(0)}%`).join(' '));
  console.log('  doctrines   ', s.doctrineRates.map((d) => `${d.name} ${d.rate.toFixed(0)}% (${d.usurps}f/${d.inherits}h)`).join('  '));
  console.log('  seats       ', s.seatRates.map((r) => `${r.toFixed(0)}%`).join(' '),
    '  mean winner fealty', s.meanWinnerFealty.toFixed(1),
    '  mean end gold', s.meanEndGold.toFixed(1),
    '  titles/game', s.titlesPerGame.toFixed(1));
}


export { POOL, expand, mergeTuning, imbalance, tournament, fmtRow, detail, mean, pct };
