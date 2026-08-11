// The King's Graces — browser client.
//
// The engine (src/engine) knows nothing about the DOM; this file is the seat
// controller for every human player plus the renderer for the shared board.

import {
  BAND_LABEL, CARD_LABEL, CROWN, HOUSE_NAMES, ORDER, ORDER_LABEL,
  PERSONALITY_LABEL, TITLES, TITLE_BY_ID, bandOf, cardText,
} from '../engine/constants.js';
import { Game, describeOrder } from '../engine/game.js';
import { createGame, crownStrength, commitCeiling } from '../engine/state.js';
import { PLAYER_MAX, PLAYER_MIN, resolveTuning } from '../engine/tuning.js';
import { createAI, saltFor } from '../engine/ai.js';
import { INTENTS } from '../engine/diplomacy.js';
import { emptyGoods } from '../engine/deals.js';
import { el, mount, number, select } from './dom.js';
import { sequenceCard, stageFor } from './sequence.js';
import { referenceCard } from './reference.js';
import { dealOffer } from './dealtable.js';
import { describe as describeGoods } from '../engine/dealtable.js';
import { playResolution } from './animate.js';

const root = document.getElementById('app');

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
  { key: 'crownBase', label: 'Crown strength constant' },
  { key: 'crownPerPlayer', label: 'Crown strength per player', negative: true },
  { key: 'commitCap', label: 'Most gold in one order', hint: 'Blank for no cap. A cap is what forces a usurpation to be a conspiracy.', nullable: true },
  { key: 'petitionCost', label: 'Petition cost' },
  { key: 'pardonCost', label: 'Pardon cost (outlaws)' },
  { key: 'developCost', label: 'Develop cost' },
  { key: 'levyCost', label: 'Levy demand' },
  { key: 'walls', label: 'Walls' },
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
  return ['order', 'peekChoice', 'peekTarget', 'turncoat', 'deal'].includes(request.type);
}

function answer(value) {
  const p = app.pending;
  if (!p) return;
  app.pending = null;
  app.parleyReply = null;
  p.resolve(value);
  render();
}

function defaultDraft(request, view, pid) {
  if (request.type !== 'order') return {};
  const me = view.players.find((x) => x.id === pid);
  const first = request.legal[0];
  const others = view.players.filter((x) => x.id !== pid);
  return {
    order: first,
    target: others[0]?.id ?? CROWN,
    gold: Math.min(1, me.gold),
  };
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
    pause: async (label) => {
      if (label === 'crown') return;
      if (app.humanSeats.size === 0) return;
      // Show the round rather than listing it, then wait to be dismissed.
      if (label === 'roundEnd' && app.settings.animate) await showResolution();
      await new Promise((resolve) => {
        app.paused = { label, resolve };
        render();
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
  const p = app.paused;
  if (!p) return;
  app.paused = null;
  p.resolve();
  render();
}

// ------------------------------------------------------------------- render

/** A small explain-on-click panel. Hover titles were unreliable; a click is not. */
export function openPopover(title, text) {
  app.popover = { title, text };
  render();
}

function trayEditor() {
  if (!app.trayFor || !app.game) return null;
  const s = app.game.state;
  const pid = app.trayFor;
  const me = s.players.find((p) => p.id === pid);
  const table = s.dealTable;
  const draft = app.trayDraft ??= {
    offers: { ...emptyGoods(), ...(table.offers?.[pid] || {}) },
    takes: { ...emptyGoods(), ...(table.takes?.[pid] || {}) },
  };
  const close = () => { app.trayFor = null; app.trayDraft = null; render(); };

  const side = (label, key, limits) => el('div', { class: 'tray-side' }, [
    el('h5', {}, label),
    el('div', { class: 'goods' }, [
      el('label', {}, [el('span', {}, 'gold'), number(draft[key].gold, 0, limits.gold, (v) => { draft[key].gold = v; render(); }, { class: 'narrow' })]),
      el('label', {}, [el('span', {}, 'land'), number(draft[key].lands, 0, limits.lands, (v) => { draft[key].lands = v; render(); }, { class: 'narrow' })]),
      el('label', {}, [el('span', {}, 'tokens'), number(draft[key].turncoat, 0, limits.turncoat, (v) => { draft[key].turncoat = v; render(); }, { class: 'narrow' })]),
    ]),
    el('div', { class: 'goods-titles' }, limits.titles.map((t) => el('button', {
      class: `title-toggle${draft[key].titles.includes(t) ? ' on' : ''}`,
      onclick: () => {
        draft[key].titles = draft[key].titles.includes(t)
          ? draft[key].titles.filter((x) => x !== t) : [...draft[key].titles, t];
        render();
      },
    }, TITLE_BY_ID[t].name))),
  ]);

  const othersTitles = s.players.filter((p) => p.id !== pid).flatMap((p) => p.titles);
  return el('div', { class: 'popover-backdrop', onclick: close }, [
    el('div', { class: 'popover wide', onclick: (e) => e.stopPropagation() }, [
      el('h4', {}, `${me.name} — your side of the table`),
      el('p', {}, 'Everything offered has to match everything taken, across all houses. Changing anything withdraws every acceptance.'),
      el('div', { class: 'tray-sides' }, [
        side('You offer', 'offers', { gold: me.gold, lands: me.lands, turncoat: me.turncoat, titles: me.titles }),
        side('You take', 'takes', { gold: 99, lands: 99, turncoat: 9, titles: [...new Set(othersTitles)] }),
      ]),
      el('div', { class: 'deal-actions' }, [
        el('button', {
          class: 'primary',
          onclick: async () => { await app.game.setDealTerms(pid, draft); close(); },
        }, 'Put it on the table'),
        el('button', { class: 'ghost', onclick: close }, 'Cancel'),
      ]),
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
      el('p', {}, app.popover.text),
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
  const seats = s.players.map((p, i) => {
    // Seat one at the bottom (nearest the player) and go round from there.
    const angle = (Math.PI / 2) + (i * 2 * Math.PI) / n;
    const x = 50 + 41 * Math.cos(angle);
    const y = 50 + 34 * Math.sin(angle);
    const wrap = el('div', { class: 'seat', dataset: { anchor: p.id } }, [
      playerCard(s, p),
      dealTray(s, p),
    ]);
    wrap.style.left = `${x}%`;
    wrap.style.top = `${y}%`;
    return wrap;
  });
  return el('section', { class: `round-table seats-${n}` }, [...seats, centrePiece(s)]);
}

/**
 * Each house's side of the open bargain, sitting next to their marker. Yours is
 * editable; everyone else's is just visible, which is the point — a deal is a
 * thing on the table, not a conversation you have to remember.
 */
function dealTray(s, p) {
  const table = s.dealTable || { offers: {}, takes: {}, accepted: [] };
  const offer = table.offers?.[p.id];
  const take = table.takes?.[p.id];
  const involved = !isEmptyGoods(offer) || !isEmptyGoods(take);
  const mine = app.humanSeats.has(p.id);
  const accepted = table.accepted?.includes(p.id);
  if (!involved && !mine) return null;

  return el('div', { class: `tray${involved ? ' active' : ''}${accepted ? ' accepted' : ''}` }, [
    involved ? el('div', { class: 'tray-terms' }, [
      el('span', { class: 'tray-line' }, [el('b', {}, 'offers '), describeGoods(offer || {})]),
      el('span', { class: 'tray-line' }, [el('b', {}, 'takes '), describeGoods(take || {})]),
    ]) : null,
    mine ? el('div', { class: 'tray-actions' }, [
      el('button', { class: 'ghost small', onclick: () => { app.trayFor = p.id; render(); } }, involved ? 'Change' : 'Offer a deal'),
      involved ? el('button', {
        class: `small${accepted ? ' primary' : ''}`,
        onclick: async () => {
          const res = await app.game.acceptDeal(p.id);
          app.trayNote = res.settled ? 'Struck.' : (res.reason || `Waiting on ${(res.waiting || []).join(', ')}`);
          await app.game.inviteBotAcceptance();
          render();
        },
      }, accepted ? 'Accepted' : 'Accept') : null,
      involved ? el('button', { class: 'ghost small', onclick: async () => { await app.game.withdrawFromDeal(p.id); render(); } }, 'Withdraw') : null,
    ]) : accepted ? el('span', { class: 'tray-ok' }, 'accepted') : null,
  ]);
}

const isEmptyGoods = (g) => !g || (!g.gold && !g.lands && !g.turncoat && !(g.titles || []).length);

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
    ]),
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
      resource('Gold', p.gold),
      p.escrow > 0 ? resource('Sealed', p.escrow, 'muted') : null,
      p.turncoat > 0 ? resource('Tokens', p.turncoat, 'token') : null,
    ]),
    el('div', { class: 'titles' }, p.titles.length
      ? p.titles.map((t) => el('span', { class: 'title-chip', title: TITLE_BY_ID[t].text }, TITLE_BY_ID[t].name))
      : [el('span', { class: 'title-chip empty' }, 'no titles')]),
    commitment && showOrder
      ? el('div', { class: 'order-line' }, describeOrder(commitment, (id) => nameOf(s, id), s.tuning.pardonCost))
      : commitment
        ? el('div', { class: 'order-line sealed' }, 'orders sealed')
        : null,
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
  if (app.paused) return pausePanel(s);
  return el('section', { class: 'stage' }, [
    el('div', { class: 'waiting' }, [
      el('span', { class: 'spinner' }),
      el('p', {}, 'The court deliberates…'),
    ]),
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
    [ORDER.SUPPORT]: 'Your gold joins the target’s attack if they strike, otherwise their defense.',
    [ORDER.PETITION]: bandOf(me.fealty) === BAND_OUTLAW_KEY
      ? `A pardon: ${t.pardonCost} gold, straight back to fealty 0, before the swords land.`
      : atCeiling
        ? `You are already at +3. ${t.petitionCost} gold buys you nothing.`
        : `${t.petitionCost} gold for one step up the track.`,
    [ORDER.DEVELOP]: `${t.developCost} gold for one land from the neutral pool. Lands pay every round.`,
    [ORDER.RANSOM]: `Once per game. Steal ${t.ransomTake} gold. Favorites cost you 2 fealty; outlaws pay a bounty of +1.`,
    [ORDER.HOLD]: 'You cannot afford anything else.',
  }[d.order];

  return el('div', { class: 'form' }, [
    el('div', { class: 'order-grid' }, orderChoices(s, me, request).map(({ order: o, ok, why }) => el('button', {
      class: `order-btn${d.order === o ? ' chosen' : ''}${ok ? '' : ' locked'}`,
      disabled: !ok,
      title: ok ? null : why,
      onclick: () => {
        if (!ok) return;
        d.order = o;
        if (o === ORDER.PETITION || o === ORDER.DEVELOP) d.gold = 0;
        else d.gold = Math.max(1, Math.min(d.gold || 1, ceiling));
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
    el('p', { class: 'blurb' }, blurb),
    needsTarget ? el('label', { class: 'field' }, [
      el('span', {}, 'Target'),
      select(
        [...others.map((p) => ({ value: p.id, label: `${p.name} (${BAND_LABEL[bandOf(p.fealty)]}, ${p.lands} lands)` })),
          { value: CROWN, label: `The Crown (strength ${crownStrength(s)})` }],
        d.target,
        (v) => { d.target = v; render(); },
      ),
    ]) : null,
    needsGold ? el('label', { class: 'field' }, [
      el('span', {}, t.commitCap && me.gold > ceiling
        ? `Gold committed (you hold ${me.gold}; no order may carry more than ${t.commitCap})`
        : `Gold committed (you hold ${me.gold})`),
      el('div', { class: 'gold-row' }, [
        el('input', {
          type: 'range', min: 1, max: Math.max(1, ceiling), value: Math.min(d.gold || 1, ceiling),
          oninput: (e) => { d.gold = Number(e.target.value); render(); },
        }),
        el('span', { class: 'gold-value' }, String(Math.min(d.gold || 1, ceiling))),
        el('button', { class: 'ghost small', onclick: () => { d.gold = ceiling; render(); } }, 'All in'),
      ]),
    ]) : null,
    needsGold && d.target === CROWN ? el('p', { class: 'warn' }, `The Crown defends with ${crownStrength(s)} plus any support. Raising a hand against it sets your fealty to −3 either way.`) : null,
    needsGold && d.target !== CROWN && d.order === ORDER.ATTACK ? attackPreview(s, me, d) : null,
    fixedCost ? el('p', { class: 'blurb' }, `Cost: ${fixedCost} gold.`) : null,
    el('button', {
      class: 'primary big',
      onclick: () => answer({ order: d.order, target: needsTarget ? d.target : null, gold: needsGold ? Math.min(d.gold || 1, me.gold) : 0 }),
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
    if (order === ORDER.ATTACK || order === ORDER.SUPPORT) why = `needs at least 1 gold, you hold ${me.gold}`;
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
  return el('div', { class: 'preview' }, [
    el('p', {}, `Your strength: ${strength} (${d.gold || 1} gold${marshal ? ' + 1 Marshal' : ''}${punch ? ` + ${punch} punching down` : ''}).`),
    el('p', {}, `Their walls: ${t.walls}${warden ? ` + ${warden} Warden` : ''} — unless they attack too, in which case 0. Support on either side is hidden.`),
    el('p', {}, `Striking a ${BAND_LABEL[bandOf(target.fealty)].toLowerCase()} costs you ${consequence}.`),
  ]);
}

function levyForm(s, me, request) {
  return el('div', { class: 'form choices' }, [
    el('p', { class: 'blurb' }, 'The Crown demands its levy.'),
    el('button', { class: 'choice', disabled: me.gold < request.cost, onclick: () => answer('pay') }, [
      el('strong', {}, `Pay ${request.cost} gold`), el('span', {}, `You hold ${me.gold}.`),
    ]),
    el('button', { class: 'choice', onclick: () => answer('fealty') }, [
      el('strong', {}, 'Drop 1 fealty'),
      el('span', {}, me.fealty <= -3 ? 'You are already at the floor — this costs nothing.' : `You would fall to ${me.fealty - 1}.`),
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
  return el('div', { class: 'form' }, [
    el('p', { class: 'blurb' }, `You have reached fealty +${request.threshold}. Choose a title — it is yours forever unless someone takes it from you in the field.`),
    el('div', { class: 'title-grid' }, request.available.map((id) => el('button', {
      class: 'title-option', onclick: () => answer(id),
    }, [
      el('strong', {}, TITLE_BY_ID[id].name),
      el('span', {}, TITLE_BY_ID[id].text),
    ]))),
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
    ? `No single order may carry more than ${t.commitCap} gold, so no one purse can buy the throne alone.`
    : 'A single order may carry any amount of gold you hold.';
  {
    mount(dialog, el('div', { class: 'rules-body' }, [
      el('button', { class: 'ghost close', onclick: () => dialog.close() }, 'Close'),
      el('h2', {}, 'The King’s Graces — quick reference'),
      section('The round', [
        'Crown flip — reveal and resolve one crown card.',
        'Table talk — anyone may put a proposal to anyone. Gold moves; promises do not bind.',
        'Commit — everyone seals one order. Outlaws then peek and may turn a coat.',
        'Reveal & resolve — petitions and pardons first, then attacks, then spoils.',
        'Income — 1 gold per land; neutrals take 1 more.',
      ]),
      section('Bands', [
        'Favorite (+2, +3): attacks gain +fealty, but only against someone lower than you. Never against the Crown. Titles at +2 and +3, once each.',
        `Neutral (−1, 0, +1): +${t.neutralIncome} gold every income step.`,
        'Outlaw (−2, −3): peek before reveal (−2: one order or the top card; −3: both), then one change of orders you may keep or give away. Taxed hardest.',
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
        'Spoils: one land, or one title if the loser’s walls were down.',
      ]),
      section('Attacking costs standing', [
        'A favorite: −2 fealty. A neutral: nothing. An outlaw: +1. The Crown: straight to −3.',
      ]),
      section('Usurpation', [
        `Everyone attacking the Crown pools their strength against ${t.crownBase} + cards remaining (plus support).`,
        'Win: the largest single contributor is crowned. Equal largest: civil war, all to −3.',
        'Lose: every conspirator falls to −3 and forfeits a land.',
      ]),
      section('Titles', TITLES.map((t) => `${t.name} — ${t.text}`)),
      section('Winning', [
        'Usurp the throne, or hold the highest fealty when the crown deck runs out (ties: most lands, then most gold).',
      ]),
      section('The crown deck in play', [
        `${t.deck.tax} Tax — favorites pay ${t.taxByBand.favorite}, neutrals ${t.taxByBand.neutral}, outlaws ${t.taxByBand.outlaw}.`,
        `${t.deck.levy} Levy — pay ${t.levyCost} gold or drop 1 fealty.`,
        `${t.deck.favor} Favor, ${t.deck.purge} Purge.`,
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
