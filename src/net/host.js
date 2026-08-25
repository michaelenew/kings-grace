// The host side of a networked game.
//
// One peer is the authority: it holds the real Game and runs the engine. Every
// other player is a *seat* driven over a transport. The engine already asks each
// seat for its decisions through `decide(request, view)` and already builds a
// redacted per-seat view with `viewFor` — so a remote seat is just a controller
// whose `decide` ships the request (and only that seat's view) to that peer and
// waits for the answer to come back. Secrets never leave the host: a peer only
// ever receives `viewFor(state, theirSeat)`, the same thing a bot would see.
//
// The transport is deliberately tiny so this is testable without any real
// network — see test/net.test.js, which plays a whole game over an in-memory
// pair. A transport is:
//   send(peerId, msg)      deliver a JSON-able message to one peer
//   onMessage((from, msg)) register a handler for messages from peers
//
// Messages, host <-> peer:
//   host -> peer:  {t:'view', view}                 render your board from this
//                  {t:'request', pid, rid, request, view}   decide, then answer
//   peer -> host:  {t:'hello'}                       (re)connected; send me state
//                  {t:'answer', pid, rid, answer}    my decision
//                  {t:'action', pid, method, args}   a free action (a deal, a word)

import { viewFor } from '../engine/state.js';

// The free actions a seat may take outside the decision flow (while the deal
// table is open). Each maps to a method already on the Game. Listed explicitly
// so a peer can never invoke anything else on the authority.
const ACTIONS = {
  proposeDealTable: (game, pid, a) => game.proposeDealTable(pid, a.transfers || []),
  acceptDeal: (game, pid) => game.acceptDeal(pid),
  clearDeal: (game, pid, a) => game.clearDeal(pid, a.reason),
  declarePromise: (game, pid, a) => game.declarePromise(pid, a.intent || a),
};

/**
 * Wire a Game up for hosting.
 *
 * @param {object} opts
 * @param {Game} opts.game
 * @param {object} opts.transport  {send(peerId,msg), onMessage(fn)}
 * @param {Array} opts.seats  [{pid, kind:'local'|'remote'|'bot', peerId?, controller?}]
 *   local/bot seats supply their own controller; remote seats are driven here.
 * @returns {{controllers: object, broadcast: () => void}}
 */
export function createHost({ game, transport, seats }) {
  const controllers = {};
  const remotes = {}; // pid -> { peerId, pending: {rid, resolve, request, view} | null }
  let rid = 0;

  for (const seat of seats) {
    if (seat.kind === 'remote') {
      const rec = { peerId: seat.peerId, pending: null };
      remotes[seat.pid] = rec;
      // A remote seat looks like a human to the engine (it is one) — so the
      // auto-deal invitations meant for bots skip it, and its decisions come
      // from a person, over the wire.
      controllers[seat.pid] = {
        kind: 'human',
        decide(request, view) {
          return new Promise((resolve) => {
            const myRid = ++rid;
            rec.pending = { rid: myRid, resolve, request, view };
            transport.send(rec.peerId, { t: 'request', pid: seat.pid, rid: myRid, request, view });
          });
        },
      };
    } else {
      controllers[seat.pid] = seat.controller;
    }
  }

  const peerToSeat = (peerId) => seats.find((s) => s.kind === 'remote' && s.peerId === peerId);

  // Every view carries `you` — the seat it is for — so a client learns its seat
  // from any board update, not from one fragile hand-off message.
  function viewTo(seat) {
    transport.send(seat.peerId, { t: 'view', you: seat.pid, view: viewFor(game.state, seat.pid) });
  }

  function resendPending(seat) {
    const rec = remotes[seat.pid];
    if (rec && rec.pending) {
      transport.send(seat.peerId, { t: 'request', pid: seat.pid, rid: rec.pending.rid, request: rec.pending.request, view: rec.pending.view });
    }
  }

  /** Push every remote seat its current redacted view. Fired on any state change. */
  function broadcast() {
    for (const seat of seats) if (seat.kind === 'remote') viewTo(seat);
  }

  transport.onMessage(async (from, msg) => {
    if (!msg || typeof msg !== 'object') return;
    let seat = peerToSeat(from);

    // Reconnect: a player who refreshed comes back as a NEW peer id. Match them
    // to their seat by name and re-point it at the new channel, then catch them
    // up. (Names are unique enough for a friendly table; a collision just picks
    // the first free one.)
    if (msg.t === 'join') {
      if (seat) { viewTo(seat); resendPending(seat); return; }
      const taken = new Set(seats.filter((s) => s.kind === 'remote').map((s) => s.peerId).filter((p) => transport.peers?.().includes?.(p)));
      const match = seats.find((s) => s.kind === 'remote' && s.name && s.name === msg.name && !taken.has(s.peerId))
        || seats.find((s) => s.kind === 'remote' && s.name === msg.name);
      if (match) {
        match.peerId = from;
        if (remotes[match.pid]) remotes[match.pid].peerId = from;
        viewTo(match);
        resendPending(match);
      }
      return;
    }

    if (msg.t === 'hello') {
      // A peer (re)connected. Send its board, and re-send any decision it still
      // owes us so a mid-turn reconnect is not stuck.
      if (!seat) return;
      viewTo(seat);
      resendPending(seat);
      return;
    }

    if (msg.t === 'answer') {
      const rec = remotes[msg.pid];
      // Only the peer that owns the seat, answering the request we are waiting on.
      if (rec && rec.peerId === from && rec.pending && rec.pending.rid === msg.rid) {
        const { resolve } = rec.pending;
        rec.pending = null;
        resolve(msg.answer);
      }
      return;
    }

    if (msg.t === 'action') {
      // A seat may only act as itself, and only through the allow-listed methods.
      if (!seat || seat.pid !== msg.pid) return;
      const fn = ACTIONS[msg.method];
      if (!fn) return;
      try { await fn(game, msg.pid, msg.args || {}); } catch { /* an illegal action is just ignored */ }
      // game.notify() (via the method) triggers broadcast through the subscription.
    }
  });

  game.subscribe(() => broadcast());

  return { controllers, broadcast };
}
