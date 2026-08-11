// The King's Graces — shared constants.
// Rule references in comments point at sections of RULES.md (prototype v0.1).

export const CROWN = 'crown';

/** Fealty bands (§2). */
export const BAND = {
  FAVORITE: 'favorite',
  NEUTRAL: 'neutral',
  OUTLAW: 'outlaw',
};

/** Orders (§4) plus two engine-level extras. */
export const ORDER = {
  ATTACK: 'attack',
  SUPPORT: 'support',
  PETITION: 'petition',
  DEVELOP: 'develop',
  RANSOM: 'ransom', // optional module (§9)
  HOLD: 'hold', // only legal when no other order is affordable
};

export const ORDER_LABEL = {
  [ORDER.ATTACK]: 'Attack',
  [ORDER.SUPPORT]: 'Support',
  [ORDER.PETITION]: 'Petition',
  [ORDER.DEVELOP]: 'Develop',
  [ORDER.RANSOM]: 'Ransom',
  [ORDER.HOLD]: 'Hold',
};

/** Crown deck card types (§6). */
export const CARD = {
  TAX: 'tax',
  LEVY: 'levy',
  FAVOR: 'favor',
  PURGE: 'purge',
};

export const CARD_LABEL = {
  [CARD.TAX]: 'Tax',
  [CARD.LEVY]: 'Levy',
  [CARD.FAVOR]: 'Favor',
  [CARD.PURGE]: 'Purge',
};

export const CARD_TEXT = {
  [CARD.TAX]: 'Favorites pay 1, neutrals 2, outlaws 3. Chancellor pays 1 less (min 0).',
  [CARD.LEVY]: 'Each player pays 2 gold to the Crown or drops 1 fealty.',
  [CARD.FAVOR]: 'The single highest-fealty player takes one land from the neutral pool. Tie: no effect.',
  [CARD.PURGE]: 'The single lowest-fealty player forfeits one land to the Crown. Tie: no effect.',
};

/** Titles (§7). Six unique, granted at fealty thresholds, stealable in combat. */
export const TITLES = [
  { id: 'marshal', name: 'Marshal', text: '+1 to your attack strength.' },
  { id: 'warden', name: 'Warden', text: '+1 to your defense.' },
  { id: 'chancellor', name: 'Chancellor', text: 'Pay 1 less on Tax cards (min 0).' },
  { id: 'steward', name: 'Steward', text: '+1 gold in the income step.' },
  { id: 'spymaster', name: 'Spymaster', text: 'After commitment, peek at one player\'s committed order.' },
  { id: 'herald', name: 'Herald', text: 'Win all ties you are party to.' },
];

export const TITLE_BY_ID = Object.fromEntries(TITLES.map((t) => [t.id, t]));

/** Setup (§1). */
export const SETUP = {
  PLAYERS: 4,
  START_LANDS: 3,
  START_GOLD: 5,
  START_FEALTY: 0,
  NEUTRAL_POOL: 8,
  DECK: { [CARD.TAX]: 4, [CARD.LEVY]: 4, [CARD.FAVOR]: 3, [CARD.PURGE]: 1 },
};

export const COSTS = {
  PETITION: 2,
  PARDON: 3,
  DEVELOP: 3,
  LEVY: 2,
};

export const WALLS = 2; // §5
export const CROWN_BASE = 4; // crown strength = CROWN_BASE + cards remaining (§1)
export const FEALTY_MIN = -3;
export const FEALTY_MAX = 3;

export const TAX_BY_BAND = {
  [BAND.FAVORITE]: 1,
  [BAND.NEUTRAL]: 2,
  [BAND.OUTLAW]: 3,
};

/** Fealty change for the attacker, keyed by the target's band at resolution (§4). */
export const ATTACK_FEALTY_DELTA = {
  [BAND.FAVORITE]: -2,
  [BAND.NEUTRAL]: 0,
  [BAND.OUTLAW]: +1,
};

export const HOUSE_NAMES = [
  'Aveline of Marchmere',
  'Roderic of Thornfell',
  'Otho of Greyholt',
  'Sibylla of Vaunt',
];

export const PERSONALITIES = ['loyalist', 'merchant', 'schemer', 'wolf'];

export const PERSONALITY_LABEL = {
  loyalist: 'Loyalist',
  merchant: 'Merchant',
  schemer: 'Schemer',
  wolf: 'Wolf',
};

export function clampFealty(n) {
  return Math.max(FEALTY_MIN, Math.min(FEALTY_MAX, n));
}

/** §2 — band from a fealty value. */
export function bandOf(fealty) {
  if (fealty >= 2) return BAND.FAVORITE;
  if (fealty <= -2) return BAND.OUTLAW;
  return BAND.NEUTRAL;
}

export const BAND_LABEL = {
  [BAND.FAVORITE]: 'Favorite',
  [BAND.NEUTRAL]: 'Neutral',
  [BAND.OUTLAW]: 'Outlaw',
};
