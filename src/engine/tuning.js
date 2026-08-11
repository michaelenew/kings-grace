// Every number the game is made of, in one place.
//
// These are the rules in play. They were arrived at with the bot tournaments in
// tools/simulate.js — see the README for the measurements behind each one.
// Anything here can be overridden per game (the setup screen exposes the ones
// worth touching), which is how you playtest a variant without editing code.

export const PLAYER_MIN = 2;
export const PLAYER_MAX = 6;

export const RULES = {
  // ---- Setup ----------------------------------------------------------
  startLands: 3,
  startGold: 6,
  startFealty: 0,
  /** Unclaimed land is dealt per player, so Develop stays live at any count. */
  neutralPerPlayer: 2,
  deck: { tax: 5, levy: 4, favor: 2, purge: 1 },

  // ---- The Crown ------------------------------------------------------
  // Crown strength = crownBase + crownPerPlayer x players + cards remaining.
  // With these values that is 8 + cards at two players, falling to 4 + cards at
  // six — the crown stands taller at a small table and shorter at a large one.
  //
  // That is the opposite of the obvious intuition and it is what the games
  // show: a coup is not stopped by the crown alone but by whoever else throws
  // gold behind it, and a big table has more nobles available to do that. At a
  // flat offset, two-player games ended in a coup 81% of the time and
  // six-player games 45%.
  //
  // Raising the offset generally is tempting and wrong. A crown nobody can
  // reach means the first player to +3 cannot be deposed, and the Herald then
  // wins every tie forever: at an offset of 8 the Herald's holder won 44% of
  // four-player games against 35% at 6. The coup is the check on the heir.
  crownBase: 10,
  crownPerPlayer: -1,
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
  commitCap: 6,

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
