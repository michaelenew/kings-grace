// What the court thinks of you.
//
// Goods move through deals.js and the deal table. Nothing there is conditional
// on anybody's word, and that is deliberate — a bargain settles or it does not.
// But a game about court politics in which betrayal costs nothing is not a game
// about court politics, it is a game about arithmetic. So this is the ledger of
// what houses have *done to each other*, and what they said they would do.
//
// Two channels feed it.
//
// DEEDS. Struck a bargain with a house and put a sword in them the same round;
// stripped a coronet off somebody you had just dealt with; held a wall for
// someone. All public, all observed by the whole table, all recorded without
// anybody having to promise anything.
//
// WORDS. A house may declare an undertaking — "I will leave you be this round",
// "I will march on the Crown with you". It is free, it binds nobody, and no
// bargain ever waits on it. It is checked against what they actually did when
// the orders turn over, and *that* is what costs.
//
// Trust runs −3 (they would sell you for a copper) to +3 (you would leave your
// gate open for them), and decays gently toward indifference, because the court
// has a long memory but not an infinite one.

import { CROWN } from './constants.js';
import { matchesIntent } from './diplomacy.js';

export const TRUST_MIN = -3;
export const TRUST_MAX = 3;

/** Per-round pull toward indifference. Grudges fade; they do not vanish. */
const DECAY = 0.12;

const key = (from, to) => `${from}>${to}`;
const clamp = (n) => Math.max(TRUST_MIN, Math.min(TRUST_MAX, n));

/** How much `from` believes `to`. Zero is a stranger. */
export function trustOf(state, from, to) {
  if (from === to) return TRUST_MAX;
  return state.trust?.[key(from, to)] ?? 0;
}

export function adjustTrust(state, from, to, delta) {
  if (from === to || !delta) return;
  state.trust ??= {};
  state.trust[key(from, to)] = clamp(trustOf(state, from, to) + delta);
}

/**
 * Everyone except the two houses involved saw it too. A betrayal in open court
 * is not a private matter — that is the whole reason it is expensive.
 */
export function adjustTable(state, actor, delta, { except = [] } = {}) {
  for (const p of state.players) {
    if (p.id === actor || except.includes(p.id)) continue;
    adjustTrust(state, p.id, actor, delta);
  }
}

export function decayTrust(state) {
  if (!state.trust) return;
  for (const k of Object.keys(state.trust)) {
    const v = state.trust[k];
    const next = v > 0 ? Math.max(0, v - DECAY) : Math.min(0, v + DECAY);
    if (Math.abs(next) < 0.01) delete state.trust[k];
    else state.trust[k] = next;
  }
}

/** Houses this player has settled a bargain with in the last `window` rounds. */
export function recentPartners(state, pid, window = 2) {
  const out = new Set();
  for (const deal of state.deals || []) {
    if (state.round - deal.round >= window) continue;
    const involved = new Set([...Object.keys(deal.offers || {}), ...Object.keys(deal.takes || {})]);
    if (!involved.has(pid)) continue;
    for (const other of involved) if (other !== pid) out.add(other);
  }
  return out;
}

// ---------------------------------------------------------------- promises

export function makePromise(state, from, { to, kind, subject = null }) {
  state.promises ??= [];
  // One undertaking per pair per round. Saying it twice is still saying it once.
  const existing = state.promises.find((p) => p.round === state.round && p.from === from && p.to === to);
  if (existing) {
    existing.kind = kind;
    existing.subject = subject;
    return existing;
  }
  const promise = { round: state.round, from, to, kind, subject, kept: null };
  state.promises.push(promise);
  return promise;
}

export function promisesThisRound(state, round = state.round) {
  return (state.promises || []).filter((p) => p.round === round);
}

/**
 * Score every undertaking made this round against what its author actually
 * sealed, and move the ledger. Called once, after the orders are revealed.
 *
 * A promise kept is worth much less than a promise broken is worth, which is
 * the correct asymmetry: keeping your word is the baseline and breaking it is
 * the event.
 */
export function settlePromises(state, emit = () => {}) {
  for (const promise of promisesThisRound(state)) {
    if (promise.kept !== null) continue;
    const c = state.commitments[promise.from];
    const pact = { kind: promise.kind, with: promise.to, subject: promise.subject };
    const kept = !!c && matchesIntent({ order: c.order, target: c.target }, pact);
    promise.kept = kept;
    const from = state.players.find((p) => p.id === promise.from);
    const to = state.players.find((p) => p.id === promise.to);
    if (!from || !to) continue;
    if (kept) {
      adjustTrust(state, promise.to, promise.from, 1);
      adjustTable(state, promise.from, 0.25, { except: [promise.to] });
      emit('trust', `${from.name} keeps their word to ${to.name}.`);
    } else {
      adjustTrust(state, promise.to, promise.from, -2);
      adjustTable(state, promise.from, -1, { except: [promise.to] });
      emit('trust', `${from.name} gave ${to.name} their word and broke it. The court noticed.`);
    }
  }
}

/**
 * Score the deeds. Attacking a house you have just bargained with is the
 * betrayal the game is actually about, and it costs whether or not anybody
 * promised anything.
 */
export function settleDeeds(state, emit = () => {}) {
  for (const p of state.players) {
    const c = state.commitments[p.id];
    if (!c) continue;
    const partners = recentPartners(state, p.id);

    if (c.order === 'attack' && c.target !== CROWN && partners.has(c.target)) {
      const victim = state.players.find((x) => x.id === c.target);
      adjustTrust(state, c.target, p.id, -2);
      adjustTable(state, p.id, -0.5, { except: [c.target] });
      if (victim) emit('trust', `${p.name} bargained with ${victim.name} and then drew on them.`);
    }

    // Holding somebody's wall is the cheapest way to be believed later.
    if (c.order === 'support' && c.target !== CROWN) {
      const ally = state.commitments[c.target];
      const defended = !ally || ally.order !== 'attack';
      if (defended) adjustTrust(state, c.target, p.id, 0.75);
    }
  }
}

/**
 * A settled bargain moves the ledger by how even it was. Dealing squarely buys
 * a little credit; fleecing somebody costs a little, because they can count.
 */
export function settleBargain(state, table, valueFor) {
  const involved = [...new Set([...Object.keys(table.offers || {}), ...Object.keys(table.takes || {})])];
  if (involved.length < 2) return;
  const balances = involved.map((pid) => ({ pid, worth: valueFor(pid) }));
  const best = Math.max(...balances.map((b) => b.worth));
  for (const { pid, worth } of balances) {
    for (const other of involved) {
      if (other === pid) continue;
      // Everyone gains a little for having dealt at all; the house that came
      // off worst against the house that came off best gains nothing and
      // remembers it.
      const fleeced = best - worth > 6;
      adjustTrust(state, pid, other, fleeced && worth < best ? -0.5 : 0.4);
    }
  }
}

/** Label for the UI and for agent briefings. */
export function trustLabel(v) {
  if (v >= 2) return 'would leave the gate open';
  if (v >= 0.75) return 'well thought of';
  if (v > -0.75) return 'an unknown quantity';
  if (v > -2) return 'not to be relied on';
  return 'would sell you for a copper';
}
