// One browser, in a worker of its own.
//
// The point of the isolation is that src/ui/app.js is a singleton: it grabs its
// root element and its whole `app` object at import time, off the globals. Two
// instances in one process would share them and prove nothing. A worker each
// gives us a real host and a real guest, both running the actual client code,
// with only the data channel between them faked.
import { parentPort, workerData } from 'node:worker_threads';
import { JSDOM } from 'jsdom';

const { role, name, tableSize } = workerData;
const say = (type, body = {}) => parentPort.postMessage({ type, role, ...body });

// ---------------------------------------------------------------- the browser

const dom = new JSDOM(
  '<!doctype html><html><body><div id="app"></div><dialog id="rules-dialog"></dialog></body></html>',
  { pretendToBeVisual: true, url: 'https://example.test/' },
);
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.HTMLElement = dom.window.HTMLElement;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
global.confirm = () => true;
// jsdom measures everything as zero, which makes the table layout bail on its
// first line; and it has no Web Animations API. Both would hide real code.
const measure = (prop, fn) => Object.defineProperty(dom.window.HTMLElement.prototype, prop, { get() { return fn(this); }, configurable: true });
measure('offsetWidth', (e) => (e.classList.contains('centre') ? 230 : 250));
measure('offsetHeight', (e) => (e.classList.contains('centre') ? 190 : 300));
measure('clientWidth', () => 640);
dom.window.Element.prototype.getBoundingClientRect = () => ({ top: 130, left: 0, right: 640, bottom: 760, width: 640, height: 630, x: 0, y: 130, toJSON: () => ({}) });
for (const proto of [dom.window.Element.prototype, dom.window.SVGElement.prototype]) {
  proto.animate = function animate(_frames, opts = {}) {
    let settle;
    const finished = new Promise((r) => { settle = r; });
    setTimeout(() => settle(this), Math.max(1, Math.round(((opts.duration || 0) + (opts.delay || 0)) / 40)));
    return { finished, cancel() {}, finish() { settle(this); } };
  };
}

const problems = [];
process.on('unhandledRejection', (e) => { problems.push(`unhandledRejection: ${e?.stack || e}`); say('problem', { text: String(e?.stack || e) }); });
process.on('uncaughtException', (e) => { problems.push(`uncaughtException: ${e?.stack || e}`); say('problem', { text: String(e?.stack || e) }); });
const realError = console.error;
console.error = (...args) => { problems.push(args.map(String).join(' ')); say('problem', { text: args.map(String).join(' ') }); realError(...args); };

// ------------------------------------------------------------ the fake WebRTC
//
// Every frame goes to the parent, which relays it to the other worker. The
// 16300-byte ceiling is PeerJS's own: its JSON channel does not chunk, it
// raises an error on the connection and drops the message.
const FRAME_LIMIT = 16300;
const conns = new Map(); // connId -> conn
let peerSeq = 0;

class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return this; }
  emit(ev, ...a) { for (const fn of this._h[ev] || []) fn(...a); }
}

class Conn extends Emitter {
  constructor(connId, peer) { super(); this.connId = connId; this.peer = peer; this.open = false; }
  send(msg) {
    const text = JSON.stringify(msg);
    const bytes = Buffer.byteLength(text, 'utf8');
    say('wire', { bytes, kind: msg?.t ?? (msg?.__chunk ? 'chunk' : 'other') });
    if (bytes >= FRAME_LIMIT) { this.emit('error', new Error('Message too big for JSON channel')); return; }
    say('data', { connId: this.connId, text });
  }
  close() { this.open = false; say('close', { connId: this.connId }); this.emit('close'); }
}

class FakePeer extends Emitter {
  constructor(id) {
    super();
    this.id = typeof id === 'string' ? id : `${role}-anon-${++peerSeq}`;
    say('register', { id: this.id });
    FakePeer.current = this;
  }
  connect(target, opts = {}) {
    const connId = `${this.id}->${target}#${++peerSeq}`;
    const conn = new Conn(connId, target);
    conns.set(connId, conn);
    say('connect', { connId, from: this.id, to: target, serialization: opts.serialization });
    return conn;
  }
  destroy() { say('destroy', { id: this.id }); }
}
dom.window.Peer = FakePeer;

parentPort.on('message', (msg) => {
  if (msg.type === 'peer-open') { FakePeer.current?.emit('open', msg.id); return; }
  if (msg.type === 'peer-error') { FakePeer.current?.emit('error', Object.assign(new Error(msg.detail), { type: msg.detail })); return; }
  if (msg.type === 'incoming') {
    const conn = new Conn(msg.connId, msg.from);
    conns.set(msg.connId, conn);
    FakePeer.current?.emit('connection', conn);
    return;
  }
  if (msg.type === 'conn-open') { const c = conns.get(msg.connId); if (c) { c.open = true; c.emit('open'); } return; }
  if (msg.type === 'data') { conns.get(msg.connId)?.emit('data', JSON.parse(msg.text)); return; }
  if (msg.type === 'conn-close') { const c = conns.get(msg.connId); if (c) { c.open = false; c.emit('close'); } return; }
  if (msg.type === 'act') { act(msg).catch((e) => say('problem', { text: String(e?.stack || e) })); return; }
});

// ------------------------------------------------------------------ the hands

const root = () => document.getElementById('app');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const buttons = () => [...root().querySelectorAll('button')];
const button = (label) => buttons().find((b) => b.textContent.trim().toLowerCase().includes(label.toLowerCase()));
const press = (label) => {
  const node = button(label);
  if (!node) throw new Error(`no button "${label}" — have: ${buttons().map((b) => b.textContent.trim().slice(0, 30)).join(' | ')}`);
  node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
};
const typeInto = (selector, value) => {
  const input = root().querySelector(selector);
  if (!input) throw new Error(`no input ${selector}`);
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
};

async function act(msg) {
  if (msg.what === 'host') {
    press('Host a game');
    await tick(60);
    if (tableSize) {
      const sel = root().querySelector('.lobby .field select');
      if (sel) { sel.value = String(tableSize); sel.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await tick(20); }
    }
    say('code', { code: root().querySelector('.room-code')?.textContent.trim() });
    return;
  }
  if (msg.what === 'join') {
    typeInto('.online input[type="text"]', name);
    typeInto('.code-input', msg.code);
    await tick(20);
    press('Join');
    return;
  }
  if (msg.what === 'start') { press('Start the game'); return; }
}

// Answer whatever this seat is asked, the way a person would: pick an order,
// fill in what it needs, seal it. Runs forever; the parent watches for a stall.
function drive() {
  const stage = root().querySelector('.col-right .stage');
  if (!stage) return false;
  if (root().querySelector('.stage.victory')) return false; // the game is over; leave it alone
  const title = stage.querySelector('.stage-title')?.textContent || '';
  const live = (sel) => [...root().querySelectorAll(sel)].filter((b) => !b.disabled);

  if (title.includes('seal an order')) {
    const seal = button('Seal the order');
    if (seal && !seal.disabled) { press('Seal the order'); return true; }
    const orders = live('.order-btn');
    if (!orders.some((b) => b.classList.contains('chosen'))) {
      const pick = orders.find((b) => b.textContent.includes('Develop'))
        || orders.find((b) => b.textContent.includes('Petition'))
        || orders.find((b) => b.textContent.includes('Hold'))
        || orders[0];
      if (!pick) return false;
      pick.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      return true;
    }
    const sel = stage.querySelector('select');
    if (sel && !sel.value) {
      sel.value = [...sel.options].find((o) => o.value)?.value;
      sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      return true;
    }
    const one = [...root().querySelectorAll('.gold-chip')].find((b) => b.textContent.trim() === '1');
    if (one && !one.classList.contains('chosen')) { one.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); return true; }
    return false;
  }
  if (title.includes('the orders land')) {
    const skip = live('.col-right .stage button').find((b) => b.textContent.trim() === 'Skip');
    if (skip) { skip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); return true; }
  }
  const choice = live('.stage .choice, .stage .title-option')[0];
  if (choice) { choice.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); return true; }
  const primary = live('.col-right .stage button.primary')[0];
  if (primary) { primary.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); return true; }
  return false;
}

await import('../../src/ui/app.js');
await tick(30);
// Animation off: the beats are covered by the unit tests, and holding 2s on
// each one here only makes a run take minutes.
const animate = [...root().querySelectorAll('label.check')].find((l) => l.textContent.includes('Play out each resolution'))?.querySelector('input');
if (animate && workerData.animate === false) { animate.checked = false; animate.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }
say('ready');

setInterval(() => {
  let moved = false;
  try { moved = drive(); } catch (e) { say('problem', { text: String(e?.stack || e) }); }
  const why = dom.window.kg?.why?.() ?? null;
  const stage = root().querySelector('.col-right .stage');
  // Read off the DOM, not off `kg` — the harness has to work against older
  // builds too, so it can be pointed at a commit and asked whether the bug
  // was there.
  const screen = root().querySelector('.layout') ? 'game'
    : root().querySelector('.lobby') ? 'lobby'
      : root().querySelector('.setup-card') ? 'setup' : 'unknown';
  say('report', {
    moved,
    why,
    screen,
    stage: (stage?.textContent || '').slice(0, 90),
    over: !!root().querySelector('.stage.victory'),
    problems: problems.length,
  });
}, 120);
