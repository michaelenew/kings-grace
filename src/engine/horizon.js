// How far ahead a house is supposed to be thinking.
//
// This is a design decision with a number attached, and it belongs in one place
// because almost every judgement in the game is secretly a judgement about it.
// A land is a stream of gold — over how long? Fealty is a claim on a throne —
// how many rounds away? Betraying somebody pays now and costs later — how much
// later is "later"?
//
// The game is at its best at a horizon of about three moves: this one and two
// more, with the two together mattering slightly less than the one in hand. So:
//
//     this move   0.53
//     next        0.28   ┐ 0.47 between them, against 0.53 for the move
//     the one after 0.19 ┘ you are actually making
//
// Renormalised to 1 for the move in hand, that is [1, 0.53, 0.36].
//
// Beyond three there is a deliberate tail rather than a cliff. A cliff would
// make a house at round one blind to the fact that the game ends at all, which
// is not far-sightedness, it is amnesia. The tail keeps distant things faintly
// visible and no more.
//
// WHY IT MATTERS. Before this existed, everything was valued over the *whole
// remaining deck*: a land bought on round two was priced at eleven more rounds
// of income, which made building and climbing overwhelmingly correct and made
// fighting — a cost now for a gain now — look like a waste. That is most of why
// a winner's turns came out 44% building, 15% attacking.

/** This move, and the two that matter after it. */
export const WINDOW = [1, 0.53, 0.36];

/** What is left beyond the window: visible, and not much more than that. */
const TAIL_RATIO = 0.55;
const TAIL_FLOOR = 0.04;

/**
 * What a payoff `k` moves from now is worth against the same payoff now.
 * k = 0 is this move.
 */
export function horizonWeight(k) {
  if (k < 0) return 0;
  if (k < WINDOW.length) return WINDOW[k];
  const beyond = k - (WINDOW.length - 1);
  return Math.max(TAIL_FLOOR, WINDOW[WINDOW.length - 1] * TAIL_RATIO ** beyond);
}

/**
 * What a stream of `perRound` is worth, given `remaining` rounds of game left
 * to collect it in. This is the replacement for `x * roundsRemaining`, which
 * priced a field bought on round two at eleven harvests.
 */
export function streamValue(perRound, remaining) {
  if (!perRound || remaining <= 0) return 0;
  let total = 0;
  for (let k = 0; k < remaining; k++) {
    const w = horizonWeight(k);
    total += w;
    if (w <= TAIL_FLOOR && k >= WINDOW.length + 4) break; // converged
  }
  return perRound * total;
}

/**
 * What a payoff that only arrives when the deck runs out is worth right now —
 * the throne itself, and the land and gold that break a tie for it. Close to
 * the end this is the only thing that matters; far from it, it is a rumour.
 */
export function endgameWeight(remaining) {
  return horizonWeight(Math.max(0, remaining - 1));
}

/**
 * A cost that lands later, weighed against a gain that lands now — which is
 * the whole shape of a betrayal. The reputation you spend is spent over the
 * next couple of moves, so it is worth what those moves are worth.
 */
export const LATER = WINDOW[1] + WINDOW[2];
