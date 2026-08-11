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
  /**
   * Unclaimed land dealt per player, so Develop stays live at any count.
   *
   * Three, not two. At two the pool was dry by round seven and the back half of
   * every game had no building in it at all — which is half of why a winner's
   * turns came out short of the 40% the mix wants. It is also what makes the
   * land-tax recycling above worth having: fields have somewhere to go back to.
   */
  neutralPerPlayer: 3,
  /** Most unspent turncoat tokens a player may hold at once. */
  turncoatMax: 2,
  deck: { tax: 3, levy: 4, favor: 3 },

  // ---- The Crown ------------------------------------------------------
  // Crown strength = round(crownBase + crownPerPlayer x players + per-card x
  // cards remaining).
  //
  // Do not raise the base far past this. A crown nobody can reach means the
  // first player to +3 cannot be deposed — nothing in the game lowers a rival's
  // fealty — and the Herald then wins every tie forever. At an offset of 8 the
  // Herald's holder won 1.76x their share of games against 1.41x at 6. The coup
  // is the only check on the heir.
  crownBase: 7,
  /**
   * Negative, which reverses an earlier ruling that the crown must never weaken
   * as the table grows. That ruling was an instinct made before there was
   * anything to measure it against, and the measurements do not support it.
   *
   * A bigger table does not raise a bigger coalition — it raises a bigger
   * *crowd*. More houses are free to throw gold behind the throne, and the
   * largest-single-contributor rule gets harder to satisfy as a conspiracy
   * grows, so coups are tried more often and land far less: 43% at three
   * players against 18% at six. Left flat, usurpation ran 59% of games at three
   * players and 32% at six — the same rules playing as two different games.
   *
   * A quarter-point per house roughly halves that: 53/47/38/38 across three to
   * six. It costs about a point of the enjoyment score at three players, where
   * the coup-heavy game happened to score well, and buys consistency the
   * enjoyment score does not measure because it scores each table size alone.
   */
  crownPerPlayer: -0.25,
  /**
   * 1.4, not 1, because the deck is ten cards rather than twelve. What this
   * number really controls is how fast the coup window *opens*: the crown
   * starts at 6 + 1.4 x 10 = 20 and decays to 6 as the deck runs out. On a
   * short deck it has to decay faster to reach the same place, and the game is
   * violently sensitive to it — at a flat crown of 6 + cards a ten-card game
   * ends in usurpation 57% of the time, and one point of base takes that to
   * 13%.
   */
  crownPerCard: 1.4,

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
   * What a field is worth to the tax collector. A house that cannot pay its tax
   * in coin pays it in land, and that land goes **back to the unclaimed pool**
   * rather than out of play — the Crown has no use for a field, it wants a
   * tenant who can pay.
   *
   * This is the only thing in the game that puts land back on the board, which
   * is what keeps Develop alive past the midpoint. Zero turns it off and
   * restores "pay what you have and keep your fields".
   */
  taxLandValue: 5,
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
