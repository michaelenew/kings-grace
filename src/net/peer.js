// WebRTC transport, over PeerJS.
//
// PeerJS (vendored, window.Peer) handles the ugly parts of WebRTC — STUN, ICE,
// reconnection — and gives us a simple room model: a peer has an id, and any
// other peer can open a data channel to it by that id. So the *host's* peer id
// is the room code, and each player opens a channel to it. This runs on GitHub
// Pages (no Content-Security-Policy jail); it cannot run inside a Claude
// artifact, whose CSP blocks the signalling.
//
// Signalling goes through PeerJS's free public broker (only the handshake — no
// game data ever touches it). If that broker is ever flaky, the fix is to point
// `PEER_OPTS` at a self-hosted PeerServer; nothing else changes.
//
// Everything that goes over a channel goes through sendChunked/receiveChunked,
// because PeerJS's JSON channel silently discards any message of 16300 bytes or
// more — and a board view grows with the chronicle, so a long game will reach
// that. See src/net/chunk.js.

import { sendChunked, receiveChunked } from './chunk.js';

const ROOM_PREFIX = 'kingsgraces-';
const PEER_OPTS = {}; // default free broker + Google STUN; swap for a self-host here
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes

export function makeRoomCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return code;
}

function requirePeer() {
  if (typeof window === 'undefined' || !window.Peer) {
    throw new Error('PeerJS is not loaded — vendor/peerjs.min.js must be included before the app.');
  }
  return window.Peer;
}

/**
 * Host side. Claims the room's peer id and accepts channels from players.
 *
 * @param {string} code  the room code (its peer id is ROOM_PREFIX + code)
 * @param {object} handlers
 *   onReady()                     the room id is live and listening
 *   onJoin(peerId)                a player's channel opened
 *   onLeave(peerId)               a player's channel closed
 *   onMessage(peerId, msg)        a message arrived from a player
 *   onError(err)                  fatal (e.g. the code was taken)
 * @returns transport + control: {send, broadcast, onMessage, peers, close}
 */
export function hostRoom(code, handlers = {}) {
  const Peer = requirePeer();
  const peer = new Peer(ROOM_PREFIX + code, PEER_OPTS);
  const conns = new Map(); // peerId -> DataConnection
  let messageHandler = handlers.onMessage || (() => {});

  peer.on('open', () => handlers.onReady && handlers.onReady(code));
  peer.on('error', (err) => handlers.onError && handlers.onError(err));
  peer.on('connection', (conn) => {
    // One reassembler per channel, calling whatever the current handler is —
    // createHost swaps it in when the game starts.
    const receive = receiveChunked((msg) => messageHandler(conn.peer, msg));
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      handlers.onJoin && handlers.onJoin(conn.peer);
    });
    conn.on('data', (data) => receive(data));
    conn.on('close', () => { conns.delete(conn.peer); handlers.onLeave && handlers.onLeave(conn.peer); });
    // A dropped channel surfaces as close; anything else is worth a line in the
    // console, because a channel error that nobody ever sees is how a game ends
    // up waiting forever for a message that was never delivered.
    conn.on('error', (err) => console.warn('The King’s Graces: data channel error', err));
  });

  return {
    send: (peerId, msg) => { const c = conns.get(peerId); if (c && c.open) sendChunked((m) => c.send(m), msg); },
    broadcast: (msg) => { for (const c of conns.values()) if (c.open) sendChunked((m) => c.send(m), msg); },
    onMessage: (fn) => { messageHandler = fn; },
    peers: () => [...conns.keys()],
    close: () => { for (const c of conns.values()) c.close(); peer.destroy(); },
  };
}

/**
 * Player side. Opens a channel to the host's room.
 *
 * @param {string} code
 * @param {object} handlers  onReady(myPeerId), onMessage(msg), onClose(), onError(err)
 * @returns {{send, onMessage, close}}
 */
export function joinRoom(code, handlers = {}) {
  const Peer = requirePeer();
  const peer = new Peer(PEER_OPTS);
  let conn = null;
  let messageHandler = handlers.onMessage || (() => {});

  peer.on('open', (myId) => {
    // JSON serialization, not PeerJS's default binary pack: our messages are
    // plain objects, some large (a board view), and binary pack has been flaky
    // with big nested objects. The initiator's choice governs both directions.
    conn = peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'json' });
    const receive = receiveChunked((msg) => messageHandler(msg));
    conn.on('open', () => handlers.onReady && handlers.onReady(myId));
    conn.on('data', (data) => receive(data));
    conn.on('close', () => handlers.onClose && handlers.onClose());
    conn.on('error', (err) => handlers.onError && handlers.onError(err));
  });
  peer.on('error', (err) => handlers.onError && handlers.onError(err));

  return {
    send: (msg) => { if (conn && conn.open) sendChunked((m) => conn.send(m), msg); },
    onMessage: (fn) => { messageHandler = fn; },
    close: () => { if (conn) conn.close(); peer.destroy(); },
  };
}
