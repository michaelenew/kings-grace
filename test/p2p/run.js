// A real peer-to-peer run: one host and one or more guests, each a separate
// browser in a worker of its own, each running the actual src/ui/app.js. The
// only thing faked is the wire — this parent process is the signalling broker
// and the relay, standing in for PeerJS's channel, ceiling and all.
//
//   node test/p2p/run.js [--guests 1] [--table 3] [--animate]
//
// It drives a whole game and fails if anybody stops making progress, which is
// the bug this exists for: a seat that sits on a spinner forever.
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1]);
};
const GUESTS = Number(arg('--guests', 1));
const TABLE = Number(arg('--table', 0)) || null;
const ANIMATE = process.argv.includes('--animate');
const STALL_MS = Number(arg('--stall', 25000)); // no progress for this long = frozen
const RUN_MS = Number(arg('--timeout', 180000));

const log = (...a) => console.log(...a);

// --------------------------------------------------------------- the "network"
const peers = new Map(); // peer id -> worker
const links = new Map(); // connId -> {a: worker, b: worker}
const wire = { frames: 0, bytes: 0, biggest: 0, dropped: 0 };

const browsers = [];
function spawn(role, name) {
  const worker = new Worker(path.join(HERE, 'browser.js'), {
    workerData: { role, name, tableSize: role === 'host' ? TABLE : null, animate: ANIMATE },
  });
  const state = { role, name, worker, ready: false, lastMoveAt: Date.now(), last: null, problems: [], over: false };
  browsers.push(state);

  worker.on('message', (m) => {
    if (m.type === 'register') {
      peers.set(m.id, worker);
      worker.postMessage({ type: 'peer-open', id: m.id });
      return;
    }
    if (m.type === 'connect') {
      const target = peers.get(m.to);
      if (!target) { worker.postMessage({ type: 'peer-error', detail: 'peer-unavailable' }); return; }
      links.set(m.connId, { a: worker, b: target });
      target.postMessage({ type: 'incoming', connId: m.connId, from: m.from });
      setTimeout(() => {
        worker.postMessage({ type: 'conn-open', connId: m.connId });
        target.postMessage({ type: 'conn-open', connId: m.connId });
      }, 5);
      return;
    }
    if (m.type === 'data') {
      const link = links.get(m.connId);
      if (!link) return;
      const other = link.a === worker ? link.b : link.a;
      setTimeout(() => other.postMessage({ type: 'data', connId: m.connId, text: m.text }), 1);
      return;
    }
    if (m.type === 'close') {
      const link = links.get(m.connId);
      if (!link) return;
      const other = link.a === worker ? link.b : link.a;
      other.postMessage({ type: 'conn-close', connId: m.connId });
      return;
    }
    if (m.type === 'wire') {
      wire.frames += 1; wire.bytes += m.bytes; wire.biggest = Math.max(wire.biggest, m.bytes);
      if (m.bytes >= 16300) wire.dropped += 1;
      return;
    }
    if (m.type === 'problem') { state.problems.push(m.text); log(`  ! ${role}: ${m.text.split('\n')[0]}`); return; }
    if (m.type === 'ready') { state.ready = true; return; }
    if (m.type === 'code') { state.code = m.code; return; }
    if (m.type === 'report') {
      if (m.moved || JSON.stringify(m.why) !== JSON.stringify(state.last?.why)) state.lastMoveAt = Date.now();
      state.last = m;
      if (m.over) state.over = true;
      return;
    }
  });
  worker.on('error', (e) => { state.problems.push(String(e?.stack || e)); log(`  ! ${role} worker: ${e}`); });
  return state;
}

const until = async (what, predicate, ms = 15000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};

// ------------------------------------------------------------------ the story
const host = spawn('host', 'Aveline');
const guests = Array.from({ length: GUESTS }, (_, i) => spawn('guest', ['Bea', 'Cass', 'Dain', 'Eda', 'Fen'][i]));

await until('every browser to load', () => browsers.every((b) => b.ready));
host.worker.postMessage({ type: 'act', what: 'host' });
await until('the room code', () => host.code && host.code !== '····');
log(`room ${host.code} — host + ${GUESTS} guest${GUESTS === 1 ? '' : 's'}${TABLE ? `, table of ${TABLE}` : ' (default table size)'}`);

for (const g of guests) g.worker.postMessage({ type: 'act', what: 'join', code: host.code });
await until('every guest in the lobby', () => guests.every((g) => g.last?.screen === 'lobby'), 20000);
log('all guests are in the lobby');

host.worker.postMessage({ type: 'act', what: 'start' });
await until('everyone on the board', () => browsers.every((b) => b.last?.screen === 'game'), 20000);
log('game started; everyone is on the board');

// Now just watch. Somebody stops moving for STALL_MS, and that is the bug.
const started = Date.now();
let verdict = null;
while (!verdict) {
  await new Promise((r) => setTimeout(r, 250));
  const stuck = browsers.filter((b) => !b.over && Date.now() - b.lastMoveAt > STALL_MS);
  if (browsers.every((b) => b.over)) verdict = { ok: true, why: 'the game reached its end for everybody' };
  else if (stuck.length) verdict = { ok: false, why: 'frozen', stuck };
  else if (Date.now() - started > RUN_MS) verdict = { ok: false, why: 'the run ran out of time', stuck: browsers };
}

log('');
for (const b of browsers) {
  const w = b.last?.why;
  log(`${b.role.padEnd(5)} ${String(b.name).padEnd(8)} seat ${String(w?.seat ?? '—').padEnd(4)} ` +
    `screen ${String(w?.screen).padEnd(6)} round ${String(w?.round ?? '—').padEnd(3)} phase ${String(w?.phase ?? '—').padEnd(11)} ` +
    `pending ${w?.pending ? w.pending.type : '—'} paused ${w?.paused ? w.paused.kind : '—'} ` +
    `waitingOn ${JSON.stringify(w?.waitingOnPeers ?? [])}`);
  log(`      stage: ${b.last?.stage || '(nothing)'}`);
  if (b.problems.length) log(`      problems: ${b.problems.length} — ${b.problems[0].split('\n')[0]}`);
}
log('');
log(`wire: ${wire.frames} frames, biggest ${wire.biggest} bytes, ${wire.dropped} over PeerJS's 16300-byte ceiling`);
log(verdict.ok ? `PASS — ${verdict.why}` : `FAIL — ${verdict.why}: ${verdict.stuck.map((b) => b.role).join(', ')} stopped moving`);

for (const b of browsers) await b.worker.terminate();
process.exit(verdict.ok ? 0 : 1);
