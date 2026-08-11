// Every number the game is made of, in one place.
//
// `V0_1` is the rules sheet exactly as written — the reference implementation,
// and what the test suite checks against. The other presets are the result of
// the bot tournaments in tools/simulate.js; see README for the numbers.

export const V0_1 = {
  // Setup (§1)
  startLands: 3,
  startGold: 5,
  startFealty: 0,
  neutralPool: 8,
  deck: { tax: 4, levy: 4, favor: 3, purge: 1 },

  // Crown (§1, §5)
  crownBase: 4,
  crownPerCard: 1,

  // Combat (§5, §7)
  walls: 2,
  // §2 — a favorite's attacks gain +fealty against anyone lower. The scale is
  // a knob because that bonus and the standing cost of hitting a favorite are
  // the two things that make the top of the track a safe place to sit.
  punchDownScale: 1,
  // §4 — what attacking costs the attacker, by the target's band.
  attackFealty: { favorite: -2, neutral: 0, outlaw: 1 },
  marshalBonus: 1,
  wardenBonus: 1,
  commitCap: null, // null = uncapped

  // Income (§3.4, §7)
  landIncome: 1,
  neutralIncome: 1,
  stewardIncome: 1,

  // Orders (§4)
  petitionCost: 2,
  pardonCost: 3,
  developCost: 3,

  // Crown deck (§6)
  taxByBand: { favorite: 1, neutral: 2, outlaw: 3 },
  chancellorRelief: 1,
  levyCost: 2,

  // Ransom module (§9)
  ransomTake: 2,
  ransomCrownGold: 5,
};

export const PRESETS = {
  'v0.1': {
    label: 'v0.1 — the rules as written',
    note: 'The original sheet. Bot testing ends every game in a coup around round six.',
    tuning: {},
  },
  tuned: {
    label: 'Tuned — the balanced default',
    note: 'Both roads to the throne stay live, the deck runs most of its length, and a usurpation needs a conspiracy.',
    tuning: {
      // A crown that decays from 18 to 6 rather than 16 to 4, against a
      // commitment cap of 6: no single purse can buy the throne outright, so
      // taking it means buying somebody's support first.
      crownBase: 6,
      commitCap: 6,
      // Gold has to leave the table faster than it arrives, or every game ends
      // in whoever hoarded hardest walking up to a bankrupt crown.
      taxByBand: { favorite: 2, neutral: 3, outlaw: 4 },
      levyCost: 4,
      deck: { tax: 5, levy: 4, favor: 2, purge: 1 },
      // Standing is the win condition, so it should not be the cheapest thing
      // on the board. At 2 gold the track was an escalator everybody rode.
      petitionCost: 3,
      pardonCost: 4,
    },
  },
};

export function resolveTuning(input = {}) {
  const { taxByBand, deck, attackFealty, ...rest } = input;
  return {
    ...V0_1,
    ...rest,
    taxByBand: { ...V0_1.taxByBand, ...(taxByBand || {}) },
    attackFealty: { ...V0_1.attackFealty, ...(attackFealty || {}) },
    deck: { ...V0_1.deck, ...(deck || {}) },
  };
}

export function presetTuning(name) {
  return resolveTuning(PRESETS[name]?.tuning || {});
}

export function deckSize(tuning) {
  return Object.values(tuning.deck).reduce((a, b) => a + b, 0);
}
