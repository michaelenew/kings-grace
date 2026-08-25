import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/engine/game.js';
import { createGame, legalOrders, legalTargets } from '../src/engine/state.js';
import { createAI, saltFor } from '../src/engine/ai.js';
import { CROWN, ORDER } from '../src/engine/constants.js';
import { createHost } from '../src/net/host.js';

// A generic responder: give any request a legal, harmless answer. Stands in for
// both a local seat's controller and a remote peer's UI.
function autoAnswer(state, pid, request) {
  switch (request.type) {
    case 'order': {
      const legal = request.legal;
      if (legal.includes(ORDER.DEVELOP)) return { order: ORDER.DEVELOP };
      if (legal.includes(ORDER.PETITION)) return { order: ORDER.PETITION };
      if (legal.includes(ORDER.SUPPORT)) return { order: ORDER.SUPPORT, target: pid, gold: 1 };
      return { order: legal[0], gold: 1, target: null };
    }
    case 'levy': return 'serve';
    case 'title': return request.available?.[0] ?? request.claimable?.[0]?.title ?? null;
    case 'spoils': return { kind: 'land' };
    case 'peekChoice': return 'order';
    case 'peekTarget': return request.options?.[0] ?? null;
    case 'turncoat': return { action: 'none' };
    case 'deal': return { accept: false };
    default: return null;
  }
}

// A minimal in-memory transport bus. One host, many clients, JSON-cloned
// messages delivered on a later microtask so nothing resolves re-entrantly —
// the same asynchrony a real data channel has, without a network.
function makeBus() {
  const handlers = {}; // peerId -> (from, msg) => void   ('host' is the authority)
  const clone = (m) => JSON.parse(JSON.stringify(m));
  const deliver = (to, from, msg) => Promise.resolve().then(() => handlers[to]?.(from, clone(msg)));
  return {
    hostTransport: {
      send: (peerId, msg) => deliver(peerId, 'host', msg),
      onMessage: (fn) => { handlers.host = fn; },
    },
    clientTransport: (peerId) => ({
      send: (msg) => deliver('host', peerId, msg),
      onMessage: (fn) => { handlers[peerId] = fn; },
    }),
  };
}

// A scripted remote player: answers requests and records the views it is sent.
function scriptedClient(pid, transport) {
  const seen = [];
  transport.onMessage((_from, msg) => {
    if (msg.t === 'view') { seen.push(msg.view); return; }
    if (msg.t === 'request') {
      const answer = autoAnswer(null, pid, msg.request);
      transport.send({ t: 'answer', pid, rid: msg.rid, answer });
    }
  });
  transport.send({ t: 'hello' });
  return { seen };
}

test('a whole game plays out over the network, host-authoritative', async () => {
  const state = createGame({ seed: 11, seats: Array.from({ length: 4 }, () => ({ kind: 'human' })) });
  const bus = makeBus();

  const seats = [
    { pid: 'p0', kind: 'local', controller: { kind: 'human', decide: (req) => autoAnswer(state, 'p0', req) } },
    { pid: 'p1', kind: 'remote', peerId: 'p1' },
    { pid: 'p2', kind: 'remote', peerId: 'p2' },
    { pid: 'p3', kind: 'bot', controller: createAI('balanced', 'opportunist', saltFor(state.seed, 3)) },
  ];

  const game = new Game({ state, controllers: {} });
  const host = createHost({ game, transport: bus.hostTransport, seats });
  game.controllers = host.controllers;

  const c1 = scriptedClient('p1', bus.clientTransport('p1'));
  const c2 = scriptedClient('p2', bus.clientTransport('p2'));

  const winner = await game.run();

  // It reached an ending, and the remote seats were kept in the loop.
  assert.ok(state.phase === 'gameOver');
  assert.ok(c1.seen.length > 5, 'p1 received a stream of board updates');
  assert.ok(c2.seen.length > 5, 'p2 received a stream of board updates');

  // Redaction held the whole way. Before the orders are revealed, no view a peer
  // received ever exposed another house's escrowed gold, and the only sealed
  // order it could see was its own (or one it had peeked — flagged as such).
  let checkedHidden = 0;
  for (const view of [...c1.seen, ...c2.seen]) {
    if (view.revealed) continue; // after reveal, everything is public by design
    checkedHidden += 1;
    for (const p of view.players) {
      if (p.id === view.me) continue;
      assert.equal(p.escrow, 0, 'another house never shows escrow to a peer');
    }
    for (const [oid, c] of Object.entries(view.commitments || {})) {
      assert.ok(oid === view.me || c.peeked, 'a peer sees only its own sealed order (or one it peeked)');
    }
  }
  assert.ok(checkedHidden > 0, 'there were pre-reveal views to check redaction on');

  void winner; // may be null (civil war) — the point is the loop completed cleanly
});

test('a seat may only act as itself — an action from the wrong peer is ignored', async () => {
  const state = createGame({ seed: 4, seats: Array.from({ length: 3 }, () => ({ kind: 'human' })) });
  state.phase = 'commit'; // deals are open
  const bus = makeBus();
  const seats = [
    { pid: 'p0', kind: 'local', controller: { kind: 'human', decide: () => null } },
    { pid: 'p1', kind: 'remote', peerId: 'peer-1' },
    { pid: 'p2', kind: 'remote', peerId: 'peer-2' },
  ];
  const game = new Game({ state, controllers: {} });
  const host = createHost({ game, transport: bus.hostTransport, seats });
  game.controllers = host.controllers;

  const tick = () => new Promise((r) => setTimeout(r, 5));

  // peer-2 forges a promise in p1's name.
  bus.clientTransport('peer-2').send({ t: 'action', pid: 'p1', method: 'declarePromise', args: { intent: { to: 'p0', kind: 'standDown' } } });
  await tick();
  assert.equal((state.promises || []).filter((x) => x.from === 'p1').length, 0, 'the forged promise is rejected');

  // p1's own peer makes the same promise — now it is recorded.
  bus.clientTransport('peer-1').send({ t: 'action', pid: 'p1', method: 'declarePromise', args: { intent: { to: 'p0', kind: 'standDown' } } });
  await tick();
  assert.equal((state.promises || []).filter((x) => x.from === 'p1').length, 1, 'the honest promise lands');
});
