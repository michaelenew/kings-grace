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

import { POOL, detail, expand, fmtRow, imbalance, mergeTuning, tournament } from './tournament.js';

function parseArgs(argv) {
  const args = { n: 400, sweep: null, json: false, ransom: false, doctrines: null, players: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-n') args.n = Number(argv[++i]);
    else if (a === '--players') args.players = Number(argv[++i]);
    else if (a === '--sweep') args.sweep = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--ransom') args.ransom = true;
    else if (a === '--doctrines') args.doctrines = argv[++i].split(',');
    else if (a === '--set') args.override = parseOverride(argv[++i]);
    else if (a === '--search') args.search = true;
    else if (a === '--grid') args.grid = argv[++i];
    else if (a === '--top') args.top = Number(argv[++i]);
    else if (a === '--counts') args.counts = true;
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
const presetBase = () => ({ ...(args.override || {}) });

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
    const { penalty, notes } = imbalance(summary, args.players);
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
    console.log(`${String(imbalance(summary, args.players).penalty.toFixed(0)).padStart(4)}  ${fmtRow(`${key}=${raw}`, summary)}`);
  }
} else if (args.counts) {
  console.log(`${args.n} games at each table size\n`);
  for (const players of [2, 3, 4, 5, 6]) {
    const { summary } = await tournament(presetBase(), { ...args, players });
    console.log(`${String(imbalance(summary, players).penalty.toFixed(0)).padStart(4)}  ${fmtRow(`${players} players`, summary)}`);
  }
} else {
  const { summary } = await tournament(presetBase(), args);
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    detail(`${args.players} players${args.override ? ' (modified)' : ''}`, summary);
    const { penalty, notes } = imbalance(summary, args.players);
    console.log('  imbalance   ', penalty.toFixed(0), notes.length ? `(${notes.join('  ')})` : '(clean)');
  }
}
