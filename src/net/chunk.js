// Splitting big messages so a data channel can carry them.
//
// PeerJS's JSON channel refuses any single message of 16300 bytes or more: it
// does not chunk (only its binary mode does), it just raises an error on the
// connection and throws the message away. That is a silent kill for us — a
// board view carries the whole chronicle, so it grows every round, and the
// first update to cross the line simply never arrives. The host then waits
// forever for a decision the player was never asked for.
//
// So nothing goes out unsplit. A message that would not fit is sent as a
// numbered run of `{__chunk}` envelopes and reassembled on the far side. The
// channel is reliable and ordered, so the pieces arrive, in order; the message
// id is there so a reassembly can never be confused by an interleaved one.

const MAX_BYTES = 15000; // comfortably under PeerJS's 16300-byte ceiling

const encoder = new TextEncoder();
const byteLength = (text) => encoder.encode(text).length;

/**
 * Cut a JSON string into pieces, each of which still fits once it has been
 * re-encoded as a JSON string of its own. Escapes and multi-byte characters
 * make that re-encoding bigger than the slice, so the cut is measured, not
 * assumed; and a cut never lands between the two halves of a surrogate pair.
 */
function slices(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let len = Math.min(text.length - i, MAX_BYTES);
    while (len > 1 && byteLength(JSON.stringify(text.slice(i, i + len))) > MAX_BYTES) {
      len = Math.ceil(len * 0.75);
    }
    const last = text.charCodeAt(i + len - 1);
    if (len > 1 && last >= 0xd800 && last <= 0xdbff && i + len < text.length) len -= 1;
    out.push(text.slice(i, i + len));
    i += len;
  }
  return out;
}

let nextId = 0;

/**
 * Hand `msg` to `write` as one message, or as several `{__chunk}` envelopes if
 * it is too big to go in one.
 */
export function sendChunked(write, msg) {
  const text = JSON.stringify(msg);
  if (byteLength(text) < MAX_BYTES) { write(msg); return; }
  const parts = slices(text);
  const id = `c${++nextId}`;
  parts.forEach((part, i) => write({ __chunk: { id, i, n: parts.length, part } }));
}

/**
 * Wrap a message handler so it sees whole messages: chunk envelopes are held
 * until the set is complete, everything else passes straight through. One of
 * these per channel — the pieces it is holding belong to that channel.
 */
export function receiveChunked(onMessage) {
  const pending = new Map(); // id -> {n, parts, have}
  return (frame) => {
    const c = frame && frame.__chunk;
    if (!c) { onMessage(frame); return; }
    let rec = pending.get(c.id);
    if (!rec) { rec = { n: c.n, parts: [], have: 0 }; pending.set(c.id, rec); }
    if (rec.parts[c.i] === undefined) rec.have += 1;
    rec.parts[c.i] = c.part;
    if (rec.have < rec.n) return;
    pending.delete(c.id);
    let msg;
    try { msg = JSON.parse(rec.parts.join('')); } catch { return; }
    onMessage(msg);
  };
}
