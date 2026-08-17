// Game state construction and pure read-only helpers.

import { BAND, CARD, CROWN, HOUSE_NAMES, ORDER, PERSONALITIES, TITLES, bandOf } from './constants.js';
import { PLAYER_MAX, PLAYER_MIN, deckSize, neutralPoolFor, resolveTuning } from './tuning.js';
import { makeRng, seedFrom } from './rng.js';

/**
 * Build the crown deck (§6).
 * `seedFavorEarly` applies the tuning knob from §6: guarantee one Favor inside
 * the first three flips so loyalty pays early.
 */
export function buildDeck(rng, seedFavorEarly = true, tuning = resolveTuning()) {
  const cards = [];
  for (const [type, count] of Object.entries(tuning.deck)) {
    for (let i = 0; i < count; i++) cards.push(type);
  }
  const deck = rng.shuffle(cards);
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
 * @param {object} [opts.tuning] overrides on top of the v0.1 constants
 */
export function createGame(opts = {}) {
  const rawSeed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const seed = typeof rawSeed === 'number' ? rawSeed >>> 0 : seedFrom(String(rawSeed));
  const rng = makeRng(seed);
  const tuning = resolveTuning(opts.tuning);

  const options = {
    ransom: false, // §9 optional module
    seedFavorEarly: true, // §6 tuning knob
    ...(opts.options || {}),
  };

  const seatCount = Math.max(PLAYER_MIN, Math.min(PLAYER_MAX, opts.seats?.length || opts.players || 4));
  const seatSpecs = opts.seats && opts.seats.length
    ? opts.seats.slice(0, PLAYER_MAX)
    : Array.from({ length: seatCount }, () => ({ kind: 'ai' }));

  const personalityBag = rng.shuffle(PERSONALITIES);
  const players = seatSpecs.map((spec, i) => ({
    id: `p${i}`,
    seat: i,
    name: spec.name || HOUSE_NAMES[i % HOUSE_NAMES.length],
    kind: spec.kind,
    personality: spec.kind === 'ai' ? (spec.personality || personalityBag[i % personalityBag.length]) : null,
    doctrine: spec.doctrine || null,
    gold: tuning.startGold,
    lands: tuning.startLands,
    fealty: tuning.startFealty,
    titles: [],
    titleGrants: { 2: false, 3: false }, // "first time you reach" flags (§2)
    ransomUsed: false,
    escrow: 0,
    /** Set for the round when this house answers a levy: no walls, no attack. */
    noArmy: false,
    /**
     * How this house answered the round's levy: null until the levy is actually
     * resolved, then 'serve' or 'refuse'. The board reads this, not the flipped
     * card — so nobody is drawn as having refused a levy they have not answered.
     */
    levy: null,
    /** Turncoat tokens: earned in the shadow, spendable or tradeable (§2). */
    turncoat: 0,
  }));

  return {
    seed,
    rng,
    options,
    tuning,
    round: 0,
    phase: 'setup',
    deck: buildDeck(rng, options.seedFavorEarly, tuning),
    deckStart: deckSize(tuning),
    discard: [],
    lastCard: null,
    neutralPool: neutralPoolFor(tuning, players.length),
    crownLands: 0, // lands forfeited to the Crown (out of play)
    crownGold: 0,
    players,
    commitments: {}, // pid -> {order, gold, target}
    revealed: false,
    knowledge: {}, // pid -> {orders:{pid:commitment}, topCard: card|null}
    pacts: {}, // pid -> pact honoured this round (diplomacy layer)
    trust: {}, // "from>to" -> −3..+3, what the court thinks of you
    promises: [], // undertakings declared, and whether they were kept
    goodwill: {}, // "from>to" -> number, gold gifted so far
    deals: [], // deals struck this game, for the chronicle
    dealTable: { proposer: null, transfers: [], accepted: [] }, // the open proposal
    beats: [], // structured record of this round's resolution, for animation
    log: [],
    winner: null, // {playerIds:[], how:'usurp'|'inherit'}
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
 * Titles this player could take off somebody else with their grant, and what
 * it would cost. The King gives what he has already given, but he does not
 * want to make enemies of his friends, so the claim is paid for.
 */
export function claimableTitles(state, player) {
  const cost = state.tuning.titleClaimCost;
  if (player.gold < cost) return [];
  return state.players
    .filter((p) => p.id !== player.id)
    .flatMap((p) => p.titles.map((title) => ({ title, holder: p.id, holderName: p.name, cost })));
}

/**
 * Crown strength = base + per-player x players + cards remaining.
 *
 * The per-player term is what lets the game run 2-6 handed: a bigger table can
 * raise a bigger coalition against the throne, so the throne has to stand
 * taller. Without it a six-player coup is trivial and a two-player one is
 * impossible.
 */
export function crownStrength(state) {
  const t = state.tuning;
  // Rounded: the per-card term is fractional so the curve can be tuned finely,
  // but a crown that defends with 15.8 is not something you can put on a card.
  return Math.round(t.crownBase + t.crownPerPlayer * state.players.length + t.crownPerCard * state.deck.length);
}

/**
 * A player's walls right now, broken into parts, for display. `knowOrder` says
 * whether the viewer is entitled to know this player's sealed order — false for
 * a rival before the reveal, true for your own seat or after it — so a hidden
 * attack does not leak through the walls readout.
 *
 * It reports the *resting* wall; the note explains what can move it before the
 * swords land, because standing, titles and a last-moment pledge all can.
 */
export function wallsInfo(state, player, { knowOrder = false } = {}) {
  const t = state.tuning;
  const c = knowOrder ? state.commitments[player.id] : null;
  if (player.noArmy) {
    return { total: 0, gone: 'levy', parts: [{ label: 'Host answered the levy', value: 0 }] };
  }
  if (c && c.order === ORDER.ATTACK) {
    return { total: 0, gone: 'attack', parts: [{ label: 'Army in the field', value: 0 }] };
  }
  const parts = [{ label: 'Base walls', value: t.walls }];
  let total = t.walls;
  if (hasTitle(player, 'warden')) { parts.push({ label: 'Warden', value: t.wardenBonus }); total += t.wardenBonus; }
  const pledge = (t.pledgeWall && c && c.order === ORDER.PETITION) ? c.gold : 0;
  if (pledge) { parts.push({ label: 'Fealty pledge this round', value: pledge }); total += pledge; }
  return { total, gone: null, parts };
}

/** The most gold a single order may carry (§3's cap, off by default). */
export function commitCeiling(state, player) {
  const cap = state.tuning.commitCap;
  return cap === null || cap === undefined ? player.gold : Math.min(player.gold, cap);
}

/** §4 — which orders this player can legally commit right now. */
export function legalOrders(state, player) {
  const out = [];
  if (player.gold >= 1 && !player.noArmy) out.push(ORDER.ATTACK);
  if (player.gold >= 1) out.push(ORDER.SUPPORT);
  if (player.gold >= petitionCostFor(state, player)) out.push(ORDER.PETITION);
  if (player.gold >= state.tuning.developCost && state.neutralPool > 0) out.push(ORDER.DEVELOP);
  if (state.options.ransom && !player.ransomUsed) out.push(ORDER.RANSOM);
  if (out.length === 0) out.push(ORDER.HOLD);
  return out;
}

export function petitionCostFor(state, player) {
  return bandOf(player.fealty) === BAND.OUTLAW ? state.tuning.pardonCost : state.tuning.petitionCost;
}

/**
 * Legal targets for attack/support/ransom.
 *
 * Support may be aimed at yourself — digging in. It is the only defence a house
 * can raise on its own initiative: walls are flat and passive, and everything
 * else has to be bought from a neighbour. Because orders are sealed, an
 * attacker cannot know whether you dug in, which is the bluff the game was
 * missing.
 */
export function legalTargets(state, player, order) {
  const others = state.players.filter((p) => p.id !== player.id).map((p) => p.id);
  if (order === ORDER.SUPPORT) return [player.id, ...others, CROWN];
  if (order === ORDER.ATTACK || order === ORDER.RANSOM) return [...others, CROWN];
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
    tuning: state.tuning,
    round: state.round,
    phase: state.phase,
    deckCount: state.deck.length,
    deckStart: state.deckStart,
    crownStrength: crownStrength(state),
    lastCard: state.lastCard,
    knownTopCard: known.topCard ?? null,
    neutralPool: state.neutralPool,
    crownLands: state.crownLands,
    // Orders are simultaneous, so the *size* of another player's commitment is
    // hidden too — until reveal their purse looks untouched. Without this,
    // whoever is asked last can read everyone else's war chest off the board.
    players: state.players.map((p) => {
      const hide = !state.revealed && p.id !== pid && p.escrow > 0;
      return {
        ...p,
        titles: p.titles.slice(),
        gold: hide ? p.gold + p.escrow : p.gold,
        escrow: hide ? 0 : p.escrow,
      };
    }),
    me: pid,
    commitments: {},
    // Deals are private to the two houses that struck them.
    dealTable: JSON.parse(JSON.stringify(state.dealTable || { proposer: null, transfers: [], accepted: [] })),
    // Trust and promises are public. A word given in open court is given in
    // open court, and everybody watches whether it holds.
    trust: { ...state.trust },
    promises: (state.promises || []).map((p) => ({ ...p })),
    // Third parties see *that* a bargain happened and who was in it, which is
    // what makes betraying a partner visible. What was in it stays private.
    deals: (state.deals || []).map((d) => {
      const involved = [...new Set([...Object.keys(d.offers || {}), ...Object.keys(d.takes || {})])];
      const mine = involved.includes(pid);
      return mine
        ? { ...d }
        : {
          round: d.round,
          offers: Object.fromEntries(involved.map((x) => [x, {}])),
          takes: Object.fromEntries(involved.map((x) => [x, {}])),
        };
    }),
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
