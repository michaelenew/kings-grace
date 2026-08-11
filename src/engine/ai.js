// Bot controllers. Heuristic, deterministic given the game's seeded RNG.
//
// The bots see exactly what a player in their seat is entitled to see: the
// public board plus anything they legitimately peeked at. They never read the
// crown deck or unrevealed orders.

import {
  BAND, COSTS, CROWN, ORDER, SETUP, TITLES, bandOf, clampFealty,
} from './constants.js';

const TRAITS = {
  loyalist: { aggression: 0.55, greed: 0.9, treachery: 0.3, nerve: 0.7, crownLove: 1.6 },
  merchant: { aggression: 0.7, greed: 1.5, treachery: 0.5, nerve: 0.8, crownLove: 1.0 },
  schemer: { aggression: 1.0, greed: 1.0, treachery: 1.0, nerve: 1.2, crownLove: 0.7 },
  wolf: { aggression: 1.5, greed: 0.85, treachery: 1.3, nerve: 1.45, crownLove: 0.4 },
};

const has = (p, t) => p.titles.includes(t);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** How much a position is worth to the bot holding it. */
function positionScore(p, view, traits) {
  const remaining = view.deckCount;
  const lateness = 1 - remaining / 12;
  const band = bandOf(p.fealty);
  let s = 0;
  s += p.gold * 0.55 * traits.greed;
  s += p.lands * (1.4 + 0.75 * remaining);
  s += p.fealty * (3 + 20 * lateness); // the inheritance clock
  s += p.titles.length * 4;
  if (band === BAND.NEUTRAL) s += 0.5 * remaining;
  if (band === BAND.FAVORITE) s += 1.5;
  if (band === BAND.OUTLAW) s += 2 * traits.treachery;
  if (has(p, 'steward')) s += 0.6 * remaining;
  return s;
}

/** Clone of a player snapshot with a few fields changed. */
const withChanges = (p, changes) => ({ ...p, titles: p.titles.slice(), ...changes });

function estimateDefense(target) {
  // Walls are usually up, but roughly a third of the table has its army out.
  let d = 1.4;
  if (has(target, 'warden')) d += 1;
  return d;
}

function winChance(strength, estDef) {
  return clamp(0.5 + (strength - estDef) / 5, 0.05, 0.95);
}

function fealtyLeader(view) {
  return view.players.slice().sort((a, b) => b.fealty - a.fealty || b.lands - a.lands || b.gold - a.gold)[0];
}

function pactFor(view, me) {
  return view.pacts?.[me.id] || null;
}

export function createAI(personality = 'schemer') {
  const traits = TRAITS[personality] || TRAITS.schemer;

  /**
   * Score every legal order. Exposed so the diplomacy layer can ask "would a
   * bribe of this size actually change your mind?" instead of rolling dice.
   */
  function rankOrders(legal, view) {
    const me = view.players.find((p) => p.id === view.me);
    const others = view.players.filter((p) => p.id !== me.id);
    const base = positionScore(me, view, traits);
    const candidates = [];
    const pact = pactFor(view, me);
    const paid = pact ? pact.paid : 0;
    // A promise weighs less once the gold is already in hand: the treacherous
    // discount it hardest, which is where betrayal comes from.
    const kept = pact?.evaluating ? 1 : 1 - 0.35 * Math.min(1, traits.treachery);
    const pactPull = paid * 2.2 * kept;

    // ---- Petition / pardon -------------------------------------------------
    if (legal.includes(ORDER.PETITION)) {
      const outlaw = bandOf(me.fealty) === BAND.OUTLAW;
      const cost = outlaw ? COSTS.PARDON : COSTS.PETITION;
      const after = withChanges(me, {
        gold: me.gold - cost,
        fealty: outlaw ? 0 : clampFealty(me.fealty + 1),
      });
      let score = positionScore(after, view, traits) - base;
      const crossing = !outlaw && (after.fealty === 2 || after.fealty === 3);
      const grantOpen = crossing && !me.titleGrants[after.fealty] && unclaimed(view).length > 0;
      if (grantOpen) score += 5;
      candidates.push({ order: ORDER.PETITION, score, why: outlaw ? 'buy a pardon' : 'climb' });
    }

    // ---- Develop -----------------------------------------------------------
    if (legal.includes(ORDER.DEVELOP)) {
      const after = withChanges(me, { gold: me.gold - COSTS.DEVELOP, lands: me.lands + 1 });
      candidates.push({
        order: ORDER.DEVELOP,
        score: positionScore(after, view, traits) - base,
        why: 'settle land',
      });
    }

    // ---- Attack a rival ----------------------------------------------------
    if (legal.includes(ORDER.ATTACK)) {
      for (const t of others) {
        const estDef = estimateDefense(t);
        const marshal = has(me, 'marshal') ? 1 : 0;
        const punchDown = bandOf(me.fealty) === BAND.FAVORITE && t.fealty < me.fealty ? me.fealty : 0;
        const need = Math.max(1, Math.ceil(estDef + 1 - marshal - punchDown));
        for (const spend of new Set([need, need + 1, Math.min(me.gold, need + 2)])) {
          if (spend < 1 || spend > me.gold) continue;
          const strength = spend + marshal + punchDown;
          const pWin = winChance(strength, estDef);
          const fealtyDelta = bandOf(t.fealty) === BAND.FAVORITE ? -2 : bandOf(t.fealty) === BAND.OUTLAW ? 1 : 0;
          const win = withChanges(me, {
            gold: me.gold - spend,
            lands: me.lands + (t.lands > 0 ? 1 : 0),
            fealty: clampFealty(me.fealty + fealtyDelta),
          });
          const lose = withChanges(me, {
            gold: me.gold - spend,
            fealty: clampFealty(me.fealty + fealtyDelta),
          });
          let score = pWin * (positionScore(win, view, traits) - base)
            + (1 - pWin) * (positionScore(lose, view, traits) - base);
          // Attacking drops your own walls: exposure to everyone else.
          const menace = others.reduce((a, o) => a + (o.id === t.id ? 0 : o.gold), 0);
          score -= (0.10 + 0.02 * menace) * (1.4 + 0.6 * view.deckCount) / traits.nerve;
          score *= traits.aggression;
          if (pact && pact.kind === 'attack' && pact.subject === t.id) score += pactPull;
          if (pact && pact.kind === 'standDown' && pact.with === t.id) score -= pactPull;
          candidates.push({ order: ORDER.ATTACK, target: t.id, gold: spend, score, why: `raid ${t.name}` });
        }
      }
    }

    // ---- Attack the Crown --------------------------------------------------
    if (legal.includes(ORDER.ATTACK)) {
      const marshal = has(me, 'marshal') ? 1 : 0;
      const allies = pact && pact.kind === 'joinCoup' ? pact.expected || 0 : 0;
      const spend = me.gold;
      const mine = spend + marshal;
      const pool = mine + allies * 0.7; // pledges are not binding
      // Somebody may throw gold behind the royal guard; nobody can see it.
      const loyalPurse = others.reduce((a, o) => Math.max(a, o.gold), 0);
      const defense = view.crownStrength;
      const hedged = defense + 0.35 * loyalPurse;
      if (mine > 0) {
        let score;
        if (pool > hedged && mine >= allies) {
          score = 1000; // the throne, outright
        } else if (pool > defense && mine >= allies) {
          score = 220; // probably enough, unless the court rallies
        } else if (pool > defense) {
          score = -40; // we would only be winning it for somebody else
        } else {
          score = -60 - (defense - pool) * 3;
        }
        score *= traits.nerve;
        if (pact && pact.kind === 'joinCoup') score += pactPull;
        candidates.push({ order: ORDER.ATTACK, target: CROWN, gold: spend, score, why: 'seize the throne' });
      }
    }

    // ---- Support -----------------------------------------------------------
    if (legal.includes(ORDER.SUPPORT)) {
      // Guard the throne if somebody is rich enough to take it. Losing the
      // game outright is worth far more than the gold it costs to prevent.
      const richest = others.reduce((a, b) => (b.gold > a.gold ? b : a), others[0]);
      const gap = richest.gold + 1 - view.crownStrength; // what the guard is short by
      if (gap > -3) {
        const needed = clamp(Math.ceil(gap) + 1, 1, me.gold);
        const stake = base * 0.5 * traits.crownLove;
        for (const spend of new Set([1, Math.min(me.gold, 3), needed])) {
          if (spend < 1 || spend > me.gold) continue;
          const holds = spend >= needed;
          candidates.push({
            order: ORDER.SUPPORT,
            target: CROWN,
            gold: spend,
            score: (holds ? stake : stake * 0.25) * clamp(0.35 + gap * 0.12, 0.1, 1) - spend * 0.5,
            why: 'shield the throne',
          });
        }
      }
      if (pact && (pact.kind === 'supportAttack' || pact.kind === 'supportDefense')) {
        const spend = clamp(pact.expected || 2, 1, me.gold);
        candidates.push({
          order: ORDER.SUPPORT,
          target: pact.with,
          gold: spend,
          score: pactPull - spend * 0.6,
          why: 'honour a bargain',
        });
      }
    }

    if (legal.includes(ORDER.RANSOM)) {
      for (const t of others) {
        const band = bandOf(t.fealty);
        const delta = band === BAND.FAVORITE ? -2 : band === BAND.OUTLAW ? 1 : 0;
        const after = withChanges(me, {
          gold: me.gold + Math.min(2, t.gold),
          fealty: clampFealty(me.fealty + delta),
        });
        candidates.push({
          order: ORDER.RANSOM,
          target: t.id,
          score: (positionScore(after, view, traits) - base) * 0.9,
          why: `shake down ${t.name}`,
        });
      }
      const afterCrown = withChanges(me, { gold: me.gold + 5, fealty: -3 });
      candidates.push({
        order: ORDER.RANSOM,
        target: CROWN,
        score: (positionScore(afterCrown, view, traits) - base) * 0.9,
        why: 'rob the Crown',
      });
    }

    if (legal.includes(ORDER.HOLD)) candidates.push({ order: ORDER.HOLD, score: -0.01, why: 'wait' });

    // Deterministic jitter keyed off the visible board so bots do not all
    // converge on identical lines.
    const jitter = (c, i) => (((me.seat + 1) * 7 + i * 13 + view.round * 3 + (c.gold || 0)) % 5) * 0.12;
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
    if (me.gold < COSTS.LEVY) return 'fealty';
    const lateness = 1 - view.deckCount / 12;
    const fealtyWorth = 3 + 20 * lateness;
    const goldWorth = COSTS.LEVY * 0.55 * traits.greed + (me.gold <= 3 ? 4 : 0);
    // Diving to outlaw is a real strategy for the treacherous.
    const wantsShadow = traits.treachery > 0.9 && me.fealty <= 0 && view.deckCount > 4;
    if (wantsShadow) return 'fealty';
    return fealtyWorth > goldWorth ? 'pay' : 'fealty';
  }

  function chooseTitle(request, view) {
    const me = view.players.find((p) => p.id === view.me);
    const pref = ['herald', 'marshal', 'steward', 'warden', 'spymaster', 'chancellor'];
    if (traits.greed > 1.2) pref.splice(0, 0, 'steward');
    if (traits.aggression > 1.2) pref.splice(0, 0, 'marshal');
    if (bandOf(me.fealty) === BAND.OUTLAW) pref.splice(0, 0, 'chancellor');
    return pref.find((t) => request.available.includes(t)) || request.available[0];
  }

  function chooseSpoils(request, view) {
    const loser = view.players.find((p) => p.id === request.loser);
    const worth = { herald: 6, marshal: 5, steward: 4 + view.deckCount * 0.4, warden: 4, spymaster: 3, chancellor: 3 };
    const bestTitle = request.titles.slice().sort((a, b) => (worth[b] || 3) - (worth[a] || 3))[0];
    const landWorth = 1.4 + 0.75 * view.deckCount;
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
      .sort((a, b) => positionScore(b, view, traits) - positionScore(a, view, traits));
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

  function decide(request, view) {
    switch (request.type) {
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
    traits,
    decide,
    rankOrders,
    positionScore: (p, v) => positionScore(p, v, traits),
  };
}

export { TRAITS, positionScore };
export const NEUTRAL_POOL_START = SETUP.NEUTRAL_POOL;
