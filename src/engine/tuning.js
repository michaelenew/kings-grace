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
  /**
   * The most tokens the *shadow* will hand one house — a cap on taking, not on
   * holding. An outlaw takes one at the start of a round only when it holds
   * none, so it never self-stacks past this; there is no limit on how many a
   * house can *buy* at the deal table. One, because a token is used within the
   * round it is earned (peek, then change or sell), and a banked second was
   * only ever confusing.
   */
  turncoatMax: 1,
  deck: { tax: 3, levy: 4, favor: 3 },

  // ---- The Crown ------------------------------------------------------
  // Crown strength = round(crownBase + crownPerPlayer x players + per-card x
  // cards remaining).
  //
  // The base is the floor the crown decays to as the deck empties — the
  // strength of the throne on the last turn, when a coup is easiest. It sat at
  // 15 to keep a lone rich house from buying the throne with a shrug once the
  // gold cap came off, but that pushed the throne out of reach until the very
  // last flip: nobody came within striking distance until the deck was spent.
  // Eleven brings the coup window forward — with the steeper per-player term
  // below, a house that breaks out early can make a real pass at the throne
  // around round seven rather than only in the final round. It is delicate — a
  // point of it swings usurpation several points — so measure before you move
  // it.
  crownBase: 11,
  /**
   * Negative, which reverses an earlier ruling that the crown must never weaken
   * as the table grows. That ruling was an instinct made before there was
   * anything to measure it against, and the measurements do not support it.
   *
   * A bigger table does not raise a bigger coalition — it raises a bigger
   * *crowd*. More houses are free to throw gold behind the throne, and the
   * largest-single-contributor rule gets harder to satisfy as a conspiracy
   * grows, so coups are tried more often and land far less. Left flat,
   * usurpation ran as two different games at the extremes of the table.
   *
   * A full point per house — up from a quarter — is what makes an early breakout
   * plausible instead of a curiosity: the throne a four-house table has to beat
   * starts lower and falls faster, so usurpation stops waiting for the last card.
   */
  crownPerPlayer: -1,
  /**
   * 1.4, not 1, because the deck is ten cards rather than twelve. What this
   * number really controls is how fast the coup window *opens*: at four players
   * the crown starts near 28 (15 − 1 + 1.4 × 10) and decays to 14 as the deck
   * runs out. A short deck has to decay faster to cover the same span, and the
   * game is violently sensitive to it — measure any change.
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
   * Pledging fealty fortifies you. An Appeal or a pardon this round adds the
   * gold it cost to your walls, for that round only — so a house that sees the
   * blow coming can throw itself on the Crown's mercy and be sheltered by it.
   * This is what stops a loyalist beating up a neutral or an outlaw for free:
   * the target can pledge and the wall goes up.
   */
  pledgeWall: true,
  /**
   * And striking a house in the very act of pledging fealty is dishonourable:
   * the attacker loses this much standing on top of the usual band consequence,
   * win or lose. It is what removes the bounty for hunting a reforming outlaw.
   */
  pledgeStrikePenalty: 1,
  /**
   * A turncoat token in the attacker's hand at resolution cracks the gate,
   * reducing the defender's base walls by this much (never below zero, and it
   * does not touch the Warden, a pledge, or support). Two is enough to cancel
   * the base wall. This is the token weaponised: hold the only one and you have
   * a battering ram nobody else does; when the table is thick with outlaws and
   * everyone holds one, walls stop mattering and being an outlaw stops being
   * lonely. Holding it does this — spending it on a reseal (§2) does not, so it
   * is one or the other.
   */
  turncoatWallBreak: 2,
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
   * A repelled attacker pays the defender the same spoils they came for.
   *
   * Without this, defence is pure loss: walls are flat and passive, you cannot
   * spend anything on your own gate, and 92% of attacks broke through. With it,
   * digging in stops being a way to survive a round and becomes a way to profit
   * from one — a choice that furthers your own ends rather than a tax on having
   * enemies. The attacker's walls are down by definition, so their coronet is
   * on the table too.
   */
  repelSpoils: true,
  /**
   * The most gold one order may carry, or null for no cap.
   *
   * Null, on purpose. A cap made the throne unwinnable for the house that had
   * earned it: a player who had crushed the table could commit only 9 against a
   * crown three defenders were piling support onto, and lost their own coup to
   * the cap. A game you have dominated should not come down to whether the
   * others rally on a whim. Uncapped, raw gold decides — a dominant house buys
   * the throne, and a coalition still wins by rallying uncapped support behind a
   * champion. The crown floor (crownBase) is what keeps that from being trivial.
   */
  commitCap: null,

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
