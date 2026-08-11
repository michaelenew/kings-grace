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

const TRAITS = {
  loyalist: { aggression: 0.55, greed: 0.9, treachery: 0.3, nerve: 0.7, crownLove: 1.6 },
  merchant: { aggression: 0.7, greed: 1.5, treachery: 0.5, nerve: 0.8, crownLove: 1.0 },
  schemer: { aggression: 1.0, greed: 1.0, treachery: 1.0, nerve: 1.2, crownLove: 0.7 },
  wolf: { aggression: 1.5, greed: 0.85, treachery: 1.3, nerve: 1.45, crownLove: 0.4 },
};

/** How hard a doctrine pulls a bot toward its lane, in score points. */
const DOCTRINE_PULL = 7;

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

/** How much a position is worth to the bot holding it. */
function positionScore(p, view, traits, doctrine = {}) {
  const remaining = view.deckCount;
  const lateness = 1 - remaining / Math.max(1, view.deckStart ?? 12);
  const band = bandOf(p.fealty);
  const income = view.tuning?.landIncome ?? 1;
  let s = 0;
  s += p.gold * 0.55 * traits.greed;
  s += p.lands * (1.4 + 0.75 * remaining * income);
  s += p.fealty * (3 + 20 * lateness); // the inheritance clock
  s += p.titles.length * 4;
  if (band === BAND.NEUTRAL) s += 0.5 * remaining * (view.tuning?.neutralIncome ?? 1);
  if (band === BAND.FAVORITE) s += 1.5;
  if (band === BAND.OUTLAW) s += 2 * traits.treachery;
  if (has(p, 'steward')) s += 0.6 * remaining;
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

function estimateDefense(target, view) {
  // Walls are usually up, but roughly a third of the table has its army out.
  const walls = view.tuning?.walls ?? 2;
  let d = walls * 0.7;
  if (has(target, 'warden')) d += view.tuning?.wardenBonus ?? 1;
  return d;
}

function winChance(strength, estDef) {
  return clamp(0.5 + (strength - estDef) / 5, 0.05, 0.95);
}

function pactFor(view, me) {
  return view.pacts?.[me.id] || null;
}

/** What other houses have promised me this round. Promises, not guarantees. */
function pledgesTo(view, pid) {
  let support = 0;
  let rivals = 0;
  for (const [who, pact] of Object.entries(view.pacts || {})) {
    if (who === pid || pact.with !== pid) continue;
    if (pact.kind === 'supportAttack' || pact.kind === 'supportDefense') support += pact.expected || 0;
    if (pact.kind === 'joinCoup') rivals += pact.expected || 0;
  }
  return { support, rivals };
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
      for (const target of others) {
        const estDef = estimateDefense(target, view);
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
          const win = withChanges(me, {
            gold: me.gold - spend,
            lands: me.lands + (target.lands > 0 ? 1 : 0),
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
      const pledged = pledgesTo(view, me.id);
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

  function chooseLevy(request, view) {
    const me = view.players.find((p) => p.id === view.me);
    if (me.fealty <= -3) return 'fealty'; // the drop costs nothing at the floor
    if (me.gold < request.cost) return 'fealty';
    const lateness = 1 - view.deckCount / Math.max(1, view.deckStart ?? 12);
    const fealtyWorth = (3 + 20 * lateness) * (doctrine.levyPay ?? 1);
    const goldWorth = request.cost * 0.55 * traits.greed + (me.gold <= request.cost + 1 ? 4 : 0);
    const laneStillOn = view.deckCount > 0.45 * (view.deckStart ?? 12);
    if (doctrine.wantBand === BAND.OUTLAW && me.fealty > -2 && laneStillOn) return 'fealty';
    if (doctrine.wantBand === BAND.NEUTRAL && me.fealty <= -1) return 'pay';
    // Diving to outlaw is a real strategy for the treacherous.
    if (!doctrine.wantBand && traits.treachery > 0.9 && me.fealty <= 0 && view.deckCount > 4) return 'fealty';
    return fealtyWorth > goldWorth ? 'pay' : 'fealty';
  }

  function chooseTitle(request, view) {
    const me = view.players.find((p) => p.id === view.me);
    const pref = ['herald', 'marshal', 'steward', 'warden', 'spymaster', 'chancellor'];
    if (traits.greed > 1.2) pref.unshift('steward');
    if (traits.aggression > 1.2 || doctrine.attack > 1.4) pref.unshift('marshal');
    if (bandOf(me.fealty) === BAND.OUTLAW || doctrine.wantBand === BAND.OUTLAW) pref.unshift('chancellor');
    if (doctrine.support > 1.4) pref.unshift('warden');
    return pref.find((t) => request.available.includes(t)) || request.available[0];
  }

  function chooseSpoils(request, view) {
    const loser = view.players.find((p) => p.id === request.loser);
    const worth = { herald: 6, marshal: 5, steward: 4 + view.deckCount * 0.4, warden: 4, spymaster: 3, chancellor: 3 };
    const bestTitle = request.titles.slice().sort((a, b) => (worth[b] || 3) - (worth[a] || 3))[0];
    const landWorth = 1.4 + 0.75 * view.deckCount * (view.tuning?.landIncome ?? 1);
    if (request.landsAvailable === false || (worth[bestTitle] || 3) > landWorth) {
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
    // Somebody we peeked at is coming for us and we are in the field: pull back.
    const incoming = Object.entries(view.commitments)
      .filter(([id, c]) => id !== me.id && c.order === ORDER.ATTACK && c.target === me.id);
    if (incoming.length && mine?.order === ORDER.ATTACK && mine.target !== CROWN) {
      return { action: 'change' };
    }
    // Otherwise sell the favour to whoever has been generous.
    const benefactors = request.others
      .map((id) => ({ id, gold: view.goodwill?.[`${id}>${me.id}`] || 0 }))
      .sort((a, b) => b.gold - a.gold);
    if (benefactors[0] && benefactors[0].gold >= 3) return { action: 'give', to: benefactors[0].id };
    return { action: 'none' };
  }

  /**
   * One proposal per round, before orders are sealed. The interesting one is
   * buying the support a coup needs: support aimed at an attacker counts
   * toward *their* strength, so a bought sword crowns the buyer, not the
   * seller. That is the only way a throne gets taken by anyone who did not
   * simply out-hoard the table.
   */
  function chooseParley(request, view) {
    const me = view.players.find((p) => p.id === view.me);
    const others = view.players.filter((p) => p.id !== me.id);
    const t = view.tuning;
    const ceiling = t.commitCap === null || t.commitCap === undefined ? me.gold : Math.min(me.gold, t.commitCap);
    const marshal = has(me, 'marshal') ? t.marshalBonus : 0;
    const defense = view.crownStrength;

    // Can I take the throne if somebody lends me their purse?
    const reachAlone = ceiling + marshal;
    if (reachAlone > 2 && reachAlone <= defense + 2) {
      const candidates = others
        .filter((o) => o.gold >= 2)
        .sort((a, b) => b.gold - a.gold);
      for (const ally of candidates) {
        const bribe = clamp(Math.ceil(ally.gold * 0.4), 1, Math.max(1, me.gold - 2));
        const theirSpend = ally.gold; // they will be paid, then asked to spend their own
        if (reachAlone - bribe + theirSpend > defense + 1) {
          return {
            to: ally.id,
            kind: 'supportAttack',
            gold: bribe,
            expected: theirSpend,
          };
        }
      }
    }

    // Otherwise pay somebody else to bloody the runaway heir, since striking a
    // favorite personally costs two standing.
    const heir = others.slice().sort((a, b) => b.fealty - a.fealty)[0];
    if (heir && heir.fealty >= 2 && me.fealty < heir.fealty && me.gold >= 4) {
      const hireling = others
        .filter((o) => o.id !== heir.id && o.gold >= 2)
        .sort((a, b) => b.gold - a.gold)[0];
      if (hireling) {
        return { to: hireling.id, kind: 'attack', subject: heir.id, gold: clamp(Math.floor(me.gold * 0.3), 1, 5) };
      }
    }
    return null;
  }

  function considerOffer(request, view) {
    // Bots evaluate offers through rankOrders in diplomacy.js; this branch only
    // fires when a bot is asked directly, which the engine does not do today.
    return { accept: false };
  }

  function decide(request, view) {
    switch (request.type) {
      case 'parley': return chooseParley(request, view);
      case 'offer': return considerOffer(request, view);
      case 'order': return chooseOrder(request, view);
      case 'levy': return chooseLevy(request, view);
      case 'title': return chooseTitle(request, view);
      case 'spoils': return chooseSpoils(request, view);
      case 'peekChoice': return choosePeekKind(request, view);
      case 'peekTarget': return choosePeekTarget(request, view);
      case 'turncoat': return chooseTurncoat(request, view);
      case 'turncoatGranted': {
        const me = view.players.find((p) => p.id === view.me);
        const mine = view.commitments[me.id];
        const threatened = Object.entries(view.commitments)
          .some(([id, c]) => id !== me.id && c.order === ORDER.ATTACK && c.target === me.id);
        return threatened && mine?.order === ORDER.ATTACK ? { action: 'change' } : { action: 'none' };
      }
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
