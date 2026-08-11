// Put agents in the seats instead of the heuristic bots.
//
// The bots in src/engine/ai.js are a regression instrument: a thousand games a
// second, checking that nothing crashes, no seat has an edge, and no lane is
// dead. They are not a balance instrument any more. This game is decided at the
// deal table, and a scoring function cannot bargain — which is why a flat +1 or
// a tie-break looks unbeatable to them, and why the Spymaster looks weak.
//
// Usage:
//
//   import { playAgentGame } from './tools/agent-harness.js';
//   await playAgentGame({
//     players: 4,
//     doctrines: ['climber', 'shadow', 'raider', 'granary'],
//     ask: async ({ seat, system, prompt }) => callYourModel(system, prompt),
//   });
//
// `ask` receives a system brief (the rules plus that seat's strategy nudge) and
// a prompt (the board plus the question), and returns the raw text of a JSON
// answer. Everything else — legality, escrow, resolution — is the same engine
// the app runs on, so an agent cannot make an illegal move even if it tries.

import { Game } from '../src/engine/game.js';
import { createGame } from '../src/engine/state.js';
import { createAI, saltFor } from '../src/engine/ai.js';
import {
  DOCTRINE_BRIEFS, HOUSE_RULES, boardBriefing, parseDecision, requestBriefing,
} from '../src/engine/briefing.js';

/**
 * A seat controller backed by an agent.
 * @param {object} opts
 * @param {string} opts.doctrine strategy nudge, see DOCTRINE_BRIEFS
 * @param {(q: {seat, doctrine, system, prompt, request}) => Promise<any>} opts.ask
 * @param {object} [opts.fallback] controller used if the agent errors or stalls
 */
export function agentSeat({ seat, name, doctrine = 'opportunist', ask, fallback, onExchange }) {
  const system = [
    HOUSE_RULES,
    '',
    `You are ${name}. ${DOCTRINE_BRIEFS[doctrine] || DOCTRINE_BRIEFS.opportunist}`,
    '',
    'Answer with JSON only — no explanation, no code fence.',
  ].join('\n');

  return {
    kind: 'agent',
    doctrine,
    async decide(request, view) {
      const prompt = `${boardBriefing(view)}\n\n---\n${requestBriefing(request, view)}`;
      try {
        const raw = await ask({ seat, doctrine, system, prompt, request, view });
        const answer = parseDecision(raw, request);
        onExchange?.({ seat, request: request.type, prompt, raw, answer });
        return answer;
      } catch (err) {
        // A seat that will not answer must not hang the table.
        onExchange?.({ seat, request: request.type, error: String(err) });
        return fallback ? fallback.decide(request, view) : null;
      }
    },
  };
}

/**
 * Run one whole game with agents in some or all seats.
 * Seats without an `ask` fall back to the heuristic bot, so you can pit an
 * agent against the bots to see how much the deal table is actually worth.
 */
export async function playAgentGame({
  seed = Math.floor(Math.random() * 1e9),
  players = 4,
  doctrines = [],
  ask,
  agentSeats = null, // indices that get an agent; null means all of them
  tuning = {},
  options = {},
  onExchange,
} = {}) {
  const state = createGame({
    seed,
    tuning,
    options,
    seats: Array.from({ length: players }, (_, i) => ({
      kind: 'ai',
      doctrine: doctrines[i] || 'opportunist',
    })),
  });

  const controllers = {};
  for (const p of state.players) {
    const bot = createAI(p.personality, p.doctrine, saltFor(state.seed, p.seat));
    const wantsAgent = ask && (agentSeats === null || agentSeats.includes(p.seat));
    controllers[p.id] = wantsAgent
      ? agentSeat({ seat: p.seat, name: p.name, doctrine: p.doctrine, ask, fallback: bot, onExchange })
      : bot;
  }

  const game = new Game({ state, controllers });
  const winner = await game.run();
  return {
    seed,
    winner,
    state,
    standings: state.players.map((p) => ({
      seat: p.seat,
      name: p.name,
      doctrine: p.doctrine,
      fealty: p.fealty,
      lands: p.lands,
      gold: p.gold,
      titles: p.titles,
      won: !!winner?.playerIds.includes(p.id),
    })),
    deals: state.deals.length,
    rounds: state.round,
    how: winner ? winner.how : 'civil war',
  };
}

/** A stub `ask` that answers legally at random. Proves the wiring, tests nothing. */
export function randomAsk(rng = Math.random) {
  const pick = (xs) => xs[Math.floor(rng() * xs.length)];
  return async ({ request, view }) => {
    switch (request.type) {
      case 'order': {
        const order = pick(request.legal);
        const others = view.players.filter((p) => p.id !== view.me).map((p) => p.id);
        const me = view.players.find((p) => p.id === view.me);
        const cap = view.tuning.commitCap ?? me.gold;
        return JSON.stringify({
          order,
          target: pick([...others, 'crown']),
          gold: Math.max(1, Math.min(me.gold, cap, 1 + Math.floor(rng() * cap))),
        });
      }
      case 'proposeDeal': return 'null';
      case 'deal': return JSON.stringify({ accept: rng() < 0.4 });
      case 'levy': return rng() < 0.5 ? '"serve"' : '"refuse"';
      case 'title': return JSON.stringify(pick([...request.available, ...(request.claimable || []).map((c) => c.title)]));
      case 'spoils': return JSON.stringify({ kind: 'land' });
      case 'peekChoice': return rng() < 0.5 ? '"order"' : '"card"';
      case 'peekTarget': return JSON.stringify(pick(request.options));
      case 'turncoat': return JSON.stringify({ action: rng() < 0.5 ? 'change' : 'none' });
      default: return 'null';
    }
  };
}
