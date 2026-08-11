// Resolution, shown rather than listed.
//
// The engine records a structured beat for everything that happens during
// resolution. This plays them back over the round table in the order the rules
// resolve them — appeal, develop, support, attack — so it is visible who did
// what to whom. Each beat lands, holds a moment, then falls away into the
// screen: shrinking slightly while its alpha goes to zero.

import { CROWN } from '../engine/constants.js';

const ORDER = { appeal: 0, develop: 1, support: 2, attack: 3 };

const TIMING = {
  land: 480, // the beat arrives
  hold: 1100, // and stays long enough to read the whole table at once
  fade: 420, // then falls into the screen
};

/** Sort beats into resolution order, keeping same-kind beats in engine order. */
export function orderBeats(beats) {
  return (beats || [])
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (ORDER[x.b.kind] ?? 9) - (ORDER[y.b.kind] ?? 9) || x.i - y.i)
    .map((x) => x.b);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Centre of a player's card (or the crown panel) in overlay coordinates. */
function anchorFor(stage, id) {
  const sel = id === CROWN ? '[data-anchor="crown"]' : `[data-anchor="${id}"]`;
  const node = document.querySelector(sel);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  const host = stage.getBoundingClientRect();
  return { x: r.left - host.left + r.width / 2, y: r.top - host.top + r.height / 2 };
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * Shrink into the screen and fade. `base` is whatever transform the element
 * already needs to sit where it does — badges are centred with a translate, and
 * dropping it here is what made them jerk to the corner and cut out.
 */
async function fadeOut(node, base = '') {
  const from = `${base} scale(1)`.trim();
  const to = `${base} scale(0.82)`.trim();
  const anim = node.animate(
    [{ opacity: 1, transform: from }, { opacity: 0, transform: to }],
    { duration: TIMING.fade, easing: 'ease-in', fill: 'forwards' },
  );
  await anim.finished.catch(() => {});
  node.remove();
}

const ICONS = {
  // A raised hand at the foot of the throne.
  appeal: '<path d="M12 20V9m0 0-3 3m3-3 3 3" /><path d="M6 25h12" /><path d="M8 5h8l-1 2H9z" />',
  // A keep on new ground.
  develop: '<path d="M6 24h16V13l-3 2V11h-3v2l-2-2-2 2v-2H9v4l-3-2z" /><path d="M4 24h20" />',
};

/** A badge that drops in from the z-direction over a player. */
async function playSymbol(layer, at, kind, label, colour) {
  const badge = document.createElement('div');
  badge.className = `beat beat-${kind}`;
  badge.style.left = `${at.x}px`;
  badge.style.top = `${at.y}px`;
  badge.innerHTML = `
    <svg viewBox="0 0 28 28" aria-hidden="true" style="stroke:${colour}">${ICONS[kind] || ''}</svg>
    <span style="color:${colour}">${label}</span>`;
  layer.append(badge);
  const anim = badge.animate(
    [
      { opacity: 0, transform: 'translate(-50%,-50%) scale(2.4)' },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' },
    ],
    { duration: TIMING.land, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' },
  );
  await anim.finished.catch(() => {});
  await sleep(TIMING.hold);
  await fadeOut(badge, 'translate(-50%,-50%)');
}

/** A neutral line with a flat head, pushing coins along it. */
async function playSupport(layer, from, to, gold) {
  const svg = svgEl('svg', { class: 'beat-svg' });
  const dx = to.x - from.x; const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // Stop short of the target so the head reads as arriving, not overlapping.
  const ex = to.x - (dx / len) * 46; const ey = to.y - (dy / len) * 46;
  const sx = from.x + (dx / len) * 40; const sy = from.y + (dy / len) * 40;
  const line = svgEl('line', { x1: sx, y1: sy, x2: ex, y2: ey, class: 'support-line' });
  const nx = -dy / len; const ny = dx / len;
  const head = svgEl('line', {
    x1: ex + nx * 9, y1: ey + ny * 9, x2: ex - nx * 9, y2: ey - ny * 9, class: 'support-head',
  });
  svg.append(line, head);
  const coins = [];
  for (let i = 0; i < Math.min(3, Math.max(1, gold)); i++) {
    const c = svgEl('circle', { r: 5, cx: sx, cy: sy, class: 'support-coin' });
    svg.append(c);
    coins.push(c);
  }
  layer.append(svg);

  const total = Math.hypot(ex - sx, ey - sy);
  line.style.strokeDasharray = `${total}`;
  line.style.strokeDashoffset = `${total}`;
  line.animate([{ strokeDashoffset: total }, { strokeDashoffset: 0 }], { duration: TIMING.land, fill: 'forwards' });
  head.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], { duration: TIMING.land, fill: 'forwards' });
  await Promise.all(coins.map((c, i) => c.animate(
    [
      { transform: 'translate(0,0)', opacity: 0 },
      { transform: 'translate(0,0)', opacity: 1, offset: 0.15 },
      { transform: `translate(${ex - sx}px, ${ey - sy}px)`, opacity: 1 },
    ],
    { duration: TIMING.land + 160, delay: i * 90, easing: 'ease-out', fill: 'forwards' },
  ).finished.catch(() => {})));
  await sleep(TIMING.hold);
  await fadeOut(svg);
}

/** A curved arrow growing from the attacker toward the target. */
async function playAttack(layer, from, to, won) {
  const svg = svgEl('svg', { class: 'beat-svg' });
  const dx = to.x - from.x; const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const sx = from.x + (dx / len) * 40; const sy = from.y + (dy / len) * 40;
  const ex = to.x - (dx / len) * 48; const ey = to.y - (dy / len) * 48;
  // Bow the arc out to one side so two-way exchanges do not overlap.
  const mx = (sx + ex) / 2 - dy / len * 46;
  const my = (sy + ey) / 2 + dx / len * 46;
  const id = `head-${Math.abs(Math.round(sx + sy))}-${Math.abs(Math.round(ex + ey))}`;
  const defs = svgEl('defs');
  const marker = svgEl('marker', {
    id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse',
  });
  marker.append(svgEl('path', { d: 'M0 0 L10 5 L0 10 z', class: won ? 'attack-head' : 'attack-head repelled' }));
  defs.append(marker);
  const path = svgEl('path', {
    d: `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`,
    class: won ? 'attack-arc' : 'attack-arc repelled',
    'marker-end': `url(#${id})`,
  });
  svg.append(defs, path);
  layer.append(svg);

  const total = path.getTotalLength();
  path.style.strokeDasharray = `${total}`;
  path.style.strokeDashoffset = `${total}`;
  const grow = path.animate(
    [{ strokeDashoffset: total }, { strokeDashoffset: 0 }],
    { duration: TIMING.land + 120, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' },
  );
  await grow.finished.catch(() => {});
  if (!won) {
    await svg.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
      { duration: 180 },
    ).finished.catch(() => {});
  }
  await sleep(TIMING.hold);
  await fadeOut(svg);
}

/**
 * Play a whole round's resolution. Resolves when the last beat has faded, or
 * immediately if the table is not on screen.
 *
 * @param {HTMLElement} stage element the overlay is positioned against
 * @param {Array} beats from state.beats
 * @param {() => boolean} [cancelled] abort early (new game, skip pressed)
 */
export async function playResolution(stage, beats, cancelled = () => false) {
  if (!stage || !beats?.length) return;
  const layer = document.createElement('div');
  layer.className = 'beat-layer';
  stage.append(layer);
  try {
    for (const beat of orderBeats(beats)) {
      if (cancelled()) break;
      const from = anchorFor(stage, beat.actor);
      if (!from) continue;
      if (beat.kind === 'appeal') {
        await playSymbol(layer, from, 'appeal', beat.pardon ? 'Pardon' : 'Appeal', '#d8a33a');
      } else if (beat.kind === 'develop') {
        await playSymbol(layer, from, 'develop', 'Develop', '#7d9463');
      } else {
        const to = anchorFor(stage, beat.target);
        if (!to) continue;
        if (beat.kind === 'support') await playSupport(layer, from, to, beat.gold);
        else await playAttack(layer, from, to, beat.won);
      }
        }
  } finally {
    layer.remove();
  }
}
