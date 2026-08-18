// The King's Graces — browser client.
//
// The engine (src/engine) knows nothing about the DOM; this file is the seat
// controller for every human player plus the renderer for the shared board.

import {
  BAND_LABEL, CARD_LABEL, CROWN, HOUSE_NAMES, ORDER, ORDER_LABEL,
  PERSONALITY_LABEL, TITLES, TITLE_BY_ID, bandOf, cardText,
} from '../engine/constants.js';
import { Game, describeOrder } from '../engine/game.js';
import { createGame, crownStrength, commitCeiling, wallsInfo } from '../engine/state.js';
import { PLAYER_MAX, PLAYER_MIN, resolveTuning } from '../engine/tuning.js';
import { createAI, saltFor } from '../engine/ai.js';
import { INTENTS, describeIntent } from '../engine/diplomacy.js';
import { trustLabel } from '../engine/trust.js';
import { describeGoods, participants, validateDeal } from '../engine/deals.js';
import { el, mount, select } from './dom.js';
import { sequenceCard, stageFor } from './sequence.js';
import { referenceCard } from './reference.js';
import { dealOffer, dealBuilder, blankDraft } from './dealtable.js';
import { playResolution } from './animate.js';

const root = document.getElementById('app');

// How long a transition beat holds when animation is on, then a brief fade as
// it hands off to the next phase. Long enough to read that the game moved, and
// always click-skippable.
const INTERLUDE_MS = 2000;
const REVEAL_MS = 2000;
const FADE_MS = 320;

const app = {
  game: null,
  generation: 0,
  pending: null, // {pid, request, view, resolve}
  paused: null, // {label, resolve}
  gate: null, // pid awaiting a "pass the device" confirmation
  lastSeatShown: null,
  humanSeats: new Set(),
  draft: {},
  popover: null, // {title, text}
  trayFor: null,
  trayDraft: null,
  trayNote: null,
  pauseTimer: null, // the auto-advance handle for a transition beat
  stageMax: 0, // tallest the turn panel has needed, so it stops resizing
  dealDraft: null,
  dealReply: null,
  hoveredStage: null,
  animating: false,
  settings: {
    seed: '',
    ransom: false,
    seedFavorEarly: true,
    animate: true,
    players: 4,
    tuning: {}, // overrides on top of the rules
    seats: Array.from({ length: PLAYER_MAX }, (_, i) => ({ kind: i === 0 ? 'human' : 'ai' })),
  },
  advancedOpen: false,
};

/** The knobs worth putting in front of a playtester, in the order they matter. */
const KNOBS = [
  { key: 'startGold', label: 'Starting gold', hint: 'What every house begins with. There is no income on round one, so this is exactly your opening purse.' },
  { key: 'crownBase', label: 'Crown strength constant' },
  { key: 'crownPerPlayer', label: 'Crown strength per player', negative: true },
  { key: 'commitCap', label: 'Most gold in one order', hint: 'Blank for no cap (the default). A cap makes a lone rich house unable to buy the throne.', nullable: true },
  { key: 'petitionCost', label: 'Petition cost' },
  { key: 'pardonCost', label: 'Pardon cost (outlaws)' },
  { key: 'developCost', label: 'Develop cost' },
  { key: 'levyRefusal', label: 'Fealty lost refusing a levy' },
  { key: 'titleClaimCost', label: 'Gold to claim a held title' },
  { key: 'walls', label: 'Walls' },
  { key: 'spoilsGold', label: 'Gold plundered on a win' },
  { key: 'taxLandValue', label: 'Gold a forfeited field settles' },
  { key: 'neutralPerPlayer', label: 'Unclaimed land per player' },
];

// --------------------------------------------------------------- controllers

function humanController(pid) {
  const generation = app.generation;
  return {
    kind: 'human',
    decide(request, view) {
      return new Promise((resolve) => {
        if (generation !== app.generation) return; // abandoned game
        app.pending = { pid, request, view, resolve };
        app.draft = defaultDraft(request, view, pid);
        app.parleyReply = null;
        if (app.humanSeats.size > 1 && app.lastSeatShown !== pid && isPrivate(request)) {
          app.gate = pid;
        }
        render();
      });
    },
  };
}

function isPrivate(request) {
  return ['order', 'peekChoice', 'peekTarget', 'peekResult', 'turncoat', 'deal'].includes(request.type);
}

function answer(value) {
  const p = app.pending;
  if (!p) return;
  app.pending = null;
  app.parleyReply = null;
  p.resolve(value);
  render();
}

function defaultDraft(request) {
  if (request.type !== 'order') return {};
  // Nothing is pre-chosen. An order is not sealable until the player has made
  // every decision it needs — no silent default to attack the first seat with
  // one gold because a field was left untouched.
  return { order: null, target: null, gold: null };
}

// ---------------------------------------------------------------- new game

function startGame() {
  app.generation += 1;
  const s = app.settings;
  const state = createGame({
    seed: s.seed.trim() === '' ? undefined : s.seed.trim(),
    options: { ransom: s.ransom, seedFavorEarly: s.seedFavorEarly },
    tuning: activeTuning(),
    seats: s.seats.slice(0, s.players).map((seat, i) => ({ kind: seat.kind, name: HOUSE_NAMES[i] })),
  });
  const controllers = {};
  app.humanSeats = new Set();
  for (const p of state.players) {
    if (p.kind === 'human') {
      controllers[p.id] = humanController(p.id);
      app.humanSeats.add(p.id);
    } else {
      controllers[p.id] = createAI(p.personality, p.doctrine || 'opportunist', saltFor(state.seed, p.seat));
    }
  }
  const game = new Game({
    state,
    controllers,
    pause: async (beat) => {
      // No watching human means a simulation or a headless run: never wait.
      if (app.humanSeats.size === 0) return;
      const kind = typeof beat === 'string' ? beat : beat?.kind;

      // End of round: replay the resolution over the table, then hold on the
      // recap until the player chooses to move on. This one is always manual —
      // it is the moment to take stock.
      if (kind === 'roundEnd') {
        if (app.settings.animate) await showResolution();
        await new Promise((resolve) => { app.paused = { kind, resolve }; render(); });
        return;
      }

      // Transition beats (a card reveal, the step between phases) are part of
      // the flow, not an afterthought: they mark the game advancing and give a
      // second to read the board. Instant when animation is off; otherwise a
      // short, self-clearing hold the player can click through.
      if (!app.settings.animate) return;
      await new Promise((resolve) => {
        app.paused = { kind, beat, resolve, auto: true, fading: false };
        render();
        const ms = kind === 'reveal' ? REVEAL_MS : INTERLUDE_MS;
        // Hold, then fade out, then hand off — so the beat lands softly rather
        // than snapping to the next phase.
        app.pauseTimer = setTimeout(() => {
          if (!app.paused) return;
          app.paused.fading = true;
          render();
          app.pauseTimer = setTimeout(() => { app.pauseTimer = null; resume(); }, FADE_MS);
        }, ms);
      });
    },
  });
  app.game = game;
  app.pending = null;
  app.paused = null;
  app.gate = null;
  app.lastSeatShown = null;
  app.dealDraft = null;
  app.dealReply = null;
  app.stageMax = 0;
  game.subscribe(() => render());
  render();
  game.run();
}

/** The rules, plus whatever the player has overridden on the setup screen. */
function activeTuning() {
  return { ...app.settings.tuning };
}

function firstHuman(state) {
  return state.players.find((p) => p.kind === 'human')?.id ?? state.players[0].id;
}

/** Replay this round's resolution over the table before the recap. */
async function showResolution() {
  const generation = app.generation;
  const beats = app.game?.state.beats || [];
  if (!beats.length) return;
  app.animating = true;
  render();
  const stage = root.querySelector('.round-table');
  await playResolution(stage, beats, () => generation !== app.generation || !app.animating);
  app.animating = false;
  if (generation === app.generation) render();
}

function resume() {
  if (app.pauseTimer) { clearTimeout(app.pauseTimer); app.pauseTimer = null; }
  const p = app.paused;
  if (!p) return;
  app.paused = null;
  p.resolve();
  render();
}

// ------------------------------------------------------------------- render

/** A small explain-on-click panel. Hover titles were unreliable; a click is not. */
export function openPopover(title, text, body = null) {
  app.popover = { title, text, body };
  render();
}

export function closePopover() {
  app.popover = null;
  render();
}

/**
 * The deal builder. One house lays out the whole bargain — every leg of who
 * gives what to whom — and puts it to the table. Every leg moves goods from one
 * house to another, so the pot is conserved by construction; the other houses
 * named only have to accept or reject.
 */
function trayEditor() {
  if (!app.trayFor || !app.game) return null;
  const s = app.game.state;
  const pid = app.trayFor;
  const others = s.players.filter((p) => p.id !== pid).map((p) => p.id);
  const draft = app.trayDraft ??= blankDraft(pid, others);
  const close = () => { app.trayFor = null; app.trayDraft = null; render(); };
  const change = () => render();

  const problem = validateDeal(s, { transfers: draft.transfers });

  return el('div', { class: 'popover-backdrop', onclick: close }, [
    el('div', { class: 'popover wide', onclick: (e) => e.stopPropagation() }, [
      el('h4', {}, 'Put a bargain to the table'),
      dealBuilder(s, pid, draft, {
        onChange: change,
        onPropose: async () => {
          const res = await app.game.proposeDealTable(pid, draft.transfers);
          if (res.ok) {
            if (draft.intent) app.game.declarePromise(pid, { to: draft.intentOf, kind: draft.intent, subject: draft.intentSubject });
            app.trayNote = null;
            close();
          } else {
            app.trayNote = res.reason;
            render();
          }
        },
        onPass: close,
        reply: problem ? { accepted: false, text: problem } : null,
      }),
    ]),
  ]);
}

function popoverView() {
  if (!app.popover) return null;
  return el('div', {
    class: 'popover-backdrop',
    onclick: () => { app.popover = null; render(); },
  }, [
    el('div', { class: 'popover', onclick: (e) => e.stopPropagation() }, [
      el('h4', {}, app.popover.title),
      app.popover.text ? el('p', {}, app.popover.text) : null,
      app.popover.body ? app.popover.body() : null,
      el('button', { class: 'ghost small', onclick: () => { app.popover = null; render(); } }, 'Close'),
    ]),
  ]);
}

function render() {
  if (!app.game) return mount(root, setupScreen());
  const s = app.game.state;
  mount(
    root,
    topBar(s),
    el('div', { class: 'layout' }, [
      el('div', { class: 'col-left' }, [
        sequenceCard(s, (title, text) => openPopover(title, text)),
        referenceCard(s.tuning, s.players.length),
      ]),
      el('div', { class: 'col-mid' }, [tableView(s)]),
      el('div', { class: 'col-right' }, [stageView(s), chronicleView(s)]),
    ]),
    popoverView(),
    trayEditor(),
  );
  const log = root.querySelector('.chronicle-scroll');
  if (log) log.scrollTop = log.scrollHeight;
  const stage = root.querySelector('.round-table');
  if (stage) layoutTable(stage);
  lockStageHeight();
}

/**
 * The turn panel (top of the right column) changes with every phase — an order
 * form one moment, a two-button levy the next — and the box jumping around made
 * the turn hard to follow. Hold it at the tallest it has ever needed to be: we
 * measure the natural height, keep the running maximum, and pin the box to it,
 * so it only ever grows once (the first time a taller panel appears) and then
 * stays put for the rest of the game.
 */
const STAGE_FLOOR = 440; // a sensible starting height before the tall panels appear
function lockStageHeight() {
  const panel = root.querySelector('.col-right .stage');
  if (!panel) return;
  panel.style.minHeight = '0px';
  const natural = panel.offsetHeight;
  app.stageMax = Math.max(app.stageMax, natural, STAGE_FLOOR);
  panel.style.minHeight = `${app.stageMax}px`;
}

// Clearance kept around every box, and how oval the ring of seats is. The ring
// is kept close to round (a hair wider than tall) so the table does not sprawl
// horizontally; its size is driven by the boxes, not the other way round.
const BOX_PAD = 16;
const RING_ASPECT_X = 1.08;
const RING_ASPECT_Y = 1.0;
const TABLE_MARGIN = 24;

// The largest any single element on the table is ever expected to be. These are
// static ceilings — a seat card with every row filled and its tray, and the
// centre piece at its capped height — used to reserve a stable footprint so the
// columns can be sized once and the table never has to grow into a neighbour.
const MAX_SEAT_W = 200;
const MAX_SEAT_H = 360;
const MAX_CENTRE_W = 248;
const MAX_CENTRE_H = 420;

/**
 * Pack `n` seat boxes and a centre box onto an ellipse so nothing overlaps.
 * Returns the ring points (offsets from the centre) and the table size needed
 * to hold them. Boxes are {hw, hh} half-extents.
 */
function packRing(boxes, centre) {
  const n = boxes.length;
  const angles = boxes.map((_, i) => (Math.PI / 2) + (i * 2 * Math.PI) / n);
  const hit = (ax, ay, ahw, ahh, bx, by, bhw, bhh) =>
    Math.abs(ax - bx) < ahw + bhw + BOX_PAD && Math.abs(ay - by) < ahh + bhh + BOX_PAD;
  const place = (k) => angles.map((a, i) => ({
    x: RING_ASPECT_X * k * Math.cos(a),
    y: RING_ASPECT_Y * k * Math.sin(a),
    hw: boxes[i].hw,
    hh: boxes[i].hh,
  }));
  const clear = (k) => {
    const pts = place(k);
    for (let i = 0; i < pts.length; i++) {
      if (hit(pts[i].x, pts[i].y, pts[i].hw, pts[i].hh, 0, 0, centre.hw, centre.hh)) return false;
      for (let j = i + 1; j < pts.length; j++) {
        if (hit(pts[i].x, pts[i].y, pts[i].hw, pts[i].hh, pts[j].x, pts[j].y, pts[j].hw, pts[j].hh)) return false;
      }
    }
    return true;
  };
  // Grow the ring until everything clears (monotone: moving boxes outward only
  // ever increases their separation, so the first radius that clears is tightest).
  let k = 60;
  while (!clear(k) && k < 5000) k += 6;
  const pts = place(k);
  let maxX = centre.hw;
  let maxY = centre.hh;
  for (const p of pts) {
    maxX = Math.max(maxX, Math.abs(p.x) + p.hw);
    maxY = Math.max(maxY, Math.abs(p.y) + p.hh);
  }
  return { pts, W: 2 * (maxX + TABLE_MARGIN), H: 2 * (maxY + TABLE_MARGIN) };
}

// The worst-case table footprint across every seat count, computed once from
// the static ceilings above. This is the floor the live layout never drops
// below, so the reserved space is the same whoever is at the table.
let staticMaxCache = null;
function staticMaxTable() {
  if (staticMaxCache) return staticMaxCache;
  let W = 0;
  let H = 0;
  for (let n = PLAYER_MIN; n <= PLAYER_MAX; n++) {
    const boxes = Array.from({ length: n }, () => ({ hw: MAX_SEAT_W / 2, hh: MAX_SEAT_H / 2 }));
    const { W: w, H: h } = packRing(boxes, { hw: MAX_CENTRE_W / 2, hh: MAX_CENTRE_H / 2 });
    W = Math.max(W, w);
    H = Math.max(H, h);
  }
  staticMaxCache = { W, H };
  return staticMaxCache;
}

/**
 * Position the seats around the table by measurement, not by guesswork. Each
 * seat (the player card with its "give your word" tray) and the centre piece are
 * treated as boxes with a padding margin; the ring is grown until nothing
 * overlaps. The table is then floored to the static worst-case footprint so its
 * reserved size is stable, and scaled to fit its column so it can never spill
 * over the panels beside it.
 */
function layoutTable(stage) {
  const fit = stage.parentElement; // .table-fit
  const seatEls = [...stage.querySelectorAll('.seat')];
  const centreEl = stage.querySelector('.centre');
  if (!fit || !seatEls.length || !centreEl) return;
  // If the boxes have not been laid out yet (zero size), try again next frame.
  if (seatEls.some((el) => !el.offsetWidth) || !centreEl.offsetWidth) return;

  const boxes = seatEls.map((el) => ({ el, hw: el.offsetWidth / 2, hh: el.offsetHeight / 2 }));
  const centre = { hw: centreEl.offsetWidth / 2, hh: centreEl.offsetHeight / 2 };
  const nat = packRing(boxes, centre);

  // Floor the container to the static worst case, then place the (unchanged,
  // non-overlapping) ring centred inside it.
  const max = staticMaxTable();
  const W = Math.max(nat.W, max.W);
  const H = Math.max(nat.H, max.H);
  const cx = W / 2;
  const cy = H / 2;
  stage.style.width = `${Math.round(W)}px`;
  stage.style.height = `${Math.round(H)}px`;
  boxes.forEach((b, i) => {
    b.el.style.left = `${Math.round(cx + nat.pts[i].x)}px`;
    b.el.style.top = `${Math.round(cy + nat.pts[i].y)}px`;
  });

  // Scale the whole table to fit the width of its column. A uniform scale can
  // never introduce an overlap, and because the table is absolutely positioned
  // inside .table-fit (which clips), it cannot reach the panels on either side.
  // .table-fit is given the scaled height so the page reserves the right space.
  const budget = fit.clientWidth || W;
  const scale = Math.min(1, budget / W);
  stage.style.transform = `translateX(-50%) scale(${scale.toFixed(4)})`;
  fit.style.height = `${Math.round(H * scale)}px`;
}

// ------------------------------------------------------------- setup screen

function setupScreen() {
  const s = app.settings;
  const seatRow = (i) => el('div', { class: 'seat-row' }, [
    el('span', { class: 'seat-name' }, HOUSE_NAMES[i]),
    select(
      [{ value: 'human', label: 'Human' }, { value: 'ai', label: 'Bot' }],
      s.seats[i].kind,
      (v) => { s.seats[i].kind = v; },
    ),
  ]);

  return el('div', { class: 'setup' }, [
    el('div', { class: 'setup-card' }, [
      el('h1', { class: 'title' }, 'The King’s Graces'),
      el('p', { class: 'subtitle' }, 'Serve the crown, grow fat, or vanish into outlawry — then take the throne before someone else inherits it.'),
      el('h3', {}, 'The table'),
      el('label', { class: 'field' }, [
        el('span', {}, 'Houses'),
        select(
          Array.from({ length: PLAYER_MAX - PLAYER_MIN + 1 }, (_, i) => ({
            value: PLAYER_MIN + i, label: `${PLAYER_MIN + i} players`,
          })),
          s.players,
          (v) => { s.players = Number(v); render(); },
        ),
      ]),
      el('div', { class: 'seats' }, Array.from({ length: s.players }, (_, i) => seatRow(i))),
      el('p', { class: 'hint' }, `The Crown stands at ${resolveTuning(activeTuning()).crownBase + resolveTuning(activeTuning()).crownPerPlayer * s.players} plus the cards left in its deck. A small table has fewer nobles to rally to it, so it stands taller.`),
      el('h3', {}, 'Variants'),
      el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', checked: s.ransom, onchange: (e) => { s.ransom = e.target.checked; } }),
        ' Ransom module (§9) — a fifth order, once per game',
      ]),
      el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', checked: s.seedFavorEarly, onchange: (e) => { s.seedFavorEarly = e.target.checked; } }),
        ' Seed a Favor into the first three flips',
      ]),
      el('label', { class: 'check' }, [
        el('input', { type: 'checkbox', checked: s.animate, onchange: (e) => { s.animate = e.target.checked; } }),
        ' Play out each resolution on the table (you can turn this off mid-game)',
      ]),
      advancedPanel(),
      el('label', { class: 'field' }, [
        el('span', {}, 'Seed (optional)'),
        el('input', { type: 'text', value: s.seed, placeholder: 'blank for random', oninput: (e) => { s.seed = e.target.value; } }),
      ]),
      el('button', { class: 'primary big', onclick: startGame }, 'Convene the court'),
      el('button', { class: 'ghost', onclick: () => showRules() }, 'Read the rules'),
    ]),
  ]);
}

function advancedPanel() {
  const s = app.settings;
  const base = resolveTuning({});
  const live = resolveTuning(activeTuning());
  const header = el('button', {
    class: 'court-toggle',
    onclick: () => { app.advancedOpen = !app.advancedOpen; render(); },
  }, `${app.advancedOpen ? '▾' : '▸'} Constants`);
  if (!app.advancedOpen) return el('div', { class: 'advanced' }, [header]);

  return el('div', { class: 'advanced open' }, [
    header,
    ...KNOBS.map((knob) => el('label', { class: 'field' }, [
      el('span', {}, knob.label),
      el('input', {
        type: 'number', min: knob.negative ? -10 : 0, max: 60,
        value: live[knob.key] === null ? '' : live[knob.key],
        placeholder: knob.nullable ? 'none' : '',
        oninput: (e) => {
          const raw = e.target.value.trim();
          if (raw === '' && knob.nullable) s.tuning[knob.key] = null;
          else if (raw === '') delete s.tuning[knob.key];
          else s.tuning[knob.key] = Number(raw);
        },
      }),
    ])),
    el('label', { class: 'field' }, [
      el('span', {}, 'Tax (favorite / neutral / outlaw)'),
      el('span', { class: 'tax-row' }, ['favorite', 'neutral', 'outlaw'].map((band) => el('input', {
        type: 'number', min: 0, max: 20, value: live.taxByBand[band], class: 'narrow',
        oninput: (e) => {
          s.tuning.taxByBand = { ...(s.tuning.taxByBand || base.taxByBand), [band]: Number(e.target.value) || 0 };
        },
      }))),
    ]),
    el('p', { class: 'hint' }, 'Changing anything here plays a variant. tools/simulate.js is how these were chosen — it runs bot tournaments over whatever you set.'),
    el('button', { class: 'ghost small', onclick: () => { s.tuning = {}; render(); } }, 'Back to the preset'),
  ]);
}

// ---------------------------------------------------------------- chrome

function topBar(s) {
  return el('header', { class: 'topbar' }, [
    el('div', { class: 'brand' }, [
      el('span', { class: 'brand-mark' }, '♛'),
      el('span', {}, 'The King’s Graces'),
    ]),
    el('div', { class: 'topbar-actions' }, [
      el('button', {
        class: `ghost${app.settings.animate ? ' on' : ''}`,
        title: 'Play each resolution out on the table, or settle it instantly',
        onclick: () => { app.settings.animate = !app.settings.animate; if (!app.settings.animate) app.animating = false; render(); },
      }, app.settings.animate ? 'Animation on' : 'Animation off'),
      el('button', { class: 'ghost', onclick: () => showRules() }, 'Full rules'),
      el('button', { class: 'ghost', onclick: () => { if (confirm('Abandon this game?')) { app.game = null; render(); } } }, 'New game'),
    ]),
  ]);
}
// ------------------------------------------------------------------- board

function tableView(s) {
  const n = s.players.length;
  // Seat one at the bottom (nearest the player) and go round from there. The
  // actual pixel positions are computed after mount by layoutTable(), which
  // measures each seat box (card + its "give your word" tray) and the centre
  // and spaces them so no two boxes ever overlap.
  const seats = s.players.map((p) => el('div', { class: 'seat', dataset: { anchor: p.id } }, [
    playerCard(s, p),
    dealTray(s, p),
  ]));
  // .table-fit is the fixed slot in the column; the round table is absolutely
  // positioned inside it and scaled to fit, so it can never reach the panels.
  return el('div', { class: 'table-fit' }, [
    el('section', { class: `round-table seats-${n}` }, [...seats, centrePiece(s)]),
  ]);
}

/**
 * What sits beside a rival's marker now that the bargain itself has moved to the
 * middle of the table: the one thing that is aimed at them and nobody else —
 * your word. Your own seat shows nothing here; the deal is public and central.
 */
function dealTray(s, p) {
  if (app.humanSeats.has(p.id)) return null;
  const word = giveWordButton(s, p);
  return word ? el('div', { class: 'tray' }, [word]) : null;
}

/**
 * Give another house your word. It is free, it binds nobody, and no bargain
 * ever waits on it — which is exactly what makes it worth something, because
 * breaking it is a thing the whole court can see.
 */
function giveWordButton(s, p) {
  const me = viewingSeat(s);
  if (!me || !app.game?.dealsOpen) return null;
  const given = (s.promises || []).find((x) => x.round === s.round && x.from === me.id && x.to === p.id);
  return el('button', {
    class: `ghost small${given ? ' on' : ''}`,
    onclick: () => openPopover(`Your word to ${p.name}`, null, () => el('div', { class: 'choices' }, [
      ...INTENTS.filter((i) => !i.needsSubject).map((intent) => el('button', {
        class: `choice${given?.kind === intent.id ? ' chosen' : ''}`,
        onclick: () => {
          app.game.declarePromise(me.id, { to: p.id, kind: intent.id });
          closePopover();
          render();
        },
      }, [
        el('strong', {}, intent.label),
        el('span', {}, 'Free, and binding on nobody. Kept, they will think better of you; broken, so will everyone else.'),
      ])),
    ])),
  }, given ? 'Word given' : 'Give your word');
}

/** The middle of the table: the last decree, the Crown's strength, the titles. */
function centrePiece(s) {
  const card = s.lastCard;
  const held = new Map();
  for (const p of s.players) for (const t of p.titles) held.set(t, p);
  const strength = crownStrength(s);
  const full = s.tuning.crownBase + s.tuning.crownPerPlayer * s.players.length + s.tuning.crownPerCard * s.deckStart;

  return el('div', { class: 'centre', dataset: { anchor: 'crown' } }, [
    el('div', { class: 'centre-crown' }, [
      el('span', { class: 'crown-card-label' }, card ? 'Last decree' : 'The Crown'),
      el('h3', {}, card ? CARD_LABEL[card] : '—'),
      el('p', { class: 'centre-card-text' }, card ? cardText(card, s.tuning) : 'The court has not yet convened.'),
      el('div', { class: 'meter-row' }, [el('span', {}, 'Crown strength'), el('strong', {}, String(strength))]),
      el('div', { class: 'meter' }, [
        el('div', { class: 'meter-fill', style: `width:${Math.min(100, (strength / Math.max(1, full)) * 100)}%` }),
      ]),
      el('div', { class: 'centre-land', title: 'Fields nobody holds. Develop draws from here; a house that pays its tax in land feeds it back.' }, [
        el('span', {}, 'Unclaimed land'),
        el('strong', { class: s.neutralPool > 0 ? '' : 'empty' }, String(s.neutralPool ?? 0)),
      ]),
    ]),
    centreDeal(s),
    el('div', { class: 'centre-titles' }, [
      el('span', { class: 'crown-card-label' }, 'Titles'),
      el('div', { class: 'title-array' }, TITLES.map((t) => {
        const holder = held.get(t.id);
        return el('button', {
          class: `title-slot${holder ? ' taken' : ''}`,
          onclick: () => openPopover(t.name, `${t.text} ${holder ? `Held by ${holder.name}.` : 'Unclaimed — granted at +2 and +3 fealty, or taken from a house whose walls were down.'}`),
        }, [
          el('span', { class: 'title-slot-name' }, t.name),
          el('span', { class: 'title-slot-holder' }, holder ? holder.name.split(' ')[0] : 'unclaimed'),
        ]);
      })),
    ]),
  ]);
}

/**
 * The open bargain, in the middle of the table for all to see. One house builds
 * the whole thing — every leg of who gives what to whom — and puts it up; deals
 * are public knowledge, so the legs and who has accepted are on show to the
 * whole court. Every other house named just accepts or rejects; a rejection (or
 * the proposer pulling it) sweeps the deal away for everybody.
 */
function centreDeal(s) {
  const table = s.dealTable || { proposer: null, transfers: [], accepted: [] };
  const open = !!app.game?.dealsOpen;
  const humans = s.players.filter((p) => app.humanSeats.has(p.id));
  const name = (id) => s.players.find((x) => x.id === id)?.name ?? id;
  const firstName = (id) => name(id).split(' ')[0];

  // No open proposal: an invitation to build one.
  if (!table.proposer) {
    const canOffer = open ? humans : [];
    return el('div', { class: 'centre-deal' }, [
      el('span', { class: 'crown-card-label' }, 'The bargaining table'),
      el('p', { class: 'deal-empty' }, open
        ? 'No bargain on the table. Build one — you set every side of it — and the rest of the court accepts or refuses.'
        : 'The court is not bargaining now.'),
      app.trayNote ? el('p', { class: 'deal-note' }, app.trayNote) : null,
      ...canOffer.map((p) => el('button', {
        class: 'deal-offer-btn',
        onclick: () => { app.trayNote = null; app.trayFor = p.id; render(); },
      }, humans.length > 1 ? `Offer a deal — ${firstName(p.id)}` : 'Offer a deal')),
    ]);
  }

  const parts = participants({ transfers: table.transfers });
  const me = viewingSeat(s);
  const accept = async (pid) => {
    const res = await app.game.acceptDeal(pid);
    app.trayNote = res.settled ? 'The bargain is struck.'
      : res.reason ? res.reason
        : `Waiting on ${(res.waiting || []).map(firstName).join(', ')}.`;
    render();
  };
  const kill = async (pid, reason) => { await app.game.clearDeal(pid, reason); app.trayNote = null; render(); };

  const legs = table.transfers.filter((t) => !isEmptyGoods(t.goods)).map((t) => el('div', { class: 'deal-legrow' }, [
    el('span', { class: 'deal-leg-from' }, firstName(t.from)),
    el('span', { class: 'deal-arrow' }, '→'),
    el('span', { class: 'deal-leg-to' }, firstName(t.to)),
    el('span', { class: 'deal-leg-goods' }, describeGoods(t.goods)),
  ]));

  const status = parts.map((pid) => {
    const accepted = table.accepted?.includes(pid);
    const isProposer = pid === table.proposer;
    return el('span', { class: `deal-chip ${accepted ? 'yes' : 'wait'}` },
      `${firstName(pid)} ${isProposer ? '· proposer' : accepted ? '✓' : '…'}`);
  });

  // What the viewing house can do about it.
  let actions = null;
  if (open && me && parts.includes(me.id)) {
    const accepted = table.accepted?.includes(me.id);
    if (me.id === table.proposer) {
      actions = [el('button', { class: 'ghost small', onclick: () => kill(me.id, 'withdrew') }, 'Withdraw')];
    } else {
      actions = [
        accepted ? el('span', { class: 'deal-you' }, '✓ you accepted') : el('button', { class: 'small primary', onclick: () => accept(me.id) }, 'Accept'),
        el('button', { class: 'ghost small', onclick: () => kill(me.id, 'rejected') }, 'Reject'),
      ];
    }
  }

  return el('div', { class: 'centre-deal' }, [
    el('span', { class: 'crown-card-label' }, `${firstName(table.proposer)}’s bargain`),
    el('div', { class: 'deal-legs' }, legs),
    el('div', { class: 'deal-chips' }, status),
    app.trayNote ? el('p', { class: 'deal-note' }, app.trayNote) : null,
    actions ? el('div', { class: 'deal-party-actions' }, actions) : null,
  ]);
}

const isEmptyGoods = (g) => !g || (!g.gold && !g.lands && !g.turncoat && !(g.titles || []).length);

function playerCard(s, p) {
  const band = bandOf(p.fealty);
  const isActive = app.pending?.pid === p.id;
  const commitment = s.commitments[p.id];
  const showOrder = s.revealed || (app.humanSeats.has(p.id) && !app.gate);
  return el('article', { class: `player band-${band}${isActive ? ' active' : ''}${p.kind === 'human' ? ' human' : ''}` }, [
    el('div', { class: 'player-head' }, [
      el('div', {}, [
        el('h2', {}, p.name),
        el('span', { class: 'who' }, p.kind === 'human' ? 'You' : `Bot · ${PERSONALITY_LABEL[p.personality] || p.personality}`),
      ]),
      el('span', { class: `pill band-pill-${band}` }, BAND_LABEL[band]),
    ]),
    fealtyTrack(p.fealty),
    el('div', { class: 'resources' }, [
      resource('Lands', p.lands),
      // Show the purse people carry, not what is left after they sealed. Gold
      // committed to an order is escrowed the moment it is sealed, but that is
      // hidden information until the orders land — a counter that dropped by 7
      // would tell the whole table you sealed 7 and are plainly not just
      // farming. So until reveal, everyone shows their pre-commitment total.
      resource('Gold', s.revealed ? p.gold : p.gold + (p.escrow || 0)),
      wallsResource(s, p),
    ]),
    statusRow(s, p),
    el('div', { class: 'titles' }, p.titles.length
      ? p.titles.map((t) => el('span', { class: 'title-chip', title: TITLE_BY_ID[t].text }, TITLE_BY_ID[t].name))
      : [el('span', { class: 'title-chip empty' }, 'no titles')]),
    standingRow(s, p),
    commitment && showOrder
      ? el('div', { class: 'order-line' }, describeOrder(commitment, (id) => nameOf(s, id), s.tuning.pardonCost))
      : commitment
        ? el('div', { class: 'order-line sealed' }, 'orders sealed')
        : null,
  ]);
}

/**
 * The things about a house that are not a number in a box: whether its army is
 * at home, and what it is holding that is not gold or land.
 *
 * The army line matters most on a levy round, because whether a house served or
 * refused is the difference between walls 0 and walls 2 — and it is public, so
 * hiding it in the log was hiding a fact the table is entitled to act on.
 */
function statusRow(s, p) {
  const t = s.tuning;
  const attacking = s.revealed && s.commitments[p.id]?.order === ORDER.ATTACK;
  const away = p.noArmy || attacking;
  const chips = [];
  if (away) {
    chips.push(el('button', {
      class: 'status-chip away',
      onclick: () => openPopover(`${p.name}: host in the field`, p.noArmy
        ? `They answered the Crown's levy, so their army is marching under the royal banner. Their walls are 0 this round — not ${t.walls} — and a house with no walls can be stripped of a title, not just a land. Everyone could see this before orders were sealed.`
        : `Their order was an attack, so their own gate is unmanned. Walls 0 this round instead of ${t.walls}.`),
    }, p.noArmy ? '⚑ host levied — no walls' : '⚔ in the field — no walls'));
  } else if (p.levy === 'refuse') {
    // Only once they have actually refused — not the instant a levy is flipped.
    chips.push(el('button', {
      class: 'status-chip home',
      onclick: () => openPopover(`${p.name}: host at home`, `They refused the Crown's levy and kept their army, so their walls are the full ${t.walls}. It cost them ${t.levyRefusal} fealty.`),
    }, `⛨ refused the levy — walls ${t.walls}`));
  }
  if (p.turncoat > 0) {
    chips.push(el('button', {
      class: 'status-chip token',
      onclick: () => openPopover('Turncoat tokens', [
        `${p.name} holds ${p.turncoat}.`,
        'A turncoat token does two things across the whispers step. In espionage, holding one lets you read a rival’s sealed order or the next royal card — both at −3. In duplicity, spending one lets you change your own sealed order. Looking does not spend it; changing does.',
        `An outlaw takes one as the round opens, and only when it holds none — so the shadow never hands a second while you still hold the first. Tokens are goods: sell one at the deal table and the buyer gets its eyes and its change. There is no cap on how many a house can buy, which is why a neutral house can be sitting on several.`,
      ].join('\n\n')),
    }, `${p.turncoat} turncoat token${p.turncoat === 1 ? '' : 's'}`));
  }
  return chips.length ? el('div', { class: 'status-row' }, chips) : null;
}

/**
 * What this house thinks of you, and what it has said it will do. Trust is
 * public — a word given in open court is given in open court — so this reads
 * off the same ledger everyone else is reading.
 */
function standingRow(s, p) {
  const me = viewingSeat(s);
  if (!me || me.id === p.id) return null;
  const theirs = s.trust?.[`${p.id}>${me.id}`] ?? 0;
  const mine = s.trust?.[`${me.id}>${p.id}`] ?? 0;
  const word = (s.promises || []).find((x) => x.round === s.round && x.from === p.id && x.to === me.id);
  const rounded = Math.round(theirs * 10) / 10;
  return el('div', { class: 'standing' }, [
    el('button', {
      class: `standing-chip t${theirs > 0.75 ? 'up' : theirs < -0.75 ? 'down' : 'flat'}`,
      onclick: () => openPopover(`${p.name} on you`, [
        `They think you are ${trustLabel(theirs)} (${rounded > 0 ? '+' : ''}${rounded}).`,
        `You think they are ${trustLabel(mine)}.`,
        'Trust moves on deeds and on words: hold somebody’s wall and they remember it, strike a house you have just bargained with and the whole court remembers that. A house that thinks little of you will want a much better bargain before it signs, and past a point will not deal at all.',
      ].join('\n\n')),
    }, trustLabel(theirs)),
    word ? el('span', { class: 'word-chip' }, `“${describeIntent(s, word)}”`) : null,
  ]);
}

/** Whose eyes the board is being drawn through right now. */
function viewingSeat(s) {
  const pending = app.pending?.pid;
  if (pending && app.humanSeats.has(pending)) return s.players.find((p) => p.id === pending);
  const first = [...app.humanSeats][0];
  return first ? s.players.find((p) => p.id === first) : null;
}

/**
 * Walls as a standing figure on the card, clickable for the breakdown. The
 * number is the *resting* wall — what it computes may not be what the attack
 * meets, because standing, titles and a last-moment pledge can all move it, and
 * a turncoat token in the attacker's hand cracks it. The popup says so.
 */
function wallsResource(s, p) {
  const me = viewingSeat(s);
  const knowOrder = s.revealed || (me && me.id === p.id);
  const w = wallsInfo(s, p, { knowOrder });
  const t = s.tuning;
  return el('button', {
    class: `resource walls${w.gone ? ' muted' : ''}`,
    onclick: () => openPopover(`${p.name}: walls`, null, () => el('div', {}, [
      el('div', { class: 'wall-parts' }, w.gone
        ? [el('p', {}, w.gone === 'levy'
          ? 'Their host answered the Crown’s levy, so they have no walls this round.'
          : 'Their army is in the field, so they have no walls this round.')]
        : w.parts.map((part) => el('p', { class: 'wall-part' }, [
          el('span', {}, part.label), el('b', {}, part.value >= 0 ? `+${part.value}` : String(part.value)),
        ])).concat([el('p', { class: 'wall-part total' }, [el('span', {}, 'Resting total'), el('b', {}, String(w.total))])])),
      el('p', { class: 'blurb dim' }, 'It may not be this when the swords land. Walls drop to 0 the round a house attacks or answers a levy. '
        + `A turncoat token in the attacker’s hand cracks the gate by ${t.turncoatWallBreak}. `
        + 'An appeal or pardon this round adds the gold it costs. Support and the Warden add on top, and are hidden until the reveal.'),
    ])),
  }, [
    el('span', { class: 'resource-value' }, String(w.total)),
    el('span', { class: 'resource-label' }, 'Walls'),
  ]);
}

function resource(label, value, cls = '') {
  return el('div', { class: `resource ${cls}` }, [
    el('span', { class: 'resource-value' }, String(value)),
    el('span', { class: 'resource-label' }, label),
  ]);
}

function fealtyTrack(fealty) {
  const cells = [];
  for (let i = -3; i <= 3; i++) {
    const band = bandOf(i);
    cells.push(el('span', {
      class: `tick band-${band}${i === fealty ? ' here' : ''}${i === 0 ? ' zero' : ''}`,
      title: `${i > 0 ? '+' : ''}${i}`,
    }, i === fealty ? (i > 0 ? `+${i}` : `${i}`) : ''));
  }
  return el('div', { class: 'fealty' }, [
    el('span', { class: 'fealty-label' }, 'Fealty'),
    el('span', { class: 'track-end' }, '−3'),
    el('div', { class: 'track' }, cells),
    el('span', { class: 'track-end' }, '+3'),
  ]);
}

function nameOf(s, id) {
  if (id === CROWN) return 'the Crown';
  return s.players.find((p) => p.id === id)?.name ?? id;
}

// ------------------------------------------------------------- crown panel

// ------------------------------------------------------------------- stage

function stageView(s) {
  if (s.winner || s.phase === 'gameOver') return victoryPanel(s);
  if (app.gate) return gatePanel(s);
  if (app.pending) return requestPanel(s);
  if (app.animating) {
    return el('section', { class: 'stage' }, [
      el('h2', { class: 'stage-title' }, `Round ${s.round} — the orders land`),
      el('p', { class: 'blurb' }, 'Appeals settle first, then land, then support, then the swords.'),
      el('button', { class: 'ghost', onclick: () => { app.animating = false; } }, 'Skip'),
    ]);
  }
  if (app.paused) return app.paused.kind === 'roundEnd' ? pausePanel(s) : interludePanel(s);
  return el('section', { class: 'stage' }, [
    el('div', { class: 'waiting' }, [
      el('span', { class: 'spinner' }),
      el('p', {}, 'The court deliberates…'),
    ]),
  ]);
}

/**
 * The copy for each transition beat: what the game is moving into, and why. A
 * reveal names the royal card and what it will do to the table; an interlude
 * names the phase about to open. Purpose-written and short — this flashes past.
 */
function interludeCopy(s, paused) {
  if (paused.kind === 'reveal') {
    const card = paused.beat?.card ?? s.lastCard;
    const what = {
      tax: 'The Crown takes its due — coin from every house, and land from any that cannot pay.',
      levy: 'The Crown calls up your host. Serve and your walls fall for the round; refuse and lose standing. Every house will see which you chose.',
      favor: 'The Crown rewards the loyal — gold to every favourite, and land to those at the top of the track.',
    }[card] || 'The court convenes.';
    return { eyebrow: `Round ${s.round}`, title: card ? CARD_LABEL[card] : 'The royal card', text: what };
  }
  const stage = {
    commit: { title: 'Sealed orders', text: 'Every house now chooses one order in secret and commits its gold.' },
    whispers: { title: 'Whispers', text: 'The turncoats look, and — for a price — change their minds. The deal table stays open.' },
    resolve: { title: 'The orders land', text: 'Sealed orders flip and settle: appeals first, then land, then support, then the swords.' },
  }[paused.beat?.stage] || { title: 'The round turns', text: '' };
  return { eyebrow: `Round ${s.round}`, ...stage };
}

function interludePanel(s) {
  const copy = interludeCopy(s, app.paused);
  return el('section', { class: `stage interlude${app.paused.fading ? ' fading' : ''}`, onclick: resume }, [
    el('span', { class: 'interlude-eyebrow' }, copy.eyebrow),
    el('h2', { class: `interlude-title card-${app.paused.beat?.card || ''}` }, copy.title),
    copy.text ? el('p', { class: 'interlude-text' }, copy.text) : null,
    el('span', { class: 'interlude-hint' }, 'click to continue'),
  ]);
}

function gatePanel(s) {
  const p = s.players.find((x) => x.id === app.gate);
  return el('section', { class: 'stage' }, [
    el('div', { class: 'gate' }, [
      el('h2', {}, 'Pass the table'),
      el('p', {}, `Only ${p.name} should see what comes next.`),
      el('button', {
        class: 'primary big',
        onclick: () => { app.lastSeatShown = app.gate; app.gate = null; render(); },
      }, `I am ${p.name}`),
    ]),
  ]);
}

function pausePanel(s) {
  const entries = s.log.filter((l) => l.round === s.round && visibleEntry(l));
  return el('section', { class: 'stage' }, [
    el('h2', { class: 'stage-title' }, `Round ${s.round} — the dust settles`),
    el('div', { class: 'recap' }, entries.slice(-14).map((l) => el('p', { class: `recap-line kind-${l.kind}` }, l.text))),
    el('button', { class: 'primary big', onclick: resume }, 'Next round'),
  ]);
}

function victoryPanel(s) {
  const w = s.winner;
  const names = w ? w.playerIds.map((id) => nameOf(s, id)).join(' and ') : null;
  return el('section', { class: 'stage victory' }, [
    el('h2', { class: 'stage-title' }, w ? 'A throne is filled' : 'The realm burns'),
    el('p', { class: 'victory-line' }, w
      ? (w.how === 'usurp'
        ? `${names} took the throne by force.`
        : `${names} stood highest in the King’s graces and inherited the throne.`)
      : 'Civil war. No one was crowned.'),
    el('table', { class: 'final' }, [
      el('thead', {}, el('tr', {}, ['House', 'Fealty', 'Lands', 'Gold', 'Titles'].map((h) => el('th', {}, h)))),
      el('tbody', {}, s.players.slice().sort((a, b) => b.fealty - a.fealty || b.lands - a.lands).map((p) => el('tr', {
        class: w && w.playerIds.includes(p.id) ? 'crowned' : '',
      }, [
        el('td', {}, p.name),
        el('td', {}, `${p.fealty > 0 ? '+' : ''}${p.fealty}`),
        el('td', {}, String(p.lands)),
        el('td', {}, String(p.gold)),
        el('td', {}, p.titles.map((t) => TITLE_BY_ID[t].name).join(', ') || '—'),
      ]))),
    ]),
    el('button', { class: 'primary big', onclick: () => { app.game = null; render(); } }, 'Play again'),
  ]);
}

// --------------------------------------------------------- request handlers

function requestPanel(s) {
  const { request, view, pid } = app.pending;
  const me = s.players.find((p) => p.id === pid);
  const body = {
    order: () => orderForm(s, me, request, view),
    deal: () => dealOffer(s, request, answer),
    levy: () => levyForm(s, me, request),
    offer: () => offerForm(s, request),
    title: () => titleForm(request),
    spoils: () => spoilsForm(s, request),
    peekResult: () => peekResultForm(s, request),
    peekChoice: () => peekChoiceForm(request),
    peekTarget: () => peekTargetForm(s, request),
    turncoat: () => turncoatForm(s, request),
  }[request.type];

  return el('section', { class: 'stage' }, [
    el('h2', { class: 'stage-title' }, `${me.name} — ${stageTitle(request)}`),
    body ? body() : el('button', { class: 'primary', onclick: () => answer(null) }, 'Continue'),
    knownIntel(s, view),
  ]);
}

function stageTitle(request) {
  return {
    order: 'seal an order',
    deal: 'a bargain offered',
    levy: 'the levy',
    offer: 'a proposal',
    title: 'claim a title',
    spoils: 'take your spoils',
    peekResult: 'what the shadow showed you',
    peekChoice: 'what will you look at?',
    peekTarget: 'whose orders?',
    turncoat: 'a turncoat token',
  }[request.type] || request.type;
}

function knownIntel(s, view) {
  const lines = [];
  for (const [id, c] of Object.entries(view.commitments)) {
    if (id === view.me || !c.peeked) continue;
    lines.push(`${nameOf(s, id)} sealed: ${describeOrder(c, (x) => nameOf(s, x))}`);
  }
  if (view.knownTopCard) lines.push(`Next decree: ${CARD_LABEL[view.knownTopCard]}`);
  if (!lines.length) return null;
  return el('div', { class: 'intel' }, [
    el('h4', {}, 'What you know'),
    ...lines.map((l) => el('p', {}, l)),
  ]);
}

function orderForm(s, me, request, view) {
  const d = app.draft;
  const legal = request.legal;
  const t = s.tuning;
  const ceiling = commitCeiling(s, me);
  const others = s.players.filter((p) => p.id !== me.id);
  const needsTarget = [ORDER.ATTACK, ORDER.SUPPORT, ORDER.RANSOM].includes(d.order);
  const needsGold = [ORDER.ATTACK, ORDER.SUPPORT].includes(d.order);
  const fixedCost = { [ORDER.PETITION]: request.petitionCost, [ORDER.DEVELOP]: t.developCost }[d.order] ?? 0;
  const atCeiling = bandOf(me.fealty) !== 'outlaw' && me.fealty >= 3;

  const blurb = {
    [ORDER.ATTACK]: 'Commit troops. Your own walls drop to 0 — an army in the field cannot hold a gate.',
    [ORDER.SUPPORT]: d.target === me.id
      ? 'Dig in. Your gold goes onto your own walls, and nobody can see that you did it.'
      : 'Your gold joins the target’s attack if they strike, otherwise their defense.',
    [ORDER.PETITION]: bandOf(me.fealty) === BAND_OUTLAW_KEY
      ? `A pardon: ${t.pardonCost} gold, straight back to fealty 0, before the swords land.`
      : atCeiling
        ? `You are already at +3. ${t.petitionCost} gold buys you nothing.`
        : `${t.petitionCost} gold for one step up the track.`,
    [ORDER.DEVELOP]: `${t.developCost} gold for one land from the neutral pool. Lands pay every round.`,
    [ORDER.RANSOM]: `Once per game. Steal ${t.ransomTake} gold. Favorites cost you 2 fealty; outlaws pay a bounty of +1.`,
    [ORDER.HOLD]: 'You cannot afford anything else.',
  }[d.order];

  // What is still unchosen. The order cannot be sealed until this is empty, so
  // nothing goes out on a forgotten default.
  const missing = [];
  if (!d.order) missing.push('an order');
  if (needsTarget && !d.target) missing.push('a target');
  if (needsGold && !(d.gold >= 1)) missing.push('how much gold');
  const ready = missing.length === 0;

  return el('div', { class: 'form' }, [
    el('div', { class: 'order-grid' }, orderChoices(s, me, request).map(({ order: o, ok, why }) => el('button', {
      class: `order-btn${d.order === o ? ' chosen' : ''}${ok ? '' : ' locked'}`,
      disabled: !ok,
      title: ok ? null : why,
      onclick: () => {
        if (!ok) return;
        // Switching orders clears the other fields, so a target picked for an
        // attack cannot linger into a support you retargeted.
        d.order = o;
        d.target = null;
        d.gold = null;
        render();
      },
    }, [
      el('strong', {}, ORDER_LABEL[o]),
      el('span', { class: 'order-cost' }, o === ORDER.PETITION ? `${request.petitionCost} gold`
        : o === ORDER.DEVELOP ? `${t.developCost} gold`
          : o === ORDER.RANSOM ? 'free' : o === ORDER.HOLD ? '—' : `1–${ceiling} gold`),
    ]))),
    (() => {
      const locked = orderChoices(s, me, request).filter((c) => !c.ok);
      return locked.length
        ? el('p', { class: 'locked-note' }, locked.map((c) => `${ORDER_LABEL[c.order]}: ${c.why}`).join(' · '))
        : null;
    })(),
    el('p', { class: 'blurb' }, d.order ? blurb : 'Choose an order to begin.'),
    needsTarget ? el('label', { class: 'field' }, [
      el('span', {}, 'Target'),
      select(
        [{ value: '', label: '— choose a target —' },
          ...(d.order === ORDER.SUPPORT ? [{ value: me.id, label: 'Your own gate (dig in)' }] : []),
          ...others.map((p) => ({ value: p.id, label: `${p.name} (${BAND_LABEL[bandOf(p.fealty)]}, ${p.lands} lands)` })),
          { value: CROWN, label: `The Crown (strength ${crownStrength(s)})` }],
        d.target ?? '',
        (v) => { d.target = v || null; render(); },
      ),
    ]) : null,
    needsGold ? el('label', { class: 'field' }, [
      el('span', {}, t.commitCap && me.gold > ceiling
        ? `How much gold? (you hold ${me.gold}; no order may carry more than ${t.commitCap})`
        : `How much gold? (you hold ${me.gold})`),
      // Just type it. A slider was fiddly for a value that is usually a small
      // whole number the player already has in mind; a text box is quicker and
      // does not fight the mouse. Nothing is pre-filled, so the Seal button
      // stays disabled until a real amount is entered.
      //
      // onchange (blur/Enter), not oninput, on purpose: re-rendering on every
      // keystroke would tear down and rebuild the input and drop focus mid-type.
      // The quick buttons cover the common picks without touching the keyboard.
      el('div', { class: 'gold-row' }, [
        el('input', {
          type: 'number', min: 1, max: ceiling, inputmode: 'numeric',
          class: 'gold-input', placeholder: 'choose',
          value: d.gold >= 1 ? String(d.gold) : '',
          onchange: (e) => {
            const raw = Math.floor(Number(e.target.value));
            d.gold = raw >= 1 ? Math.min(raw, ceiling) : null;
            render();
          },
        }),
        el('button', { class: `gold-chip${d.gold === 1 ? ' chosen' : ''}`, onclick: () => { d.gold = 1; render(); } }, '1'),
        ceiling > 2 ? el('button', { class: `gold-chip${d.gold === Math.ceil(ceiling / 2) ? ' chosen' : ''}`, onclick: () => { d.gold = Math.ceil(ceiling / 2); render(); } }, 'Half') : null,
        ceiling > 1 ? el('button', { class: `gold-chip all${d.gold === ceiling ? ' chosen' : ''}`, onclick: () => { d.gold = ceiling; render(); } }, 'All in') : null,
      ]),
    ]) : null,
    needsGold && d.target === CROWN ? el('p', { class: 'warn' }, `The Crown defends with ${crownStrength(s)} plus any support. Raising a hand against it sets your fealty to −3 either way.`) : null,
    needsGold && d.gold >= 1 && d.target && d.target !== CROWN && d.order === ORDER.ATTACK ? attackPreview(s, me, d) : null,
    fixedCost ? el('p', { class: 'blurb' }, `Cost: ${fixedCost} gold.`) : null,
    ready ? null : el('p', { class: 'locked-note' }, `Still to choose: ${missing.join(', ')}.`),
    el('button', {
      class: 'primary big',
      disabled: !ready,
      onclick: () => {
        if (!ready) return;
        answer({ order: d.order, target: needsTarget ? d.target : null, gold: needsGold ? Math.min(d.gold, me.gold) : 0 });
      },
    }, 'Seal the order'),
  ]);
}

const BAND_OUTLAW_KEY = 'outlaw';

/**
 * Every order, always, with a reason when one is out of reach. Hiding what you
 * cannot afford makes the board look smaller than it is; greying it out tells
 * you what to save up for.
 */
function orderChoices(s, me, request) {
  const t = s.tuning;
  const legal = request.legal;
  const orders = [ORDER.ATTACK, ORDER.SUPPORT, ORDER.PETITION, ORDER.DEVELOP];
  if (s.options.ransom) orders.push(ORDER.RANSOM);
  if (legal.includes(ORDER.HOLD)) orders.push(ORDER.HOLD);
  return orders.map((order) => {
    if (legal.includes(order)) return { order, ok: true };
    let why = 'not available this round';
    if (order === ORDER.ATTACK && me.noArmy) why = 'your host is marching for the Crown this round';
    else if (order === ORDER.ATTACK || order === ORDER.SUPPORT) why = `needs at least 1 gold, you hold ${me.gold}`;
    else if (order === ORDER.PETITION) why = `costs ${request.petitionCost} gold, you hold ${me.gold}`;
    else if (order === ORDER.DEVELOP) {
      why = s.neutralPool <= 0
        ? 'no unclaimed land is left'
        : `costs ${t.developCost} gold, you hold ${me.gold}`;
    } else if (order === ORDER.RANSOM) why = 'already used, once per game';
    return { order, ok: false, why };
  });
}

function attackPreview(s, me, d) {
  const target = s.players.find((p) => p.id === d.target);
  if (!target) return null;
  const t = s.tuning;
  const marshal = me.titles.includes('marshal') ? t.marshalBonus : 0;
  const punch = bandOf(me.fealty) === 'favorite' && target.fealty < me.fealty
    ? Math.round(me.fealty * t.punchDownScale) : 0;
  const strength = Math.min(d.gold || 1, commitCeiling(s, me)) + marshal + punch;
  const warden = target.titles.includes('warden') ? t.wardenBonus : 0;
  const delta = s.tuning.attackFealty[bandOf(target.fealty)];
  const consequence = delta === 0 ? 'no fealty change' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} fealty`;
  // The walls I would actually meet: base (0 if their host is away), Warden,
  // and my own token cracking the gate. Their support and any last-moment
  // pledge are hidden.
  const ram = me.turncoat > 0 ? Math.min(t.walls, t.turncoatWallBreak) : 0;
  const base = target.noArmy ? 0 : Math.max(0, t.walls - ram);
  const known = base + warden;
  return el('div', { class: 'preview' }, [
    el('p', {}, `Your strength: ${strength} (${d.gold || 1} gold${marshal ? ' + 1 Marshal' : ''}${punch ? ` + ${punch} punching down` : ''}).`),
    el('p', {}, target.noArmy
      ? `Their walls: 0 — their host answered the levy${warden ? `, though the Warden still adds ${warden}` : ''}. They defend with ${known} plus any support, and their titles are exposed.`
      : `Their walls: ${t.walls}${ram ? ` − ${ram} (your turncoat token cracks the gate)` : ''}${warden ? ` + ${warden} Warden` : ''} = ${known}, unless they attack too, in which case 0.`),
    el('p', { class: 'warn' }, 'Support is hidden — and so is a last-moment pledge: throw the target on the Crown’s mercy and their walls rise by what they pledge, and you are docked 1 fealty for cutting down a house pledging fealty.'),
    el('p', {}, `Break through and you plunder ${Math.min(t.spoilsGold, target.gold)} gold${target.lands ? ' and take a land' : ''}${target.noArmy && target.titles.length ? ' or a title' : ''}.${t.repelSpoils ? ' Get thrown back and they take the same off you.' : ''}`),
    el('p', {}, `Striking a ${BAND_LABEL[bandOf(target.fealty)].toLowerCase()} costs you ${consequence}.`),
  ]);
}

function levyForm(s, me, request) {
  const drop = request.refusalCost;
  const after = Math.max(-3, me.fealty - drop);
  const coronets = me.titles.length;
  return el('div', { class: 'form choices' }, [
    el('p', { class: 'blurb' }, 'The Crown calls up your host.'),
    el('button', { class: 'choice', onclick: () => answer('serve') }, [
      el('strong', {}, 'Send your host'),
      el('span', {}, `Your army marches for the Crown: no walls and no attack this round. Anyone who breaks through takes a land${coronets ? ' — or one of your titles' : ''}. The whole table sees it before they choose a target.`),
    ]),
    el('button', { class: 'choice', onclick: () => answer('refuse') }, [
      el('strong', {}, `Refuse — ${drop} fealty`),
      el('span', {}, me.fealty <= -3
        ? 'You are already at the floor. This costs you nothing at all.'
        : `You would fall to ${after >= 0 ? '+' : '−'}${Math.abs(after)}${bandOf(after) !== bandOf(me.fealty) ? `, out of the ${BAND_LABEL[bandOf(me.fealty)].toLowerCase()} band and into the ${BAND_LABEL[bandOf(after)].toLowerCase()}` : ''}. Your army stays home.`),
    ]),
  ]);
}

function offerForm(s, request) {
  const o = request.offer;
  const from = s.players.find((p) => p.id === o.from);
  const what = {
    joinCoup: 'march on the Crown alongside them this round',
    attack: `attack ${nameOf(s, o.subject)}`,
    supportAttack: 'reinforce their attack',
    supportDefense: 'reinforce their defense',
    standDown: 'leave them alone this round',
  }[o.kind] || 'come to an arrangement';
  return el('div', { class: 'form choices' }, [
    el('p', { class: 'blurb' }, `${from.name} offers you ${o.gold} gold to ${what}. Nothing about this is binding — on either side.`),
    el('button', { class: 'choice', onclick: () => answer({ accept: true }) }, [
      el('strong', {}, `Take the ${o.gold} gold`), el('span', {}, 'Paid now. What you do with your order is still yours to decide.'),
    ]),
    el('button', { class: 'choice', onclick: () => answer({ accept: false }) }, [
      el('strong', {}, 'Refuse'), el('span', {}, 'No coin, no obligation.'),
    ]),
  ]);
}

function titleForm(request) {
  const claimable = request.claimable || [];
  return el('div', { class: 'form' }, [
    el('p', { class: 'blurb' }, `You have reached fealty +${request.threshold}. Choose a title — yours until somebody takes it from you in the field, or asks the King for it as their own grant.`),
    el('div', { class: 'title-grid' }, request.available.map((id) => el('button', {
      class: 'title-option', onclick: () => answer(id),
    }, [
      el('strong', {}, TITLE_BY_ID[id].name),
      el('span', {}, TITLE_BY_ID[id].text),
    ]))),
    claimable.length ? el('p', { class: 'blurb' }, `Or claim one already held. The King does not want to make enemies of his friends, so it costs ${request.claimCost} gold to the Crown — and the house you take it from will know.`) : null,
    claimable.length ? el('div', { class: 'title-grid' }, claimable.map((c) => el('button', {
      class: 'title-option claim', onclick: () => answer(c.title),
    }, [
      el('strong', {}, `${TITLE_BY_ID[c.title].name} — from ${c.holderName}`),
      el('span', {}, `${TITLE_BY_ID[c.title].text} Costs ${c.cost} gold.`),
    ]))) : null,
  ]);
}

function spoilsForm(s, request) {
  const loser = s.players.find((p) => p.id === request.loser);
  return el('div', { class: 'form' }, [
    el('p', { class: 'blurb' }, `You broke through ${loser.name}. Their army was in the field, so their titles are exposed.`),
    el('div', { class: 'choices' }, [
      request.landsAvailable === false ? null : el('button', { class: 'choice', onclick: () => answer({ kind: 'land' }) }, [
        el('strong', {}, 'Take a land'), el('span', {}, `${loser.name} holds ${loser.lands}. Lands pay every round.`),
      ]),
      ...request.titles.map((t) => el('button', { class: 'choice', onclick: () => answer({ kind: 'title', title: t }) }, [
        el('strong', {}, `Take the title of ${TITLE_BY_ID[t].name}`), el('span', {}, TITLE_BY_ID[t].text),
      ])),
    ]),
  ]);
}

/**
 * What the peek bought, and — the part that was missing — whether the peeker
 * can do anything with it. Peeking and changing your order are gated on
 * different things, and a player who looked with an empty hand used to watch
 * the round resolve without ever being told why nothing was offered.
 */
function peekResultForm(s, request) {
  const found = request.kind === 'card'
    ? (request.card
      ? el('div', { class: 'peek-find' }, [
        el('h4', {}, CARD_LABEL[request.card]),
        el('p', {}, cardText(request.card, s.tuning, s.options)),
      ])
      : el('p', { class: 'blurb' }, 'The deck is spent — there is no next card to see.'))
    : el('div', { class: 'peek-find' }, [
      el('h4', {}, nameOf(s, request.who)),
      el('p', {}, request.order
        ? describeOrder(request.order, (id) => nameOf(s, id), s.tuning.pardonCost)
        : 'They have sealed nothing.'),
    ]);
  const me = viewingSeat(s);
  const deep = me && me.fealty <= -3;
  return el('div', { class: 'form' }, [
    el('p', { class: 'blurb' }, request.kind === 'card'
      ? 'Your turncoat token’s eyes on the top of the royal deck. Next round opens with this.'
      : 'Your turncoat token’s eyes on their sealed order. It can still change if they too hold a token.'),
    found,
    deep ? el('p', { class: 'blurb dim' }, 'At −3 the deep shadow shows you both a rival’s order and the next card — for the one token.') : null,
    el('p', { class: request.canChange ? 'blurb' : 'warn' }, request.canChange
      ? 'You still hold the token, so in the duplicity beat you may spend it to change your own sealed order — unless you trade it away first.'
      : 'This was the Spymaster’s free look; you hold no turncoat token, so your own order stands as sealed.'),
    el('button', { class: 'primary big', onclick: () => answer(null) }, 'Keep it to yourself'),
  ]);
}

function peekChoiceForm(request) {
  return el('div', { class: 'form choices' }, [
    el('p', { class: 'blurb' }, 'The shadow grants one look.'),
    el('button', { class: 'choice', onclick: () => answer('order') }, [
      el('strong', {}, 'A rival’s sealed order'), el('span', {}, 'See exactly what one player committed.'),
    ]),
    el('button', { class: 'choice', onclick: () => answer('card') }, [
      el('strong', {}, 'The top of the crown deck'), el('span', {}, 'See next round’s decree before anyone else.'),
    ]),
  ]);
}

function peekTargetForm(s, request) {
  return el('div', { class: 'form choices' }, [
    el('p', { class: 'blurb' }, request.text),
    ...request.options.map((id) => {
      const p = s.players.find((x) => x.id === id);
      return el('button', { class: 'choice', onclick: () => answer(id) }, [
        el('strong', {}, p.name),
        el('span', {}, `${BAND_LABEL[bandOf(p.fealty)]} · ${p.gold} gold · ${p.lands} lands`),
      ]);
    }),
  ]);
}

function turncoatForm(s, request) {
  return el('div', { class: 'form choices' }, [
    el('p', { class: 'blurb' }, `You hold ${request.tokens} turncoat token${request.tokens === 1 ? '' : 's'}. Spending one lets you change your sealed order now that you have seen what you have seen. Keeping one is worth gold to somebody at the deal table.`),
    el('button', { class: 'choice', onclick: () => answer({ action: 'change' }) }, [
      el('strong', {}, 'Spend a token and change my order'),
      el('span', {}, 'Your committed gold comes back and you commit again.'),
    ]),
    el('button', { class: 'choice', onclick: () => answer({ action: 'none' }) }, [
      el('strong', {}, 'Keep it'),
      el('span', {}, 'Sometimes the threat was the point.'),
    ]),
  ]);
}
// ---------------------------------------------------------------- chronicle

function visibleEntry(entry) {
  if (!entry.secret) return true;
  return entry.pid && app.humanSeats.has(entry.pid);
}

function chronicleView(s) {
  const rounds = new Map();
  for (const entry of s.log) {
    if (!visibleEntry(entry)) continue;
    if (!rounds.has(entry.round)) rounds.set(entry.round, []);
    rounds.get(entry.round).push(entry);
  }
  return el('section', { class: 'chronicle' }, [
    el('h3', {}, 'The chronicle'),
    el('div', { class: 'chronicle-scroll' }, [...rounds.entries()].map(([round, entries]) => el('div', { class: 'chronicle-round' }, [
      el('h4', {}, round === 0 ? 'Before the court' : `Round ${round}`),
      ...entries.map((e) => el('p', { class: `entry kind-${e.kind}` }, e.text)),
    ]))),
  ]);
}

// -------------------------------------------------------------- rules modal

function showRules() {
  const dialog = document.getElementById('rules-dialog');
  const t = app.game ? app.game.state.tuning : resolveTuning(activeTuning());
  const capLine = t.commitCap
    ? `No single order may carry more than ${t.commitCap} gold.`
    : 'A single order may carry any amount of gold you hold.';
  {
    mount(dialog, el('div', { class: 'rules-body' }, [
      el('button', { class: 'ghost close', onclick: () => dialog.close() }, 'Close'),
      el('h2', {}, 'The King’s Graces — quick reference'),
      section('The round', [
        'Crown flip — reveal and resolve one crown card.',
        'Table talk — anyone may put a proposal to anyone. Gold moves; promises do not bind.',
        'Commit — everyone seals one order in secret.',
        'Whispers, in two beats: espionage (a turncoat token lets you read a rival’s order or the next card — both at −3), then duplicity (spend a token to change your own order). Deals are open between them, so the token can be sold.',
        'Reveal & resolve — petitions and pardons first, then attacks, then spoils.',
        'Income — 1 gold per land; neutrals take 1 more.',
      ]),
      section('Bands', [
        'Favorite (+2, +3): attacks gain +fealty, but only against someone lower than you. Never against the Crown. Titles at +2 and +3, once each.',
        `Neutral (−1, 0, +1): +${t.neutralIncome} gold every income step.`,
        'Outlaw (−2, −3): take one turncoat token as the round opens — the right to spy in espionage and to reseal in duplicity. Taxed hardest.',
      ]),
      section('Orders', [
        'Attack [target] — 1+ gold. Your walls drop to 0 this round.',
        'Support [target] — 1+ gold, added to their attack if they strike, otherwise their defense.',
        `Petition — ${t.petitionCost} gold for +1 fealty. As an outlaw it is a pardon: ${t.pardonCost} gold, straight to 0, before the swords land.`,
        `Develop — ${t.developCost} gold for one land from the neutral pool.`,
        capLine,
      ]),
      section('Combat', [
        'Attack = gold + support aimed at you + punching-down bonus + Marshal.',
        `Defense = walls (${t.walls}, or 0 if you also attacked) + support aimed at you + Warden.`,
        'Attacker wins on strictly greater. Herald wins its holder every tie.',
        `Spoils: ${t.spoilsGold} gold plundered whatever happens, plus one land — or one title instead, if the loser’s walls were down because they attacked or answered the levy.`,
      ]),
      section('Attacking costs standing', [
        'A favorite: −2 fealty. A neutral: nothing. An outlaw: +1. The Crown: straight to −3.',
      ]),
      section('Usurpation', [
        `Everyone attacking the Crown pools their strength against ${t.crownBase} + cards remaining (plus support).`,
        'Win: the largest single contributor is crowned. Equal largest: civil war, all to −3.',
        'Lose: every conspirator falls to −3 and forfeits a land.',
      ]),
      section('Titles', [
        ...TITLES.map((x) => `${x.name} — ${x.text}`),
        `A grant at +2 or +3 may be spent on a title somebody already holds, for ${t.titleClaimCost} gold to the Crown.`,
      ]),
      section('Winning', [
        'Usurp the throne, or hold the highest fealty when the crown deck runs out (ties: most lands, then most gold).',
      ]),
      section('The crown deck in play', [
        `${t.deck.tax} Tax — favorites pay ${t.taxByBand.favorite}, neutrals ${t.taxByBand.neutral}, outlaws ${t.taxByBand.outlaw}. What you cannot pay in coin is taken in land, one field per ${t.taxLandValue} gold owed, and those fields go back out to tenancy.`,
        `${t.deck.levy} Levy — send your host (no walls, no attack this round) or refuse and drop ${t.levyRefusal} fealty.`,
        `${t.deck.favor} Favor — every favorite is paid ${t.favorGold} gold, and those at +${t.favorLandAt} take a land as well.`,
      ]),
      section('House rulings this build makes', [
        'Support aimed at a player who attacked joins their attack; otherwise it joins their defense.',
        'Develop resolves after spoils, so a new land cannot be looted the round it is settled. If the pool empties first, the 3 gold is returned.',
        'Ransom (§9) resolves with petitions and reads bands from the start of resolution.',
        'A player with no affordable order may Hold. It is not one of the four orders.',
      ]),
    ]));
  }
  dialog.showModal();
}

function section(title, lines) {
  return el('div', { class: 'rules-section' }, [
    el('h3', {}, title),
    el('ul', {}, lines.map((l) => el('li', {}, l))),
  ]);
}

render();
