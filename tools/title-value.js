#!/usr/bin/env node
// What is a title actually worth?
//
// The obvious measurement is a trap. "Herald holders win 2.1x the baseline" is
// a *correlation*: titles are handed out at +2 and +3 fealty, so the houses
// holding them are by definition the ones already climbing, already winning.
// It cannot tell you whether the title caused the win or the win caused the
// title.
//
// So this does the other experiment. Give one randomly chosen house one title
// for free at setup, change nothing else, and compare its win rate against the
// same seat in the same game with no title at all. Same seed, same deck, same
// bots. The difference is the title's causal value.
//
//   node tools/title-value.js -n 800
//
// Read the caveat at the bottom of the output before believing any of it.

import { Game } from '../src/engine/game.js';
import { createGame } from '../src/engine/state.js';
import { createAI, saltFor } from '../src/engine/ai.js';
import { TITLES } from '../src/engine/constants.js';
import { POOL } from './tournament.js';
import { makeRng } from '../src/engine/rng.js';

const args = process.argv.slice(2);
const N = Number(args[args.indexOf('-n') + 1]) || 400;

async function runGame(seed, gift) {
  const rng = makeRng(seed ^ 0x5bf03635);
  const doctrines = Array.from({ length: 4 }, (_, i) => rng.shuffle(POOL)[i % POOL.length]);
  const state = createGame({
    seed,
    seats: doctrines.map((doctrine) => ({ kind: 'ai', doctrine })),
  });
  // Always pick the same seat for a given seed, so gifted and control games
  // differ in exactly one thing.
  const lucky = state.players[seed % state.players.length];
  // The gift is *extra*: it does not consume the grant at +2. Burning the grant
  // would measure "this title now" against "whichever title you would have
  // picked later", which is a question about the pecking order among titles,
  // not about what a title is worth. This measures the latter.
  if (gift) lucky.titles.push(gift);
  const controllers = {};
  state.players.forEach((p) => { controllers[p.id] = createAI(p.personality, p.doctrine, saltFor(state.seed, p.seat)); });
  const game = new Game({ state, controllers });
  const winner = await game.run();
  let stolen = 0;
  for (const entry of state.log) if (entry.kind === 'spoils' && entry.text.includes('strips')) stolen += 1;
  return { won: !!winner?.playerIds.includes(lucky.id), stolen };
}

const rows = [];
let controlWins = 0;
let stolenTotal = 0;
let games = 0;

for (let seed = 1; seed <= N; seed++) {
  const r = await runGame(seed, null);
  if (r.won) controlWins += 1;
  stolenTotal += r.stolen;
  games += 1;
}

for (const title of TITLES) {
  let wins = 0;
  for (let seed = 1; seed <= N; seed++) {
    const r = await runGame(seed, title.id);
    if (r.won) wins += 1;
  }
  rows.push({ title: title.name, rate: (100 * wins) / N });
}

const base = (100 * controlWins) / N;
console.log(`\nOne free title at setup, ${N} games each, against ${N} identical games with none.`);
console.log(`Baseline: that seat wins ${base.toFixed(1)}% of the time with no title.\n`);
for (const row of rows.sort((a, b) => b.rate - a.rate)) {
  const delta = row.rate - base;
  const bar = '█'.repeat(Math.max(0, Math.round(Math.abs(delta))));
  console.log(`  ${row.title.padEnd(11)} ${row.rate.toFixed(1).padStart(5)}%  ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1).padStart(4)}pt  ${bar}`);
}

console.log(`\nTitles stolen in combat: ${(stolenTotal / games).toFixed(2)} per game.`);
console.log(`
CAVEAT. These bots take land over titles in almost every spoils decision, never
bluff, and cannot bargain, so a title they hold is a title nobody is trying to
take off them. In a real game an advantage is only worth what you can do with
it, it becomes your opponent's advantage the moment it is stolen, and defending
it costs you the land and gold you were not building. Treat the numbers above as
an upper bound on the blunt-instrument value of a title and nothing more.`);
