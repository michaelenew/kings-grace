// Bot controllers. Heuristic, deterministic given the game's seeded RNG.
//
// The bots see exactly what a player in their seat is entitled to see: the
// public board plus anything they legitimately peeked at. They never read the
// crown deck or unrevealed orders.
//
// A bot has two dials. Its *personality* colours how it plays — how greedy, how
// treacherous, how much nerve. Its *doctrine* is a strategy it has committed
// to, and exists mostly so tools/simulate.js can put whole strategies against
// each other and see which ones actually win.

import { BAND, CROWN, FEALTY_MAX, ORDER, TITLES, bandOf, clampFealty } from './constants.js';
import { emptyGoods } from './deals.js';
import { LATER, endgameWeight, streamValue } from './horizon.js';

// `credulity` is the trust tolerance: how much of somebody else's word a house
// is willing to act on, before any ledger. It runs from a loyalist who takes
// people at face value to a wolf who assumes everyone is lying — and it is a
// separate dial from `treachery`, which is how much a house's *own* word is
// worth. The two together are what make a table interesting: a credulous
// traitor and a suspicious honest broker are both playable characters.
const TRAITS = {
  loyalist: { aggression: 0.55, greed: 0.9, treachery: 0.3, nerve: 0.7, crownLove: 1.6, credulity: 0.85 },
  merchant: { aggression: 0.7, greed: 1.5, treachery: 0.5, nerve: 0.8, crownLove: 1.0, credulity: 0.6 },
  schemer: { aggression: 1.0, greed: 1.0, treachery: 1.0, nerve: 1.2, crownLove: 0.7, credulity: 0.45 },
  wolf: { aggression: 1.5, greed: 0.85, treachery: 1.3, nerve: 1.45, crownLove: 0.4, credulity: 0.2 },
};

/** How hard a doctrine pulls a bot toward its lane, in score points. */
const DOCTRINE_PULL = 7;

/**
 * What a title is worth to a bot, in roughly the same units as gold. Weighted
 * by what a title actually does to a win rate, measured causally in
 * tools/title-value.js rather than by how often title-holders happen to win.
 */
function TITLE_WORTH(id, view) {
  const worth = {
    marshal: 12, herald: 9, warden: 8, chancellor: 5, spymaster: 5,
    steward: 4 + streamValue(view.tuning?.stewardIncome ?? 1, view.deckCount),
  };
  return worth[id] ?? 3;
}

const DOCTRINES = {
  // Plays the board. No lane.
  opportunist: {},
  // Climbs the fealty track, collects titles, means to inherit.
  climber: { petition: 1.9, develop: 1.1, attack: 0.5, support: 1.2, coup: 0.5, levyPay: 1.7 },
  // Keeps its head down, buys land, ends the game rich.
  granary: { petition: 0.85, develop: 1.9, attack: 0.7, support: 1.0, coup: 0.9, levyPay: 1.1, wantBand: BAND.NEUTRAL },
  // Dives into the shadow for the peek and the change right.
  shadow: { petition: 0.45, develop: 1.0, attack: 1.1, support: 0.7, coup: 1.15, levyPay: 0.25, wantBand: BAND.OUTLAW },
  // Takes what it wants at swordpoint.
  raider: { petition: 0.6, develop: 0.85, attack: 1.9, support: 0.7, coup: 1.1, levyPay: 0.8 },
  // Guards the throne, punishes traitors, hopes to be the last one standing.
  bulwark: { petition: 1.35, develop: 1.15, attack: 0.55, support: 1.9, coup: 0.35, levyPay: 1.5 },
};

export const DOCTRINE_NAMES = Object.keys(DOCTRINES);

const has = (p, t) => p.titles.includes(t);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pull = (doctrine, key) => (doctrine[key] === undefined ? 0 : DOCTRINE_PULL * (doctrine[key] - 1));

/**
 * What a position is worth, judged at a three-move horizon.
 *
 * Everything here used to be priced over the whole remaining deck — a field
 * bought on round two was worth eleven harvests — which made building and
 * climbing overwhelmingly correct from the first turn and made fighting, a cost
 * now for a gain now, look like a waste. See src/engine/horizon.js.
 *
 * The split that matters is between things that pay *per round*, which are
 * worth what the next three rounds are worth, and things that only pay when the
 * deck runs out, which are worth almost nothing until it nearly has.
 */
function positionScore(p, view, traits, doctrine = {}) {
  const remaining = view.deckCount;
  const band = bandOf(p.fealty);
  const income = view.tuning?.landIncome ?? 1;
  const endgame = endgameWeight(remaining);
  let s = 0;
  s += p.gold * 0.55 * traits.greed;
  // A field is three harvests and a claim on the tie-break, not eleven harvests.
  s += p.lands * (streamValue(income, remaining) + 2.5 * endgame);
  // Standing is almost purely terminal: it buys band effects now and the throne
  // at the end, and the throne is the part worth having.
  s += p.fealty * (1.2 + 22 * endgame);
  // Not a flat rate per coronet: a Marshal and a Spymaster are not the same
  // prize, and now that titles change hands the difference decides whether one
  // is worth going after.
  s += p.titles.reduce((a, id) => a + TITLE_WORTH(id, view) * 0.45, 0);
  if (band === BAND.NEUTRAL) s += 0.5 * streamValue(view.tuning?.neutralIncome ?? 1, remaining);
  if (band === BAND.FAVORITE) s += 1.5;
  if (band === BAND.OUTLAW) s += 2 * traits.treachery;
  if (has(p, 'steward')) s += 0.6 * streamValue(view.tuning?.stewardIncome ?? 1, remaining);
  // A committed lane is worth something while there is game left to play, but
  // the crown goes to whoever stands highest when the deck runs out. Every
  // doctrine has to cash out eventually, so the lane bonus fades.
  if (doctrine.wantBand && band === doctrine.wantBand) {
    s += 5 * clamp(remaining / (0.45 * Math.max(1, view.deckStart ?? 12)), 0, 1);
  }
  return s;
}

/** Clone of a player snapshot with a few fields changed. */
const withChanges = (p, changes) => ({ ...p, titles: p.titles.slice(), ...changes });

function estimateDefense(target, view, ram = 0) {
  const t = view.tuning || {};
  // Walls are usually up, but roughly a third of the table has its army out.
  // Unless we know it is: the levy resolves before orders are sealed, so a
  // house that answered it is publicly undefended.
  let wall = target.noArmy ? 0 : (t.walls ?? 2) * 0.7;
  // A coat in my hand cracks the gate — so a house looks softer to a house that
  // is holding a turncoat token.
  if (ram && wall > 0) wall = Math.max(0, wall - ram);
  let d = wall;
  if (has(target, 'warden')) d += t.wardenBonus ?? 1;
  // A house might throw itself on the Crown's mercy and be shielded (§2/§5),
  // but only one that saw the blow coming actually will, which is rare. A small
  // hedge, not a blanket assumption everyone fortifies — that made the bots too
  // timid to raid at all.
  if (t.pledgeWall && target.gold >= (t.petitionCost ?? 2)) d += 0.25;
  return d;
}

function winChance(strength, estDef) {
  return clamp(0.5 + (strength - estDef) / 5, 0.05, 0.95);
}

function pactFor(view, me) {
  return view.pacts?.[me.id] || null;
}

/**
 * How much of `them`'s word this house is prepared to act on: 0 is "they are
 * certainly lying", 1 is "I would leave the gate open for them". Credulity sets
 * the ceiling and the ledger moves you within it, so a wolf who trusts you
 * completely still believes you less than a loyalist who barely knows you.
 */
function believes(view, traits, them) {
  const t = view.trust?.[`${view.me}>${them}`] ?? 0;
  return clamp((traits.credulity ?? 0.5) * (0.5 + t / 6), 0, 1);
}

/** What this house thinks of me, which is what decides who will work with me. */
function standingWith(view, them) {
  return view.trust?.[`${them}>${view.me}`] ?? 0;
}

/** Undertakings other houses have given me this round, weighted by belief. */
function wordGivenTo(view, traits, pid) {
  const out = { standDown: new Set(), coup: 0, support: 0 };
  for (const promise of view.promises || []) {
    if (promise.round !== view.round || promise.to !== pid) continue;
    const weight = believes(view, traits, promise.from);
    if (promise.kind === 'standDown' && weight > 0.4) out.standDown.add(promise.from);
    if (promise.kind === 'joinCoup') out.coup += weight;
    if (promise.kind === 'supportAttack' || promise.kind === 'supportDefense') out.support += weight;
  }
  return out;
}

/** What other houses have promised me this round. Promises, not guarantees. */
function pledgesTo(view, pid, traits) {
  let support = 0;
  let rivals = 0;
  for (const [who, pact] of Object.entries(view.pacts || {})) {
    if (who === pid || pact.with !== pid) continue;
    if (pact.kind === 'supportAttack' || pact.kind === 'supportDefense') support += pact.expected || 0;
    if (pact.kind === 'joinCoup') rivals += pact.expected || 0;
  }
  const word = wordGivenTo(view, traits, pid);
  return { support: support + word.support * 2, rivals: rivals + word.coup * 2, standDown: word.standDown };
}

/**
 * @param {string} personality
 * @param {string} doctrineName
 * @param {number} salt per-game tie-break salt. It must NOT be derived from
 *   seat order: a seat-keyed tie-break is a systematic seat advantage rather
 *   than noise, and it showed up as a 3:1 win-rate skew in tournament play.
 */
export function createAI(personality = 'schemer', doctrineName = 'opportunist', salt = 0) {
  const traits = TRAITS[personality] || TRAITS.schemer;
  const doctrine = DOCTRINES[doctrineName] || DOCTRINES.opportunist;

  /**
   * Score every legal order. Exposed so the diplomacy layer can ask "would a
   * bribe of this size actually change your mind?" instead of rolling dice.
   */
  function rankOrders(legal, view) {
    const me = view.players.find((p) => p.id === view.me);
    const others = view.players.filter((p) => p.id !== me.id);
    const t = view.tuning;
    const base = positionScore(me, view, traits, doctrine);
    const candidates = [];
    const pact = pactFor(view, me);
    // Who I have dealt with lately, and who has given me their word this round.
    const partners = new Set((view.deals || [])
      .filter((d) => view.round - d.round < 2)
      .flatMap((d) => [...Object.keys(d.offers || {}), ...Object.keys(d.takes || {})])
      .filter((x) => x !== me.id));
    const myWord = wordGivenTo(view, traits, me.id);
    const paid = pact ? pact.paid : 0;
    // A promise weighs less once the gold is already in hand: the treacherous
    // discount it hardest, which is where betrayal comes from.
    const kept = pact?.evaluating ? 1 : 1 - 0.35 * Math.min(1, traits.treachery);
    const pactPull = paid * 2.2 * kept;

    // ---- Petition / pardon -------------------------------------------------
    // Petitioning at the top of the track buys nothing; only a pardon still
    // does work down there.
    const petitionUseful = bandOf(me.fealty) === BAND.OUTLAW || me.fealty < FEALTY_MAX;
    if (legal.includes(ORDER.PETITION) && petitionUseful) {
      const outlaw = bandOf(me.fealty) === BAND.OUTLAW;
      const cost = outlaw ? t.pardonCost : t.petitionCost;
      const after = withChanges(me, {
        gold: me.gold - cost,
        fealty: outlaw ? 0 : clampFealty(me.fealty + 1),
      });
      let score = positionScore(after, view, traits, doctrine) - base;
      const crossing = !outlaw && (after.fealty === 2 || after.fealty === 3);
      if (crossing && !me.titleGrants[after.fealty] && unclaimed(view).length > 0) score += 5;
      // A pardon is how the shadow cashes out; do not let the lane bias block it.
      const laneOver = view.deckCount <= 0.45 * (view.deckStart ?? 12);
      score += outlaw && laneOver ? Math.abs(pull(doctrine, 'petition')) : pull(doctrine, 'petition');
      // Throw yourself on the Crown's mercy: if a spied order is coming for you,
      // pledging fealty fortifies the wall by what it costs and docks whoever
      // strikes. This is the counter to being beaten up for free — the reason a
      // loyalist thinks twice before hunting a house that can see them coming.
      if (t.pledgeWall) {
        const incoming = Object.entries(view.commitments)
          .some(([id, c]) => id !== me.id && c.order === ORDER.ATTACK && c.target === me.id);
        if (incoming) score += cost + 3;
      }
      candidates.push({ order: ORDER.PETITION, score, why: outlaw ? 'buy a pardon' : 'climb' });
    }

    // ---- Develop -----------------------------------------------------------
    if (legal.includes(ORDER.DEVELOP)) {
      const after = withChanges(me, { gold: me.gold - t.developCost, lands: me.lands + 1 });
      candidates.push({
        order: ORDER.DEVELOP,
        score: positionScore(after, view, traits, doctrine) - base + pull(doctrine, 'develop'),
        why: 'settle land',
      });
    }

    // ---- Attack a rival ----------------------------------------------------
    const ceiling = t.commitCap === null || t.commitCap === undefined
      ? me.gold : Math.min(me.gold, t.commitCap);

    if (legal.includes(ORDER.ATTACK)) {
      const ram = me.turncoat > 0 ? (t.turncoatWallBreak || 0) : 0;
      for (const target of others) {
        const estDef = estimateDefense(target, view, ram);
        const marshal = has(me, 'marshal') ? t.marshalBonus : 0;
        const punchDown = bandOf(me.fealty) === BAND.FAVORITE && target.fealty < me.fealty ? Math.round(me.fealty * t.punchDownScale) : 0;
        const need = Math.max(1, Math.ceil(estDef + 1 - marshal - punchDown));
        // Clamp rather than skip: a purse too thin to force the gate should
        // still weigh a doomed raid against its alternatives. Skipping left
        // bots whose only remaining candidate was a hopeless march on the
        // Crown, which they then committed for want of anything else.
        const spends = new Set([need, need + 1, need + 2].map((n) => Math.max(1, Math.min(ceiling, n))));
        for (const spend of spends) {
          const strength = spend + marshal + punchDown;
          const pWin = winChance(strength, estDef);
          const fealtyDelta = t.attackFealty[bandOf(target.fealty)];
          // A house with its gate open can be stripped of a coronet, not just a
          // field. Valuing every raid at one land was why the richest, most
          // decorated house on the board looked no more worth hitting than a
          // pauper — and it is the decorated ones the levy exposes.
          const coronet = target.noArmy
            ? target.titles.slice().sort((a, b) => TITLE_WORTH(b, view) - TITLE_WORTH(a, view))[0]
            : null;
          // Plunder is not optional and lands whatever else you take.
          const plunder = Math.min(t.spoilsGold || 0, target.gold);
          const win = withChanges(me, {
            gold: me.gold - spend + plunder,
            lands: me.lands + (target.lands > 0 && !coronet ? 1 : 0),
            titles: coronet ? [...me.titles, coronet] : me.titles,
            fealty: clampFealty(me.fealty + fealtyDelta),
          });
          const lose = withChanges(me, {
            gold: me.gold - spend,
            fealty: clampFealty(me.fealty + fealtyDelta),
          });
          let score = pWin * (positionScore(win, view, traits, doctrine) - base)
            + (1 - pWin) * (positionScore(lose, view, traits, doctrine) - base);
          // Attacking drops your own walls: exposure to everyone else.
          const menace = others.reduce((a, o) => a + (o.id === target.id ? 0 : o.gold), 0);
          score -= (0.10 + 0.02 * menace) * (1.4 + 0.6 * view.deckCount) / traits.nerve;
          score *= traits.aggression;
          score += pull(doctrine, 'attack');
          // What it costs to be seen doing it. Striking a house you have just
          // bargained with is the expensive kind of betrayal — you lose them and
          // you lose a little of everyone. A house already sure you are a snake
          // has nothing left to take away, so the treacherous ride cheaper.
          // The gain from a betrayal lands this move; what it costs you lands
          // over the next two, so it is worth what those two are worth. That
          // ratio *is* the decision — LATER is a shade under one, which is why
          // treachery is usually worth it and never free.
          if (myWord.standDown.has(target.id)) score -= 3.5 * LATER * (1 - 0.5 * traits.treachery);
          if (partners.has(target.id)) score -= 4.5 * LATER * (1 - 0.45 * traits.treachery);
          score -= Math.max(0, standingWith(view, target.id)) * 0.9 * LATER * (1 - 0.4 * traits.treachery);
          if (pact && pact.kind === 'attack' && pact.subject === target.id) score += pactPull;
          if (pact && pact.kind === 'standDown' && pact.with === target.id) score -= pactPull;
          candidates.push({ order: ORDER.ATTACK, target: target.id, gold: spend, score, why: `raid ${target.name}` });
        }
      }
    }

    // ---- Attack the Crown --------------------------------------------------
    if (legal.includes(ORDER.ATTACK)) {
      const marshal = has(me, 'marshal') ? t.marshalBonus : 0;
      // Support pledged to me joins *my* contribution, so it buys the throne
      // for me. A pledge to march alongside me does not — that ally is a rival
      // for the crown, which is exactly the deterrent §10 describes.
      const pledged = pledgesTo(view, me.id, traits);
      const allies = (pact && pact.kind === 'joinCoup' ? pact.expected || 0 : 0) + pledged.rivals;
      const spend = ceiling;
      const mine = spend + marshal + pledged.support * 0.7;
      // Somebody may throw gold behind the royal guard; nobody can see it.
      const loyalPurse = others.reduce((a, o) => Math.max(a, o.gold), 0);
      const defense = view.crownStrength;
      const hedged = defense + 0.35 * Math.min(loyalPurse, t.commitCap ?? loyalPurse);
      const pool = mine + allies * 0.7; // pledges are not binding
      if (mine > 0) {
        let score;
        if (pool > hedged && mine >= allies) {
          score = 1000; // clears the throne even if the court rallies behind it
        } else if (pool > defense && mine >= allies) {
          // Enough on paper, but one loyal purse turns it into a disaster:
          // −3 fealty and a forfeited land. Worth a gamble, not a certainty.
          score = 14 + (pool - defense) * 4;
        } else if (pool > defense) {
          score = -40; // we would only be winning it for somebody else
        } else {
          score = -60 - (defense - pool) * 3;
        }
        score *= traits.nerve;
        if (score > 0) score += pull(doctrine, 'coup') * 10;
        if (pact && pact.kind === 'joinCoup') score += pactPull;
        candidates.push({ order: ORDER.ATTACK, target: CROWN, gold: spend, score, why: 'seize the throne' });
      }
    }

    // ---- Support -----------------------------------------------------------
    if (legal.includes(ORDER.SUPPORT)) {
      // Guard the throne if somebody is rich enough to take it. Losing the
      // game outright is worth far more than the gold it costs to prevent.
      const richest = others.reduce((a, b) => (b.gold > a.gold ? b : a), others[0]);
      const theirReach = t.commitCap === null || t.commitCap === undefined
        ? richest.gold : Math.min(richest.gold, t.commitCap);
      const gap = theirReach + 1 - view.crownStrength; // what the guard is short by
      if (gap > -3) {
        const needed = clamp(Math.ceil(gap) + 1, 1, ceiling);
        const stake = base * 0.5 * traits.crownLove;
        for (const spend of new Set([1, Math.min(ceiling, 3), needed])) {
          if (spend < 1 || spend > ceiling) continue;
          const holds = spend >= needed;
          candidates.push({
            order: ORDER.SUPPORT,
            target: CROWN,
            gold: spend,
            score: (holds ? stake : stake * 0.25) * clamp(0.35 + gap * 0.12, 0.1, 1)
              - spend * 0.5 + pull(doctrine, 'support'),
            why: 'shield the throne',
          });
        }
      }
      if (pact && (pact.kind === 'supportAttack' || pact.kind === 'supportDefense')) {
        const spend = clamp(pact.expected || 2, 1, ceiling);
        candidates.push({
          order: ORDER.SUPPORT,
          target: pact.with,
          gold: spend,
          score: pactPull - spend * 0.6 + pull(doctrine, 'support'),
          why: 'honour a bargain',
        });
      }
      // Dig in. The only defence a house can raise on its own, and with a
      // repelled army forfeiting spoils it is not purely defensive: a gate that
      // holds takes a field off whoever tried it.
      //
      // Priced as an expectation, because a wall nobody tests is wasted gold.
      // Scored flat instead, the bots dug in on 16% of all orders — most of
      // them against an attack that never came — and fighting collapsed.
      {
        const reach = (o) => (t.commitCap == null ? o.gold : Math.min(o.gold, t.commitCap));
        const walls = me.noArmy ? 0 : t.walls;
        const prize = (h) => h.lands * 0.8
          + h.titles.reduce((x, id) => x + TITLE_WORTH(id, view) * 0.25, 0)
          + Math.min(h.gold, t.spoilsGold || 0) * 0.5;
        const mine = prize(me);
        const able = others.filter((o) => reach(o) > walls);
        const rivals = others.reduce((x, o) => x + prize(o), 0) / Math.max(1, others.length);
        // Roughly: somebody has to be able to force the gate, and I have to be
        // the most tempting thing on the board for it to be me.
        const odds = able.length
          ? clamp(0.3 * (mine / Math.max(1, rivals)) * (able.length / Math.max(1, others.length)), 0, 0.6)
          : 0;
        const strongest = able.reduce((m, o) => Math.max(m, reach(o)), 0);
        for (const spend of new Set([Math.min(2, ceiling), clamp(strongest - walls + 1, 1, ceiling)])) {
          if (spend < 1 || spend > ceiling || odds <= 0) continue;
          const holds = spend + walls >= strongest;
          const saved = mine * (holds ? 0.85 : 0.3);
          const bounty = holds && t.repelSpoils ? 3.5 : 0;
          candidates.push({
            order: ORDER.SUPPORT,
            target: me.id,
            gold: spend,
            score: odds * (saved + bounty) - spend * 0.55 + pull(doctrine, 'support') * 0.3,
            why: 'dig in',
          });
        }
      }
      // Hold a wall for somebody you trust. It is the cheapest thing in the
      // game that buys you a friend, and unlike shielding the throne it makes a
      // specific house owe you rather than nobody at all.
      for (const ally of others) {
        const t2 = standingWith(view, ally.id);
        const mutual = believes(view, traits, ally.id);
        if (t2 < 0.5 && mutual < 0.5) continue;
        const spend = clamp(2, 1, ceiling);
        candidates.push({
          order: ORDER.SUPPORT,
          target: ally.id,
          gold: spend,
          score: (t2 + mutual * 2) * 1.1 * LATER - spend * 0.55 + pull(doctrine, 'support'),
          why: `stand with ${ally.name}`,
        });
      }
      // And keep your own word, if you gave it.
      for (const promise of view.promises || []) {
        if (promise.round !== view.round || promise.from !== me.id) continue;
        if (promise.kind !== 'supportAttack' && promise.kind !== 'supportDefense') continue;
        const spend = clamp(2, 1, ceiling);
        candidates.push({
          order: ORDER.SUPPORT,
          target: promise.to,
          gold: spend,
          // Breaking your word costs 2 trust with them and 1 with everybody
          // else. The treacherous discount that; nobody ignores it.
          // Keeping your word buys credit you spend later, so it is discounted
          // exactly as the betrayal that would break it is.
          score: 5 * LATER * (1 - 0.5 * traits.treachery) - spend * 0.5 + pull(doctrine, 'support'),
          why: 'keep your word',
        });
      }
    }

    // ---- Ransom (§9) -------------------------------------------------------
    if (legal.includes(ORDER.RANSOM)) {
      for (const target of others) {
        const delta = t.attackFealty[bandOf(target.fealty)];
        const after = withChanges(me, {
          gold: me.gold + Math.min(t.ransomTake, target.gold),
          fealty: clampFealty(me.fealty + delta),
        });
        candidates.push({
          order: ORDER.RANSOM,
          target: target.id,
          score: (positionScore(after, view, traits, doctrine) - base) * 0.9,
          why: `shake down ${target.name}`,
        });
      }
      const afterCrown = withChanges(me, { gold: me.gold + t.ransomCrownGold, fealty: -3 });
      candidates.push({
        order: ORDER.RANSOM,
        target: CROWN,
        score: (positionScore(afterCrown, view, traits, doctrine) - base) * 0.9,
        why: 'rob the Crown',
      });
    }

    if (legal.includes(ORDER.HOLD)) candidates.push({ order: ORDER.HOLD, score: -0.01, why: 'wait' });

    // Deterministic jitter keyed off the visible board so bots do not all
    // converge on identical lines.
    const jitter = (c, i) => (((salt + 1) * 7 + i * 13 + view.round * 3 + (c.gold || 0)) % 5) * 0.12;
    candidates.forEach((c, i) => { c.score += jitter(c, i); });
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  function chooseOrder(request, view) {
    const ranked = rankOrders(request.legal, view);
    if (ranked.length === 0) return { order: request.legal[0] };
    const best = ranked[0];
    return { order: best.order, target: best.target ?? null, gold: best.gold ?? 0 };
  }

  function unclaimed(view) {
    const held = new Set(view.players.flatMap((p) => p.titles));
    return TITLES.filter((t) => !held.has(t.id)).map((t) => t.id);
  }

  /**
   * The levy asks for your host, not your purse. Serving costs you the round —
   * no attack, and no walls, so anything you hold is open. Refusing costs
   * standing, which is the whole inheritance race.
   */
  function chooseLevy(request, view) {
    const me = view.players.find((p) => p.id === view.me);
    const drop = request.refusalCost ?? 2;
    const lost = me.fealty - clampFealty(me.fealty - drop);
    if (lost === 0) return 'refuse'; // at the floor, refusing is free

    const lateness = 1 - view.deckCount / Math.max(1, view.deckStart ?? 12);
    let serveWorth = lost * (2 + 9 * lateness) * (doctrine.levyPay ?? 1);
    // Falling out of the band you are playing for costs more than the steps.
    const after = bandOf(clampFealty(me.fealty - drop));
    if (doctrine.wantBand && after !== doctrine.wantBand && bandOf(me.fealty) === doctrine.wantBand) serveWorth += 7;
    if (after === BAND.OUTLAW && bandOf(me.fealty) !== BAND.OUTLAW && doctrine.wantBand !== BAND.OUTLAW) serveWorth += 5;
    // A grant you have not spent yet is worth staying up for.
    if (me.fealty >= 2 && !me.titleGrants?.[me.fealty >= 3 ? 3 : 2]) serveWorth += 6;

    // What an army is worth this round: the strike you cannot make, and the
    // coronet you cannot defend.
    let refuseWorth = 2.2 * traits.aggression * (doctrine.attack ?? 1);
    refuseWorth += me.titles.reduce((a, t) => a + (TITLE_WORTH(t, view) > 8 ? 3 : 1.5), 0);
    refuseWorth += Math.min(3, me.lands * 0.5);
    // Nobody is coming for a pauper's gate.
    const predators = view.players.filter((p) => p.id !== me.id && p.gold >= 3).length;
    if (predators === 0) refuseWorth *= 0.4;

    if (doctrine.wantBand === BAND.OUTLAW && me.fealty > -2) return 'refuse';
    if (!doctrine.wantBand && traits.treachery > 0.9 && me.fealty <= 0 && view.deckCount > 4) return 'refuse';
    return serveWorth >= refuseWorth ? 'serve' : 'refuse';
  }

  function chooseTitle(request, view) {
    const me = view.players.find((p) => p.id === view.me);
    const pref = ['herald', 'marshal', 'steward', 'warden', 'spymaster', 'chancellor'];
    if (traits.greed > 1.2) pref.unshift('steward');
    if (traits.aggression > 1.2 || doctrine.attack > 1.4) pref.unshift('marshal');
    if (bandOf(me.fealty) === BAND.OUTLAW || doctrine.wantBand === BAND.OUTLAW) pref.unshift('chancellor');
    if (doctrine.support > 1.4) pref.unshift('warden');
    const rank = (t) => {
      const i = pref.indexOf(t);
      return i === -1 ? pref.length : i;
    };
    const free = request.available.slice().sort((a, b) => rank(a) - rank(b))[0];
    const taken = (request.claimable || []).map((c) => c.title).sort((a, b) => rank(a) - rank(b))[0];
    if (!taken) return free;
    if (!free) return taken;
    // Taking one off somebody costs coin and makes an enemy, so it has to be a
    // real upgrade rather than a marginal one.
    const gap = TITLE_WORTH(taken, view) - TITLE_WORTH(free, view);
    const cost = request.claimCost ?? 2;
    return gap > cost * (1.4 / Math.max(0.4, traits.treachery)) ? taken : free;
  }

  /**
   * How good a bargain has to be before this house will sign it. A stranger
   * needs to pay a little; somebody who has burned you needs to pay a great
   * deal, and past a point there is no number that works. That is what "less
   * likely to work with you" means in practice — the conniving still pays, but
   * the next deal costs you more than the last one made.
   */
  function dealFloor(request, view) {
    const table = request.table || {};
    const involved = [...new Set([
      ...Object.keys(table.offers || {}), ...Object.keys(table.takes || {}),
    ])].filter((x) => x !== view.me);
    if (!involved.length) return 0.5;
    const worst = Math.min(...involved.map((x) => view.trust?.[`${view.me}>${x}`] ?? 0));
    if (worst <= -2.5) return Infinity; // nothing they can offer
    // −3 to +3 maps to a floor of about 9 gold down to nothing.
    return clamp(0.5 - worst * 3 * (1 - (traits.credulity ?? 0.5) * 0.5), 0, 12);
  }

  function chooseSpoils(request, view) {
    const loser = view.players.find((p) => p.id === request.loser);
    const bestTitle = request.titles.slice().sort((a, b) => TITLE_WORTH(b, view) - TITLE_WORTH(a, view))[0];
    const landWorth = streamValue(view.tuning?.landIncome ?? 1, view.deckCount)
      + 2.5 * endgameWeight(view.deckCount);
    if (request.landsAvailable === false || TITLE_WORTH(bestTitle, view) > landWorth) {
      return { kind: 'title', title: bestTitle };
    }
    if (loser && loser.lands <= 0) return { kind: 'title', title: bestTitle };
    return { kind: 'land' };
  }

  function choosePeekKind(request, view) {
    // Knowing the next card matters most when the deck is nearly out.
    return view.deckCount <= 3 ? 'card' : 'order';
  }

  function choosePeekTarget(request, view) {
    const scored = request.options
      .map((id) => view.players.find((p) => p.id === id))
      .sort((a, b) => positionScore(b, view, traits, doctrine) - positionScore(a, view, traits, doctrine));
    return scored[0].id;
  }

  function chooseTurncoat(request, view) {
    const me = view.players.find((p) => p.id === view.me);
    const mine = view.commitments[me.id];
    const t = view.tuning || {};
    // Somebody we peeked at is coming for us.
    const incoming = Object.entries(view.commitments)
      .filter(([id, c]) => id !== me.id && c.order === ORDER.ATTACK && c.target === me.id);
    if (incoming.length) {
      // We are the one in the field: pull the sword back to hold the gate.
      if (mine?.order === ORDER.ATTACK && mine.target !== CROWN) return { action: 'change' };
      // Or throw ourselves on the Crown's mercy — a pledge shields us and docks
      // the striker — if we can afford it and are not already pledging.
      const cost = bandOf(me.fealty) === BAND.OUTLAW ? t.pardonCost : t.petitionCost;
      const canPledge = t.pledgeWall && me.gold >= cost && bandOf(me.fealty) !== BAND.FAVORITE;
      if (canPledge && mine?.order !== ORDER.PETITION) return { action: 'change' };
    }
    // Otherwise hold the token: it is a battering ram in an attack, and worth
    // gold to somebody at the deal table.
    return { action: 'none' };
  }

  /**
   * One proposal per round, before orders are sealed. The interesting one is
   * buying the support a coup needs: support aimed at an attacker counts toward
   * *their* strength, so a bought sword crowns the buyer, not the seller. That
   * is the only route to the throne that is not simply out-hoarding the table.
   *
   * What is offered is goods. What is said about it is words.
   */
  function chooseDeal(request, view) {
    const me = view.players.find((p) => p.id === view.me);
    const others = view.players.filter((p) => p.id !== me.id);
    const t = view.tuning;
    const cap = t.commitCap ?? me.gold;
    const ceiling = Math.min(me.gold, cap);
    const marshal = has(me, 'marshal') ? t.marshalBonus : 0;
    const defense = view.crownStrength;

    const offer = (to, gold, promise = null) => ({
      transfers: [{ from: me.id, to, goods: { ...emptyGoods(), gold } }],
      promise,
    });

    // Before any of that: is there somebody worth giving my word to?
    //
    // A promise is free and binds nobody, which is exactly why it is worth
    // something — it costs 2 trust with them and 1 with the whole court to
    // break, so a house that keeps giving its word and keeping it becomes the
    // one everybody deals with. The honest make the promise because they mean
    // to keep it; the treacherous make it because it is cheap and they intend
    // to sell it. Both are playing the game as designed.
    const word = (() => {
      // A word given every round to everybody is not worth having. These only
      // fire when there is something specific to buy with one.
      const dangerous = others.filter((o) => {
        const reach = Math.min(o.gold, cap);
        return reach > t.walls + 2 && o.gold > me.gold * 0.8;
      });
      // Somebody who could actually force my gate, and does not yet owe me
      // anything: buy a quiet round by undertaking to leave them alone.
      const threat = dangerous.sort((a, b) => b.gold - a.gold)[0];
      if (threat && standingWith(view, threat.id) < 0.5 && me.lands >= 2 && me.gold < threat.gold) {
        return { to: threat.id, kind: 'standDown' };
      }
      // Or shore up the one house I already deal with, so they hold my wall
      // when it matters — but only once there is a wall worth holding.
      const friend = others
        .filter((o) => believes(view, traits, o.id) > 0.7 && standingWith(view, o.id) > 0.75)
        .sort((a, b) => standingWith(view, b.id) - standingWith(view, a.id))[0];
      // Only undertake to hold somebody's wall if holding it is affordable.
      // Promising what you cannot pay for is how a house talks itself into a
      // reputation it did not want.
      if (friend && view.deckCount < 8 && me.gold >= 8) return { to: friend.id, kind: 'supportDefense' };
      return null;
    })();

    // Can I take the throne if somebody lends me their sword?
    const reachAlone = ceiling + marshal;
    if (reachAlone > 2 && reachAlone <= defense + 2) {
      const allies = others.filter((o) => o.gold >= 2).sort((a, b) => b.gold - a.gold);
      for (const ally of allies) {
        const bribe = clamp(Math.ceil(ally.gold * 0.4), 1, Math.max(1, me.gold - 2));
        const theirSpend = Math.min(ally.gold, cap);
        if (reachAlone - bribe + theirSpend > defense + 1) {
          if (theirSpend <= 0) continue;
          // Only give your word to march if you will still be able to: paying
          // the bribe takes the gold out of your own purse, and a house that
          // promises a coup it can no longer afford breaks its word by
          // accident, which the court cannot tell from breaking it on purpose.
          //
          // This gate does not move the number much. A coup pact is kept about
          // one time in ten, and that is not a bug in the arithmetic — it is
          // the coup logic refusing to march when marching would crown
          // somebody else, which is the correct read of §10 and the single
          // most realistic thing the bots do. The promise is worth making
          // anyway; it is just worth very little to believe.
          const afterBribe = Math.min(me.gold - bribe, cap) + marshal;
          const stillMarching = afterBribe > 0 && afterBribe + theirSpend > defense;
          return offer(ally.id, bribe, stillMarching ? { to: ally.id, kind: 'joinCoup' } : word);
        }
      }
    }

    // Buy a turncoat token off an outlaw: a change of orders after the peek is
    // worth real gold, and the shadow rarely has a better use for it.
    const tokenHolder = others.find((o) => o.turncoat > 0);
    if (tokenHolder && me.gold >= 4 && traits.treachery > 0.7) {
      return {
        transfers: [
          { from: me.id, to: tokenHolder.id, goods: { ...emptyGoods(), gold: 3 } },
          { from: tokenHolder.id, to: me.id, goods: { ...emptyGoods(), turncoat: 1 } },
        ],
      };
    }

    // Otherwise pay somebody else to bloody the runaway heir, since striking a
    // favorite personally costs two standing.
    const heir = others.slice().sort((a, b) => b.fealty - a.fealty)[0];
    if (heir && heir.fealty >= 2 && me.fealty < heir.fealty && me.gold >= 4) {
      const hireling = others.filter((o) => o.id !== heir.id && o.gold >= 2).sort((a, b) => b.gold - a.gold)[0];
      if (hireling) {
        const gold = clamp(Math.floor(me.gold * 0.3), 1, 5);
        return offer(hireling.id, gold, word);
      }
    }
    // No goods worth moving, but a word costs nothing to give.
    return word ? { transfers: [], promise: word } : null;
  }

  /**
   * Judge a deal put to me. Goods are weighed against what they cost; a stated
   * intention adds nothing on its own, because anybody can say anything.
   */
  function considerDeal(request, view) {
    const me = view.players.find((p) => p.id === view.me);
    const remaining = view.deckCount;
    const worth = (goods) => {
      if (!goods) return 0;
      let v = goods.gold || 0;
      v += (goods.lands || 0)
        * (streamValue(view.tuning?.landIncome ?? 1, remaining) + 2.5 * endgameWeight(remaining));
      v += ((goods.titles || []).length) * 6;
      v += (goods.turncoat || 0) * 3 * Math.max(0.6, traits.treachery);
      return v;
    };
    let net = 0;
    for (const transfer of request.deal.transfers || []) {
      if (transfer.to === me.id) net += worth(transfer.goods);
      if (transfer.from === me.id) net -= worth(transfer.goods);
    }
    // Giving up a title is close to unthinkable unless the price is silly.
    const losingTitle = (request.deal.transfers || [])
      .some((x) => x.from === me.id && (x.goods?.titles || []).length);
    const bar = losingTitle ? 8 : 0.5;
    return { accept: net > bar, line: net > bar ? 'Agreed.' : 'Not for that.' };
  }

  function decide(request, view) {
    switch (request.type) {
      case 'proposeDeal': return chooseDeal(request, view);
      case 'deal': return considerDeal(request, view);
      case 'dealTable': return { accept: request.balance > dealFloor(request, view) };
      case 'order': return chooseOrder(request, view);
      case 'levy': return chooseLevy(request, view);
      case 'title': return chooseTitle(request, view);
      case 'spoils': return chooseSpoils(request, view);
      case 'peekChoice': return choosePeekKind(request, view);
      case 'peekTarget': return choosePeekTarget(request, view);
      case 'turncoat': return chooseTurncoat(request, view);
      default: return null;
    }
  }

  return {
    kind: 'ai',
    personality,
    doctrine: doctrineName,
    traits,
    decide,
    rankOrders,
    positionScore: (p, v) => positionScore(p, v, traits, doctrine),
  };
}

/** A per-game, per-seat salt that varies with the seed rather than with the seat. */
export function saltFor(seed, seat) {
  let h = (seed >>> 0) ^ ((seat + 1) * 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export { TRAITS, DOCTRINES, positionScore };
