// Is this configuration any fun?
//
// Every other measurement in tools/ asks whether the game is *fair*. A game can
// be perfectly balanced and still be a chore, and the two failure modes look
// identical in a win-rate table: a table where everybody farms quietly for
// twelve rounds and a table where everybody parks gold on Support are both
// beautifully even, and both dull.
//
// So this scores the shape of a turn instead of the outcome of a game. Three
// things go into it.
//
// THE MIX. Every turn a house takes is one of three verbs — building something,
// swinging at somebody, or working through somebody else — and the game is at
// its best when the road to victory runs through all three. The target for a
// *winner's* turns is 40% building, 40% attacking, 20% conniving.
//
// THE BREADTH, which is a question about the *distribution* of winners rather
// than the average of them. An average that lands on 40/40/20 can be made of
// one house that only farmed and another that only fought — so most winners
// should have had to do all three. But not all of them: a game where the
// balanced split is the only line that ever wins has no strategy in it, only
// execution. Skipping a lane should be a real road and a road less travelled.
//
// So this scores two things at once. Most winners used every lane, and a
// minority did not.
//
// THE OPTIONS. Being priced out of half your board most turns is not a
// decision, it is a queue. Measured as the share of the four standing orders a
// house could actually have chosen when it sealed one.

import { CROWN, ORDER } from '../src/engine/constants.js';

export const MIX_TARGET = { build: 0.40, attack: 0.40, connive: 0.20 };

/** The four orders a house is choosing between when it seals one. */
const CORE = [ORDER.ATTACK, ORDER.SUPPORT, ORDER.PETITION, ORDER.DEVELOP];

/**
 * Which verb a sealed order is.
 *
 * Support is the interesting case and it is deliberately split: gold sent to a
 * house that struck this round rode with the army, so it is attacking; gold
 * sent to anyone else — or to the throne — held a wall, which is court
 * politics. The game already draws that line at resolution, so this is the
 * game's own distinction rather than an imposed one.
 */
export function verbOf(commitment, commitments) {
  if (!commitment) return 'idle';
  switch (commitment.order) {
    case ORDER.ATTACK: return 'attack';
    case ORDER.SUPPORT: {
      if (commitment.target === CROWN) return 'connive';
      const theirs = commitments[commitment.target];
      return theirs && theirs.order === ORDER.ATTACK ? 'attack' : 'connive';
    }
    case ORDER.PETITION:
    case ORDER.DEVELOP:
      return 'build';
    case ORDER.RANSOM: return 'connive';
    default: return 'idle';
  }
}

export function blankTally() {
  return {
    games: 0,
    winnerTurns: { build: 0, attack: 0, connive: 0, idle: 0 },
    allTurns: { build: 0, attack: 0, connive: 0, idle: 0 },
    // Split inside the building lane: settling land and currying favour are
    // both "building" but they are not the same activity, and one of them runs
    // out halfway through the game.
    winnerBuild: { develop: 0, appeal: 0 },
    winnerMixes: [], // per winner, their own three-way split
    optionShare: 0, // summed share of the four orders that were affordable
    optionTurns: 0,
    pinchedTurns: 0, // turns with two or fewer of the four available
  };
}

/**
 * Hook a game and accumulate everything the score needs. Returns a function to
 * call once the game is over, which folds the run into `tally`.
 */
export function watchEnjoyment(game, tally) {
  const state = game.state;
  // pid -> round -> verb, filled in at the moment every order is on the table.
  const turns = new Map(state.players.map((p) => [p.id, new Map()]));

  const originalCommit = game.commitPhase.bind(game);
  game.commitPhase = async () => {
    for (const p of state.players) {
      const legal = legalCore(state, p);
      tally.optionShare += legal / CORE.length;
      tally.optionTurns += 1;
      if (legal <= 2) tally.pinchedTurns += 1;
    }
    return originalCommit();
  };

  const originalResolve = game.resolvePhase.bind(game);
  game.resolvePhase = async () => {
    const round = state.round;
    for (const p of state.players) {
      const c = state.commitments[p.id];
      turns.get(p.id).set(round, {
        verb: verbOf(c, state.commitments),
        order: c ? c.order : null,
      });
    }
    return originalResolve();
  };

  return function finish(winner) {
    // Deliberate acts outside the order — settling a bargain, burning a
    // turncoat token, taking a coronet off somebody with a grant — make that
    // house's turn a conniving one whatever it sealed. Peeking does not: an
    // outlaw peeks every round whether they meant to or not, and a reflex is
    // not a scheme.
    for (const deal of state.deals || []) {
      const involved = new Set([...Object.keys(deal.offers || {}), ...Object.keys(deal.takes || {})]);
      for (const pid of involved) mark(turns, pid, deal.round);
    }
    for (const entry of state.log) {
      if (entry.kind === 'turncoat' && entry.pid && entry.text.includes('spends')) mark(turns, entry.pid, entry.round);
      if (entry.kind === 'title' && entry.text.includes('claims the title')) {
        const claimant = state.players.find((p) => entry.text.startsWith(p.name));
        if (claimant) mark(turns, claimant.id, entry.round);
      }
    }

    tally.games += 1;
    const winners = new Set(winner?.playerIds || []);
    for (const p of state.players) {
      const mine = turns.get(p.id);
      const bucket = { build: 0, attack: 0, connive: 0, idle: 0 };
      for (const t of mine.values()) bucket[t.verb] += 1;
      for (const k of Object.keys(bucket)) tally.allTurns[k] += bucket[k];
      if (!winners.has(p.id)) continue;
      for (const k of Object.keys(bucket)) tally.winnerTurns[k] += bucket[k];
      for (const t of mine.values()) {
        if (t.verb !== 'build') continue;
        if (t.order === ORDER.DEVELOP) tally.winnerBuild.develop += 1;
        if (t.order === ORDER.PETITION) tally.winnerBuild.appeal += 1;
      }
      const live = bucket.build + bucket.attack + bucket.connive;
      if (live > 0) {
        tally.winnerMixes.push({
          build: bucket.build / live,
          attack: bucket.attack / live,
          connive: bucket.connive / live,
          how: winner?.how ?? 'none',
        });
      }
    }
  };
}

function mark(turns, pid, round) {
  const mine = turns.get(pid);
  const t = mine && mine.get(round);
  if (t) t.verb = 'connive';
}

function legalCore(state, player) {
  const t = state.tuning;
  const outlaw = player.fealty <= -2;
  const appeal = outlaw ? t.pardonCost : t.petitionCost;
  let n = 0;
  if (player.gold >= 1 && !player.noArmy) n += 1; // attack
  if (player.gold >= 1) n += 1; // support
  if (player.gold >= appeal) n += 1;
  if (player.gold >= t.developCost && state.neutralPool > 0) n += 1;
  return n;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * A trapezoid: nothing below `zeroLo`, everything between `fullLo` and
 * `fullHi`, nothing again above `zeroHi`. For quantities where both too little
 * and too much are failures and there is a comfortable band in between.
 */
function band(x, zeroLo, fullLo, fullHi, zeroHi) {
  if (x <= zeroLo || x >= zeroHi) return 0;
  if (x < fullLo) return (x - zeroLo) / (fullLo - zeroLo);
  if (x > fullHi) return (zeroHi - x) / (zeroHi - fullHi);
  return 1;
}

/** A lane counts as used if it took at least this share of a winner's turns. */
const LANE_FLOOR = 0.12;
/** And as skipped if it took less than this. */
const LANE_SKIPPED = 0.05;

/** Fold a finished tally into shares and a 0–100 score. */
export function summariseEnjoyment(tally) {
  const live = (b) => b.build + b.attack + b.connive;
  const shares = (b) => {
    const n = live(b) || 1;
    return { build: b.build / n, attack: b.attack / n, connive: b.connive / n };
  };
  const winnerMix = shares(tally.winnerTurns);
  const tableMix = shares(tally.allTurns);
  const idleShare = tally.winnerTurns.idle
    / Math.max(1, live(tally.winnerTurns) + tally.winnerTurns.idle);

  // Total-variation distance from the target, so 0 is a bullseye and 1 is
  // "shares nothing with what we asked for".
  const drift = 0.5 * (Math.abs(winnerMix.build - MIX_TARGET.build)
    + Math.abs(winnerMix.attack - MIX_TARGET.attack)
    + Math.abs(winnerMix.connive - MIX_TARGET.connive));

  const mixes = tally.winnerMixes;
  const thinnestOf = (m) => Math.min(m.build, m.attack, m.connive);
  const thinnest = mean(mixes.map(thinnestOf));
  // The main line: winners who had to do all three.
  const roundedAll = mixes.filter((m) => thinnestOf(m) >= LANE_FLOOR).length;
  const usedAll = mixes.length ? roundedAll / mixes.length : 0;
  // The roads less travelled: winners who genuinely skipped one.
  const skipped = mixes.filter((m) => thinnestOf(m) < LANE_SKIPPED);
  const skippers = mixes.length ? skipped.length / mixes.length : 0;
  // Which lane the deviants leave out. If it is always the same one, that lane
  // is not an alternative road, it is a tax people are dodging.
  const skippedLane = { build: 0, attack: 0, connive: 0 };
  for (const m of skipped) {
    const worst = ['build', 'attack', 'connive'].sort((a, b) => m[a] - m[b])[0];
    skippedLane[worst] += 1;
  }
  // Split by which road they took, because the two roads to the throne may
  // simply *be* two of the three lanes — in which case skipping one is the
  // design working, not failing.
  const byRoad = {};
  for (const road of ['usurp', 'inherit']) {
    const of = mixes.filter((m) => m.how === road);
    byRoad[road] = {
      share: mixes.length ? of.length / mixes.length : 0,
      usedAll: of.length ? of.filter((m) => thinnestOf(m) >= LANE_FLOOR).length / of.length : 0,
      mix: {
        build: mean(of.map((m) => m.build)),
        attack: mean(of.map((m) => m.attack)),
        connive: mean(of.map((m) => m.connive)),
      },
    };
  }
  const optionShare = tally.optionTurns ? tally.optionShare / tally.optionTurns : 0;
  const pinched = tally.optionTurns ? tally.pinchedTurns / tally.optionTurns : 0;

  // 50 for the mix, 25 for needing all three lanes, 25 for having a board to
  // play on. A quarter of the score sits on options because being priced out is
  // the complaint that does not show up anywhere else in tools/.
  const mixScore = 50 * clamp(1 - drift / 0.5, 0, 1);
  // 18 for the main line being a genuine split, 7 for the alternative roads
  // existing without taking over. Skipping a lane is meant to be a real option
  // and a rare one, so both "nobody can" and "everybody does" score zero.
  const mainLine = 18 * clamp(usedAll / 0.75, 0, 1);
  const openRoads = 7 * band(skippers, 0.02, 0.08, 0.25, 0.45);
  const breadthScore = mainLine + openRoads;
  const optionScore = 25 * clamp((optionShare - 0.5) / 0.25, 0, 1);
  const score = mixScore + breadthScore + optionScore;

  const notes = [];
  const off = (lane) => winnerMix[lane] - MIX_TARGET[lane];
  for (const lane of ['build', 'attack', 'connive']) {
    if (Math.abs(off(lane)) > 0.08) {
      notes.push(`${lane} ${off(lane) > 0 ? 'over' : 'under'} by ${Math.abs(100 * off(lane)).toFixed(0)}pt`);
    }
  }
  if (usedAll < 0.75) notes.push(`only ${(100 * usedAll).toFixed(0)}% of winners used all three lanes`);
  if (skippers < 0.02) notes.push('no winner ever skips a lane — one line and no strategy');
  else if (skippers > 0.25) {
    const worst = Object.entries(skippedLane).sort((a, b) => b[1] - a[1])[0];
    notes.push(`${(100 * skippers).toFixed(0)}% of winners skip a lane outright, usually ${worst[0]}`);
  }
  if (optionShare < 0.75) notes.push(`only ${(100 * optionShare).toFixed(0)}% of the board affordable`);
  if (pinched > 0.2) notes.push(`${(100 * pinched).toFixed(0)}% of turns down to two orders`);

  return {
    score, mixScore, breadthScore, optionScore, mainLine, openRoads,
    winnerMix, tableMix, thinnest, usedAll, skippers, skippedLane, byRoad,
    optionShare, pinched, idleShare, drift,
    winnerBuildSplit: {
      develop: tally.winnerBuild.develop / Math.max(1, tally.winnerBuild.develop + tally.winnerBuild.appeal),
      appeal: tally.winnerBuild.appeal / Math.max(1, tally.winnerBuild.develop + tally.winnerBuild.appeal),
    },
    notes,
  };
}
