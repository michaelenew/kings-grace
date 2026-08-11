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
};

export const CARD_LABEL = {
  [CARD.TAX]: 'Tax',
  [CARD.LEVY]: 'Levy',
  [CARD.FAVOR]: 'Favor',
};

/** Card text for the tuning actually in play, not the numbers on the sheet. */
export function cardText(card, tuning, options = null) {
  const t = tuning;
  switch (card) {
    case CARD.TAX:
      return `Favorites pay ${t.taxByBand.favorite}, neutrals ${t.taxByBand.neutral}, outlaws ${t.taxByBand.outlaw}. Chancellor pays ${t.chancellorRelief} less (min 0).`;
    case CARD.LEVY:
      return `Each player pays ${t.levyCost} gold to the Crown or drops 1 fealty.`
        + (options?.levyTargetsOutlaws ? ' Outlaws instead forfeit land: one at −2, two at −3.' : '');
    case CARD.FAVOR:
      return `Every favorite is paid ${t.favorGold} gold, and those at +${t.favorLandAt} take a land from the neutral pool as well.`;
    default:
      return '';
  }
}

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

export const FEALTY_MIN = -3;
export const FEALTY_MAX = 3;

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
  'Emeric of Dunhollow',
  'Isolde of Barrowmere',
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
