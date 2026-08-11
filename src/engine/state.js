// Game state construction and pure read-only helpers.

import {
  BAND, CARD, COSTS, CROWN, CROWN_BASE, HOUSE_NAMES, ORDER, PERSONALITIES,
  SETUP, TITLES, bandOf,
} from './constants.js';
import { makeRng, seedFrom } from './rng.js';

/**
 * Build the 12-card crown deck (§6).
 * `seedFavorEarly` applies the tuning knob from §6: guarantee one Favor inside
 * the first three flips so loyalty pays early.
 */
export function buildDeck(rng, seedFavorEarly = true) {
  const cards = [];
  for (const [type, count] of Object.entries(SETUP.DECK)) {
    for (let i = 0; i < count; i++) cards.push(type);
  }
  let deck = rng.shuffle(cards);
  if (seedFavorEarly && !deck.slice(0, 3).includes(CARD.FAVOR)) {
    const idx = deck.indexOf(CARD.FAVOR);
    if (idx !== -1) {
      const slot = rng.int(3);
      [deck[slot], deck[idx]] = [deck[idx], deck[slot]];
    }
  }
  return deck;
}

/**
 * @param {object} opts
 * @param {string|number} [opts.seed]
 * @param {Array<{name?:string, kind:'human'|'ai', personality?:string}>} [opts.seats]
 * @param {object} [opts.options]
 */
export function createGame(opts = {}) {
  const rawSeed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const seed = typeof rawSeed === 'number' ? rawSeed >>> 0 : seedFrom(String(rawSeed));
  const rng = makeRng(seed);

  const options = {
    ransom: false, // §9 optional module
    seedFavorEarly: true, // §6 tuning knob
    crownBase: CROWN_BASE, // §10 tuning knob
    ...(opts.options || {}),
  };

  const seatSpecs = opts.seats && opts.seats.length === SETUP.PLAYERS
    ? opts.seats
    : [{ kind: 'human' }, { kind: 'ai' }, { kind: 'ai' }, { kind: 'ai' }];

  const personalityBag = rng.shuffle(PERSONALITIES);
  const players = seatSpecs.map((spec, i) => ({
    id: `p${i}`,
    seat: i,
    name: spec.name || HOUSE_NAMES[i],
    kind: spec.kind,
    personality: spec.kind === 'ai' ? (spec.personality || personalityBag[i]) : null,
    gold: SETUP.START_GOLD,
    lands: SETUP.START_LANDS,
    fealty: SETUP.START_FEALTY,
    titles: [],
    titleGrants: { 2: false, 3: false }, // "first time you reach" flags (§2)
    ransomUsed: false,
    escrow: 0,
  }));

  return {
    seed,
    rng,
    options,
    round: 0,
    phase: 'setup',
    deck: buildDeck(rng, options.seedFavorEarly),
    discard: [],
    lastCard: null,
    neutralPool: SETUP.NEUTRAL_POOL,
    crownLands: 0, // lands forfeited to the Crown (out of play)
    crownGold: 0,
    players,
    commitments: {}, // pid -> {order, gold, target}
    revealed: false,
    knowledge: {}, // pid -> {orders:{pid:commitment}, topCard: card|null}
    pacts: {}, // pid -> pact honoured this round (diplomacy layer)
    goodwill: {}, // "from>to" -> number, gold gifted so far
    changeRights: {}, // pid -> count of unspent turncoat rights
    log: [],
    winner: null, // {playerIds:[], how:'usurp'|'inherit'|'civil-war'}
  };
}

export function playerById(state, id) {
  return state.players.find((p) => p.id === id) || null;
}

export function hasTitle(player, titleId) {
  return !!player && player.titles.includes(titleId);
}

export function titleHolder(state, titleId) {
  return state.players.find((p) => p.titles.includes(titleId)) || null;
}

export function unclaimedTitles(state) {
  const held = new Set(state.players.flatMap((p) => p.titles));
  return TITLES.filter((t) => !held.has(t.id)).map((t) => t.id);
}

/**
 * §1 — crown strength = 4 + cards remaining.
 * The constant is the tuning knob called out in §10: raise it if hoarded war
 * chests open the usurpation window too early.
 */
export function crownStrength(state) {
  return (state.options?.crownBase ?? CROWN_BASE) + state.deck.length;
}

/** §4 — which orders this player can legally commit right now. */
export function legalOrders(state, player) {
  const out = [];
  if (player.gold >= 1) out.push(ORDER.ATTACK, ORDER.SUPPORT);
  const petitionCost = bandOf(player.fealty) === BAND.OUTLAW ? COSTS.PARDON : COSTS.PETITION;
  if (player.gold >= petitionCost) out.push(ORDER.PETITION);
  if (player.gold >= COSTS.DEVELOP && state.neutralPool > 0) out.push(ORDER.DEVELOP);
  if (state.options.ransom && !player.ransomUsed) out.push(ORDER.RANSOM);
  if (out.length === 0) out.push(ORDER.HOLD);
  return out;
}

export function petitionCostFor(player) {
  return bandOf(player.fealty) === BAND.OUTLAW ? COSTS.PARDON : COSTS.PETITION;
}

/** Legal targets for attack/support/ransom. */
export function legalTargets(state, player, order) {
  const others = state.players.filter((p) => p.id !== player.id).map((p) => p.id);
  if (order === ORDER.ATTACK) return [...others, CROWN];
  if (order === ORDER.SUPPORT) return [...others, CROWN];
  if (order === ORDER.RANSOM) return [...others, CROWN];
  return [];
}

/**
 * Redacted copy of the state as a given player may legitimately see it:
 * other players' committed orders are hidden unless revealed or peeked, and
 * the crown deck's contents are hidden except a peeked top card.
 */
export function viewFor(state, pid) {
  const known = state.knowledge[pid] || { orders: {}, topCard: null };
  const view = {
    seed: state.seed,
    options: state.options,
    round: state.round,
    phase: state.phase,
    deckCount: state.deck.length,
    crownStrength: crownStrength(state),
    lastCard: state.lastCard,
    knownTopCard: state.revealed ? (state.deck[0] ?? null) : (known.topCard ?? null),
    neutralPool: state.neutralPool,
    crownLands: state.crownLands,
    players: state.players.map((p) => ({ ...p, titles: p.titles.slice() })),
    me: pid,
    commitments: {},
    pacts: { ...state.pacts },
    goodwill: { ...state.goodwill },
    winner: state.winner,
  };
  for (const [otherId, c] of Object.entries(state.commitments)) {
    if (state.revealed || otherId === pid) {
      view.commitments[otherId] = { ...c };
    } else if (known.orders[otherId]) {
      // What the peeker saw, which may since have gone stale (turncoat, §2).
      view.commitments[otherId] = { ...known.orders[otherId], peeked: true };
    }
  }
  return view;
}
