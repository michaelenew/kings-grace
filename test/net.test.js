import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/engine/game.js';
import { createGame, legalOrders, legalTargets } from '../src/engine/state.js';
import { createAI, saltFor } from '../src/engine/ai.js';
import { CROWN, ORDER } from '../src/engine/constants.js';
import { createHost } from '../src/net/host.js';
import { sendChunked, receiveChunked } from '../src/net/chunk.js';

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

// --------------------------------------------------- the channel's frame limit

// PeerJS's JSON data channel discards, silently, any single message of 16300
// bytes or more — it does not split them the way its binary mode does. A board
// view carries the whole chronicle, so it grows every round, and the first
// update to cross that line used to vanish: the player was never asked for a
// decision, and the host waited for an answer that could not come. Every send
// now goes through sendChunked/receiveChunked, so size cannot kill a game.
const FRAME_LIMIT = 16300;

/** A link that behaves like the real channel: an oversized frame is thrown away. */
function makeCappedBus() {
  const handlers = {};
  const sent = [];
  const write = (to, from, frame) => {
    const bytes = Buffer.byteLength(JSON.stringify(frame), 'utf8');
    sent.push(bytes);
    if (bytes >= FRAME_LIMIT) return; // dropped on the floor, exactly as PeerJS does
    Promise.resolve().then(() => handlers[to]?.(from, JSON.parse(JSON.stringify(frame))));
  };
  return {
    sent,
    hostTransport: {
      send: (peerId, msg) => sendChunked((f) => write(peerId, 'host', f), msg),
      onMessage: (fn) => {
        const per = {}; // one reassembler per channel, as in src/net/peer.js
        handlers.host = (from, frame) => { (per[from] ||= receiveChunked((msg) => fn(from, msg)))(frame); };
      },
    },
    clientTransport: (peerId) => ({
      send: (msg) => sendChunked((f) => write('host', peerId, f), msg),
      onMessage: (fn) => {
        const receive = receiveChunked((msg) => fn(null, msg));
        handlers[peerId] = (_from, frame) => receive(frame);
      },
    }),
  };
}

test('a message far past the channel’s frame limit still arrives whole', () => {
  const frames = [];
  let got = null;
  const receive = receiveChunked((msg) => { got = msg; });
  // Awkward on purpose: long, and full of the multi-byte punctuation the
  // chronicle actually uses, so the byte length is not the character length.
  const big = {
    t: 'view',
    view: { log: Array.from({ length: 900 }, (_, i) => ({ round: i, text: `Round ${i}: the Crown’s levy — “send your host” — and 𝔎 answers.` })) },
  };
  assert.ok(Buffer.byteLength(JSON.stringify(big), 'utf8') > 4 * FRAME_LIMIT, 'the fixture really is oversized');

  sendChunked((f) => frames.push(f), big);
  assert.ok(frames.length > 1, 'an oversized message is split');
  for (const f of frames) {
    assert.ok(Buffer.byteLength(JSON.stringify(f), 'utf8') < FRAME_LIMIT, 'every frame fits the channel');
  }
  for (const f of frames) receive(JSON.parse(JSON.stringify(f)));
  assert.deepEqual(got, big, 'and is reassembled exactly');
});

test('a small message is sent as itself, not wrapped in a chunk', () => {
  const frames = [];
  sendChunked((f) => frames.push(f), { t: 'hello' });
  assert.deepEqual(frames, [{ t: 'hello' }]);
});

test('a whole game plays out when the board is bigger than one frame', async () => {
  const state = createGame({ seed: 21, seats: Array.from({ length: 4 }, () => ({ kind: 'human' })) });
  // Start from a chronicle that already overflows a frame, which is where a
  // long game ends up anyway — every view from here on has to be split.
  for (let i = 0; i < 400; i++) {
    state.log.push({ round: 0, kind: 'setup', text: `An old line of the chronicle, number ${i}, kept for the record.` });
  }
  const bus = makeCappedBus();
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

  // Without splitting, the first oversized view never lands and this never
  // settles — the hang the host saw as a panel spinning forever.
  const winner = await Promise.race([
    game.run(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('the host is still waiting on a peer')), 10000)),
  ]);

  assert.equal(state.phase, 'gameOver', 'the game reached its end');
  assert.ok(c1.seen.length > 0 && c2.seen.length > 0, 'both peers were kept up to date');
  assert.ok(bus.sent.some((n) => n > FRAME_LIMIT / 2), 'the run really did push big payloads');
  assert.ok(bus.sent.every((n) => n < FRAME_LIMIT), 'nothing was ever offered to the channel oversized');
  void winner;
});

// ------------------------------------------------------- the chronicle window

// A view is mostly its chronicle, and the chronicle only grows. The host keeps
// the whole thing; a peer is sent a window of it — this round and the two
// before — so an update stays the same size in round twelve as in round two.
// See WIRE_ROUNDS in src/net/host.js.
const WIRE_ROUNDS = 3;

test('a peer is sent a window of the chronicle, not the whole history', async () => {
  const state = createGame({ seed: 31, seats: Array.from({ length: 4 }, () => ({ kind: 'human' })) });
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
  await game.run();

  assert.ok(state.round > WIRE_ROUNDS, 'the game ran long enough for there to be history to cut');
  const seen = [...c1.seen, ...c2.seen];

  for (const view of seen) {
    for (const entry of view.log) {
      assert.ok(entry.round >= view.round - (WIRE_ROUNDS - 1), 'nothing older than the window is sent');
    }
  }

  // The current round always arrives whole — the round recap is drawn from it.
  const finals = seen.filter((v) => v.round === state.round);
  const hostHas = state.log.filter((l) => l.round === state.round && (!l.secret || l.pid === 'p1')).length;
  const peerHas = finals[finals.length - 1].log.filter((l) => l.round === state.round).length;
  assert.equal(peerHas, hostHas, 'this round reaches the peer in full');

  // And the cut is visible rather than silent.
  assert.ok(
    seen.some((v) => v.log[0] && v.log[0].text.startsWith('Earlier rounds')),
    'a trimmed chronicle says so',
  );

  // The point of all of it: a board update stops growing with the game.
  const size = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
  const late = Math.max(...seen.filter((v) => v.round >= state.round - 1).map(size));
  assert.ok(late < FRAME_LIMIT, `a late view still fits one frame (was ${late} bytes)`);
});
