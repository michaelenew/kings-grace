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
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      handlers.onJoin && handlers.onJoin(conn.peer);
    });
    conn.on('data', (data) => messageHandler(conn.peer, data));
    conn.on('close', () => { conns.delete(conn.peer); handlers.onLeave && handlers.onLeave(conn.peer); });
    conn.on('error', () => { /* a dropped channel surfaces as close */ });
  });

  return {
    send: (peerId, msg) => { const c = conns.get(peerId); if (c && c.open) c.send(msg); },
    broadcast: (msg) => { for (const c of conns.values()) if (c.open) c.send(msg); },
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
    conn = peer.connect(ROOM_PREFIX + code, { reliable: true });
    conn.on('open', () => handlers.onReady && handlers.onReady(myId));
    conn.on('data', (data) => messageHandler(data));
    conn.on('close', () => handlers.onClose && handlers.onClose());
    conn.on('error', (err) => handlers.onError && handlers.onError(err));
  });
  peer.on('error', (err) => handlers.onError && handlers.onError(err));

  return {
    send: (msg) => { if (conn && conn.open) conn.send(msg); },
    onMessage: (fn) => { messageHandler = fn; },
    close: () => { if (conn) conn.close(); peer.destroy(); },
  };
}
