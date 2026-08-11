// Every number the game is made of, in one place.
//
// These are the rules in play. They were arrived at with the bot tournaments in
// tools/simulate.js — see the README for the measurements behind each one.
// Anything here can be overridden per game (the setup screen exposes the ones
// worth touching), which is how you playtest a variant without editing code.

export const PLAYER_MIN = 3;
export const PLAYER_MAX = 6;

export const RULES = {
  // ---- Setup ----------------------------------------------------------
  startLands: 3,
  startGold: 6,
  startFealty: 0,
  /** Unclaimed land is dealt per player, so Develop stays live at any count. */
  neutralPerPlayer: 2,
  /** Most unspent turncoat tokens a player may hold at once. */
  turncoatMax: 2,
  deck: { tax: 5, levy: 4, favor: 2, purge: 1 },

  // ---- The Crown ------------------------------------------------------
  // Crown strength = crownBase + crownPerPlayer x players + cards remaining.
  // A bigger table can raise a bigger coalition, so the throne stands taller.
  //
  // Do not raise the offset far past this. A crown nobody can reach means the
  // first player to +3 cannot be deposed — nothing in the game lowers a rival's
  // fealty — and the Herald then wins every tie forever. At an offset of 8 the
  // Herald's holder won 1.76x their share of games against 1.41x at 6. The coup
  // is the only check on the heir.
  crownBase: 2,
  crownPerPlayer: 1,
  crownPerCard: 1,

  // ---- Combat ---------------------------------------------------------
  walls: 2,
  /** A favorite's attacks gain +fealty against anyone lower down the track. */
  punchDownScale: 1,
  /** What attacking costs the attacker, by the target's band. */
  attackFealty: { favorite: -2, neutral: 0, outlaw: 1 },
  marshalBonus: 1,
  wardenBonus: 1,
  /**
   * The most gold one order may carry. This is what makes a usurpation a
   * conspiracy: no purse alone can outreach the crown, so the throne has to be
   * bought with somebody else's sword.
   */
  commitCap: 7,

  // ---- Income ---------------------------------------------------------
  landIncome: 1,
  neutralIncome: 1,
  stewardIncome: 1,

  // ---- Orders ---------------------------------------------------------
  petitionCost: 2,
  pardonCost: 3,
  developCost: 3,

  // ---- Crown deck -----------------------------------------------------
  taxByBand: { favorite: 1, neutral: 2, outlaw: 3 },
  chancellorRelief: 1,
  levyCost: 4,

  // ---- Ransom module (optional) ---------------------------------------
  ransomTake: 2,
  ransomCrownGold: 5,
};

export function resolveTuning(input = {}) {
  const { taxByBand, deck, attackFealty, ...rest } = input;
  return {
    ...RULES,
    ...rest,
    taxByBand: { ...RULES.taxByBand, ...(taxByBand || {}) },
    attackFealty: { ...RULES.attackFealty, ...(attackFealty || {}) },
    deck: { ...RULES.deck, ...(deck || {}) },
  };
}

export function deckSize(tuning) {
  return Object.values(tuning.deck).reduce((a, b) => a + b, 0);
}

/** Unclaimed land dealt at setup for a given table size. */
export function neutralPoolFor(tuning, players) {
  return tuning.neutralPool ?? tuning.neutralPerPlayer * players;
}
