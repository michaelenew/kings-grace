// Bot tournament core. tools/simulate.js is the CLI over this; test/balance.js
// asserts against it, so the balance targets in the README are checked rather
// than remembered.
//
// Doctrines (src/engine/ai.js) are whole strategies rather than personality
// flavours, so a doctrine's win rate is a readable answer to "is this line
// viable?". Four seats are drawn from the doctrine pool per game and rotated
// across seeds so seat order washes out.

import { Game } from '../src/engine/game.js';
import { createGame, legalOrders } from '../src/engine/state.js';
import { DOCTRINE_NAMES, createAI, saltFor } from '../src/engine/ai.js';
import { BAND, CROWN, ORDER, PERSONALITIES, bandOf } from '../src/engine/constants.js';
import { resolveTuning } from '../src/engine/tuning.js';
import { makeRng } from '../src/engine/rng.js';
import { blankTally, summariseEnjoyment, watchEnjoyment } from './enjoyment.js';

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
function imbalance(s, players = 4) {
  let penalty = 0;
  const notes = [];
  const add = (n, why) => { if (n > 0.5) { penalty += n; notes.push(`${why} ${n.toFixed(0)}`); } };

  // Both roads to the throne should be live.
  add(Math.abs(s.usurp - 50) * 0.9, 'road-mix');
  // No strategy should be dead or dominant — but a strict loyalist is allowed
  // to sit below the mean. Everyone can betray the crown at any moment; an
  // outlaw has no fast road back to being a favorite. Backstabbing is equal
  // opportunity and loyalism is not, so what is scored is the *floor* (a lane
  // that cannot win) and the *ceiling* (one that runs away with it), not the
  // raw spread.
  const baselineRate = 100 / Math.max(1, players);
  for (const d of s.doctrineRates) {
    add(Math.max(0, baselineRate * 0.55 - d.rate) * players * 0.9, `${d.name}-dead`);
    add(Math.max(0, d.rate - baselineRate * 1.45) * players * 0.9, `${d.name}-dominant`);
  }
  // The game should use most of its deck without dragging past it.
  add(Math.max(0, 8.5 - s.meanRound) * 9, 'too-short');
  add(Math.max(0, s.meanRound - 11.5) * 6, 'too-long');
  // A coup should be a real gamble, not a formality or a suicide.
  add(Math.max(0, 30 - s.coupSuccess) * 0.8, 'coups-futile');
  add(Math.max(0, s.coupSuccess - 70) * 0.7, 'coups-free');
  add(Math.max(0, 0.5 - s.coupAttemptsPerGame) * 30, 'no-coups');
  // Swords should come out.
  add(Math.max(0, 3.5 - s.battlesPerGame) * 8, 'no-fighting');
  // Being priced out of every order but attack-or-support is not a decision,
  // it is a dead turn. This is the single loudest feel problem there is.
  add(Math.max(0, s.starvedChoices - 8) * 2.2, 'starved-choices');
  // No single order should dominate the round, and none should be dead.
  for (const [k, v] of Object.entries(s.orderMix)) {
    if (k === 'attackCrown' || k === 'ransom' || k === 'hold') continue;
    add(Math.max(0, v - 42) * 1.2, `${k}-spam`);
    // Support is exempt from the dead-order check: the bots only ever use it
    // to shield the throne, so a low figure measures bot coverage, not the game.
    if (k !== 'support') add(Math.max(0, 8 - v) * 1.2, `${k}-dead`);
  }
  // Which title you pick should not decide the game. When one is worth half
  // again as much as another, the grant at +2 stops being a choice.
  add(Math.max(0, s.titleSpread - 0.45) * 34, 'title-spread');
  // The three bands are the game's whole identity. If everyone ends up in one
  // of them the archetype system has collapsed, however even the win rates look.
  for (const [k, v] of Object.entries(s.bands)) {
    add(Math.max(0, 18 - v) * 1.3, `${k}-empty`);
    add(Math.max(0, v - 50) * 1.3, `${k}-crowd`);
  }
  // And whether any of it is fun: the shape of a winner's turns against
  // 40/40/20, whether they needed all three lanes, and whether the board they
  // were choosing from was affordable. See tools/enjoyment.js.
  if (s.fun) add((100 - s.fun.score) * 1.2, 'no-fun');
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
    titlesTaken: 0,
    titlesClaimed: 0,
    promisesMade: 0,
    promisesKept: 0,
    betrayals: 0, // struck a house you had just bargained with
    trustSpread: [],
    byDoctrine: {},
    bySeat: [0, 0, 0, 0, 0, 0],
    seatGames: [0, 0, 0, 0, 0, 0],
    choices: 0,
    starved: 0,
    fun: blankTally(),
    heraldGames: 0,
    heraldWins: 0,
    byTitle: {},
    winnerFealty: [],
    winnerLands: [],
    lastCoupWindow: [],
  };
}

function noteDoctrine(stats, doctrine) {
  if (!stats.byDoctrine[doctrine]) stats.byDoctrine[doctrine] = { games: 0, wins: 0, usurps: 0, inherits: 0 };
  return stats.byDoctrine[doctrine];
}

async function runGame(seed, tuning, options, doctrinePool, players = 4, fun = null) {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const chosen = Array.from({ length: players }, (_, i) => rng.shuffle(doctrinePool)[i % doctrinePool.length]);
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
  // How often a player is priced out of everything but throwing gold at
  // somebody. This is the "I only have two buttons" complaint, measured. It is
  // a feel metric, and it matters as much as the win rates.
  //
  // Being short of the coin is starvation; having your host away with the
  // Crown's levy is not, so it is measured against the orders money can buy
  // rather than against the length of the list.
  let choices = 0;
  let starved = 0;
  const originalCommitPhase = game.commitPhase.bind(game);
  game.commitPhase = async () => {
    for (const p of game.state.players) {
      choices += 1;
      const legal = legalOrders(game.state, p);
      if (!legal.includes(ORDER.PETITION) && !legal.includes(ORDER.DEVELOP)) starved += 1;
    }
    return originalCommitPhase();
  };
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
  const finishFun = fun ? watchEnjoyment(game, fun) : null;
  const winner = await game.run();
  if (finishFun) finishFun(winner);
  return { state, winner, doctrines: chosen, bandRounds, samples, choices, starved };
}

function measure(stats, { state, winner, doctrines, bandRounds, samples, choices, starved }) {
  for (const [k, v] of Object.entries(bandRounds || {})) stats.bandRounds[k] += v;
  stats.bandSamples += (samples || 0) * state.players.length;
  stats.choices += choices || 0;
  stats.starved += starved || 0;
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
    // How often a coronet changes hands, by either road. The whole point of a
    // title is meant to be that holding one paints a target on you.
    if (entry.kind === 'spoils' && entry.text.includes('strips')) stats.titlesTaken += 1;
    if (entry.kind === 'title' && entry.text.includes('claims the title')) stats.titlesClaimed += 1;
    if (entry.kind === 'trust' && entry.text.includes('then drew on them')) stats.betrayals += 1;
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

  for (const promise of state.promises || []) {
    if (promise.kept === null) continue;
    stats.promisesMade += 1;
    if (promise.kept) stats.promisesKept += 1;
  }
  const ledger = Object.values(state.trust || {});
  if (ledger.length) stats.trustSpread.push(mean(ledger.map(Math.abs)));

  for (const p of state.players) {
    const won = !!(winner && winner.playerIds.includes(p.id));
    for (const t of p.titles) {
      stats.byTitle[t] ??= { games: 0, wins: 0 };
      stats.byTitle[t].games += 1;
      if (won) stats.byTitle[t].wins += 1;
    }
    if (p.titles.includes('herald')) {
      stats.heraldGames += 1;
      if (won) stats.heraldWins += 1;
    }
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

async function tournament(tuningOverride, { n, ransom, doctrines, players = 4 }) {
  const tuning = resolveTuning(tuningOverride);
  const stats = blankStats();
  const pool = doctrines || POOL;
  for (let seed = 1; seed <= n; seed++) {
    measure(stats, await runGame(seed, tuningOverride, { ransom }, pool, players, stats.fun));
  }
  const totalOrders = Object.entries(stats.orders)
    .filter(([k]) => k !== 'attackCrown')
    .reduce((a, [, v]) => a + v, 0);
  const baseline = 100 / Math.max(1, players);
  const titleEdges = Object.entries(stats.byTitle)
    .map(([name, t]) => ({ name, rate: pct(t.wins, t.games), edge: pct(t.wins, t.games) / baseline, games: t.games }))
    .sort((a, b) => b.edge - a.edge);
  const titleSpread = titleEdges.length > 1 ? titleEdges[0].edge - titleEdges[titleEdges.length - 1].edge : 0;
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
      titlesTakenPerGame: stats.titlesTaken / stats.games,
      titlesClaimedPerGame: stats.titlesClaimed / stats.games,
      promisesPerGame: stats.promisesMade / stats.games,
      promisesKept: pct(stats.promisesKept, stats.promisesMade),
      betrayalsPerGame: stats.betrayals / stats.games,
      meanTrustHeld: mean(stats.trustSpread),
      doctrineRates,
      doctrineSpread: spread,
      seatRates: stats.bySeat.map((w, i) => pct(w, stats.seatGames[i])).filter((_, i) => stats.seatGames[i] > 0),
      starvedChoices: pct(stats.starved, stats.choices),
      heraldWinRate: pct(stats.heraldWins, stats.heraldGames),
      // Reported as a multiple of the 1/players baseline: a title held in a
      // six-player game is doing well at 20%, badly at 20% in a two-player one.
      titleRates: titleEdges,
      titleSpread,
      doctrineBaseline: baseline,
      meanWinnerFealty: mean(stats.winnerFealty),
      fun: summariseEnjoyment(stats.fun),
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
  console.log('  starved     ', `${s.starvedChoices.toFixed(0)}% of turns cannot afford an appeal or a develop`);
  console.log('  coronets    ', `${s.titlesTakenPerGame.toFixed(2)} taken by sword, ${s.titlesClaimedPerGame.toFixed(2)} claimed by grant, per game`);
  console.log('  the word    ', `${s.promisesPerGame.toFixed(1)} given per game, ${s.promisesKept.toFixed(0)}% kept`,
    `· ${s.betrayalsPerGame.toFixed(2)} houses struck by someone they had just dealt with`,
    `· mean opinion held ${s.meanTrustHeld.toFixed(2)} of 3`);
  console.log('  title edge  ', s.titleRates.map((t) => `${t.name} ${t.edge.toFixed(2)}x`).join('  '),
    `  spread ${s.titleSpread.toFixed(2)}x`);
  const f = s.fun;
  const mix = (m) => `build ${(100 * m.build).toFixed(0)}%  attack ${(100 * m.attack).toFixed(0)}%  connive ${(100 * m.connive).toFixed(0)}%`;
  console.log('  winners do  ', mix(f.winnerMix),
    `   (target build 40%  attack 40%  connive 20%)`);
  console.log('  the table   ', mix(f.tableMix),
    `   building splits ${(100 * f.winnerBuildSplit.develop).toFixed(0)}% land / ${(100 * f.winnerBuildSplit.appeal).toFixed(0)}% favour`);
  console.log('  enjoyment   ', `${f.score.toFixed(0)}/100`,
    `(mix ${f.mixScore.toFixed(0)}/50  breadth ${f.breadthScore.toFixed(0)}/25  options ${f.optionScore.toFixed(0)}/25)`,
    f.notes.length ? `— ${f.notes.join('; ')}` : '');
  console.log('  seats       ', s.seatRates.map((r) => `${r.toFixed(0)}%`).join(' '),
    '  mean winner fealty', s.meanWinnerFealty.toFixed(1),
    '  mean end gold', s.meanEndGold.toFixed(1),
    '  titles/game', s.titlesPerGame.toFixed(1));
}


export { POOL, expand, mergeTuning, imbalance, tournament, fmtRow, detail, mean, pct };
