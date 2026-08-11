import { Game } from '../src/engine/game.js';
import { createGame } from '../src/engine/state.js';

/**
 * A controller that answers from a map of request type -> value or function.
 * Anything unspecified falls back to a sane default so tests only declare the
 * decisions they actually care about.
 */
export function stub(map = {}) {
  return {
    kind: 'test',
    decide(request, view) {
      const entry = map[request.type];
      if (entry !== undefined) return typeof entry === 'function' ? entry(request, view) : entry;
      switch (request.type) {
        case 'order': return { order: request.legal[0], gold: 1, target: null };
        case 'levy': return 'serve';
        case 'title': return request.available[0] ?? request.claimable[0]?.title;
        case 'spoils': return { kind: 'land' };
        case 'peekChoice': return 'order';
        case 'peekTarget': return request.options[0];
        case 'turncoat': return { action: 'none' };
        case 'turncoatGranted': return { action: 'none' };
        default: return null;
      }
    },
  };
}

/** Four seats, all scripted. `controllers` may be a map of pid -> stub map. */
export function makeGame({ seed = 7, options = {}, tuning = {}, controllers = {}, players = 4, setup } = {}) {
  const state = createGame({
    seed,
    options,
    tuning,
    seats: Array.from({ length: players }, () => ({ kind: 'human' })),
  });
  const ctrls = {};
  for (const p of state.players) ctrls[p.id] = stub(controllers[p.id] || {});
  const game = new Game({ state, controllers: ctrls });
  if (setup) setup(state);
  return game;
}

export const P = ['p0', 'p1', 'p2', 'p3'];

export function set(state, pid, fields) {
  Object.assign(state.players.find((p) => p.id === pid), fields);
}

export function get(state, pid) {
  return state.players.find((p) => p.id === pid);
}

/**
 * Did this attack break through? Reads the combat log rather than counting the
 * defender's fields, because who ends up holding what depends on the spoils
 * rules — and these tests are about whether the blow landed.
 */
export function brokeThrough(state, attackerId, defenderId) {
  const name = (id) => state.players.find((p) => p.id === id).name;
  const line = state.log.filter((e) => e.kind === 'combat'
    && e.text.startsWith(`${name(attackerId)} strikes at ${name(defenderId)}`)).pop();
  if (!line) throw new Error(`no attack from ${attackerId} on ${defenderId} in the log`);
  return line.text.includes('breaks through');
}

/** Give every player a legal, harmless order unless one was already committed. */
export function fillOrders(game, orders) {
  for (const [pid, order] of Object.entries(orders)) game.commit(pid, order);
}
