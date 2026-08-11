#!/usr/bin/env node
// CLI over tools/tournament.js. This is the instrument the constants were
// tuned with; every number in the README's tuning table came out of it.
//
//   node tools/simulate.js                            # every preset, headline table
//   node tools/simulate.js --preset tuned -n 2000     # one preset in detail
//   node tools/simulate.js --preset tuned --sweep crownBase=4,6,8
//   node tools/simulate.js --search --grid 'crownBase=6|8,commitCap=6|8'
//
// Shorthands: tax=N sets the whole band ladder, taxOutlaw/taxNeutral/
// taxFavorite set one rung, deckTax/deckFavor/... set deck counts,
// hitFavorite/hitOutlaw set the standing cost of attacking that band.

import { PRESETS } from '../src/engine/tuning.js';
import { POOL, detail, expand, fmtRow, imbalance, mergeTuning, tournament } from './tournament.js';

function parseArgs(argv) {
  const args = { n: 400, preset: null, sweep: null, json: false, ransom: false, doctrines: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-n') args.n = Number(argv[++i]);
    else if (a === '--preset') args.preset = argv[++i];
    else if (a === '--sweep') args.sweep = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--ransom') args.ransom = true;
    else if (a === '--doctrines') args.doctrines = argv[++i].split(',');
    else if (a === '--set') args.override = parseOverride(argv[++i]);
    else if (a === '--search') args.search = true;
    else if (a === '--grid') args.grid = argv[++i];
    else if (a === '--top') args.top = Number(argv[++i]);
  }
  return args;
}

function parseOverride(text) {
  const out = {};
  for (const pair of text.split(',')) {
    const [k, v] = pair.split('=');
    mergeTuning(out, expand(k, v));
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const presetBase = () => ({ ...(args.preset ? PRESETS[args.preset].tuning : {}), ...(args.override || {}) });

if (args.search) {
  const grid = args.grid
    ? Object.fromEntries(args.grid.split(',').map((part) => {
      const [k, vs] = part.split('=');
      return [k, vs.split('|').map((v) => (v === 'null' ? null : Number(v)))];
    }))
    : { crownBase: [4, 6, 8, 10], commitCap: [null, 6, 8], levyCost: [2, 3, 4] };
  const keys = Object.keys(grid);
  let combos = [{}];
  for (const key of keys) combos = combos.flatMap((c) => grid[key].map((v) => ({ ...c, [key]: v })));
  const built = combos.map((combo) => {
    const out = presetBase();
    for (const [k, v] of Object.entries(combo)) mergeTuning(out, expand(k, v));
    return { tuning: out, label: keys.map((k) => `${k} ${combo[k] ?? '-'}`).join(' ') };
  });
  console.log(`grid search: ${built.length} configurations x ${args.n} games\n`);
  const scored = [];
  for (const row of built) {
    const { summary } = await tournament(row.tuning, args);
    const { penalty, notes } = imbalance(summary);
    scored.push({ ...row, summary, penalty, notes });
  }
  scored.sort((a, b) => a.penalty - b.penalty);
  for (const row of scored.slice(0, args.top || 12)) {
    console.log(`${String(row.penalty.toFixed(0)).padStart(4)}  ${fmtRow(row.label, row.summary)}`);
    console.log(`        ${row.notes.join('  ')}`);
  }
} else if (args.sweep) {
  const [key, list] = args.sweep.split('=');
  console.log(`sweeping ${key} over ${list} (${args.n} games each)\n`);
  for (const raw of list.split(',')) {
    const tuning = mergeTuning(presetBase(), expand(key, raw));
    const { summary } = await tournament(tuning, args);
    console.log(`${String(imbalance(summary).penalty.toFixed(0)).padStart(4)}  ${fmtRow(`${key}=${raw}`, summary)}`);
  }
} else if (args.preset) {
  const { summary } = await tournament(presetBase(), args);
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    detail(args.preset + (args.override ? ' (modified)' : ''), summary);
    const { penalty, notes } = imbalance(summary);
    console.log('  imbalance   ', penalty.toFixed(0), notes.length ? `(${notes.join('  ')})` : '(clean)');
  }
} else {
  console.log(`${args.n} games per preset, four doctrines drawn from ${POOL.join('/')}\n`);
  const results = {};
  for (const [name, preset] of Object.entries(PRESETS)) {
    results[name] = (await tournament(preset.tuning, args)).summary;
    console.log(`${String(imbalance(results[name]).penalty.toFixed(0)).padStart(4)}  ${fmtRow(name, results[name])}`);
  }
  for (const [name, summary] of Object.entries(results)) {
    detail(name, summary);
    const { penalty, notes } = imbalance(summary);
    console.log('  imbalance   ', penalty.toFixed(0), notes.length ? `(${notes.join('  ')})` : '(clean)');
  }
}
