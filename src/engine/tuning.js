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
  /**
   * Eight, not six, because the first flip can be a Tax and an outlaw owes 8.
   * At six, a Tax on round one left a third of the table unable to afford any
   * order at all — the first decision of the game was "you have no decision".
   */
  startGold: 8,
  startFealty: 0,
  /** Unclaimed land is dealt per player, so Develop stays live at any count. */
  neutralPerPlayer: 2,
  /** Most unspent turncoat tokens a player may hold at once. */
  turncoatMax: 2,
  deck: { tax: 4, levy: 4, favor: 4 },

  // ---- The Crown ------------------------------------------------------
  // Crown strength = crownBase + crownPerPlayer x players + cards remaining.
  // A bigger table can raise a bigger coalition, so the throne stands taller.
  //
  // Do not raise the offset far past this. A crown nobody can reach means the
  // first player to +3 cannot be deposed — nothing in the game lowers a rival's
  // fealty — and the Herald then wins every tie forever. At an offset of 8 the
  // Herald's holder won 1.76x their share of games against 1.41x at 6. The coup
  // is the only check on the heir.
  crownBase: 6,
  crownPerPlayer: 0,
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
   * Plunder: gold taken from the loser on top of the land or the title.
   *
   * War is the only order whose whole payoff lands inside a three-move horizon,
   * and it was paying one field — worth about two and a half gold — for a
   * commitment of three or more. Plunder is what makes a swollen purse a reason
   * to be attacked rather than a reason to be safe, which is the jealousy of
   * the court doing the job the design always wanted it to do.
   */
  spoilsGold: 4,
  /**
   * The most gold one order may carry. This is what makes a usurpation a
   * conspiracy: no purse alone can outreach the crown, so the throne has to be
   * bought with somebody else's sword.
   */
  commitCap: 9,

  // ---- Income ---------------------------------------------------------
  landIncome: 1,
  neutralIncome: 1,
  stewardIncome: 1,

  // ---- Orders ---------------------------------------------------------
  petitionCost: 2,
  pardonCost: 3,
  developCost: 3,

  // ---- Crown deck -----------------------------------------------------
  /**
   * The Crown's only real drain on the table. It has to be heavy, because
   * nothing else takes gold out: the levy asks for troops, land runs out
   * halfway through, and a house at +3 has nothing left to appeal for. Left
   * light, purses climbed past 25 by the end and the game turned into everyone
   * sitting on a war chest nobody dared spend.
   */
  taxByBand: { favorite: 6, neutral: 7, outlaw: 8 },
  chancellorRelief: 1,
  /**
   * The levy asks for your host, not your purse. Answer it and your army
   * marches under the royal banner: no walls and no attack this round, so
   * everything you hold — titles included — is open. Refuse and the court
   * remembers it by this much.
   *
   * Two is deliberate. It means +1 is a perch: you can refuse a levy and land
   * at −1, still neutral. From 0 the same refusal makes you an outlaw. And a
   * loyalist, who cannot afford to fall at all, has no choice but to serve —
   * which is what puts their coronet in play round after round.
   */
  levyRefusal: 2,
  /** Favor pays every favorite: this much gold at +2, and a land as well at +3. */
  favorGold: 2,
  favorLandAt: 3,

  // ---- Titles ---------------------------------------------------------
  /**
   * A title granted at +2 or +3 may be claimed from whoever already holds it,
   * for this much gold to the Crown. The King does not want to make enemies of
   * his friends, and the coin is what soothes the slight.
   */
  titleClaimCost: 2,

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
