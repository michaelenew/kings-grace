// The open deal on the table.
//
// Not a step and not a form: a pot that sits between the seats for the whole
// round. Every house sets what it is *offering* and what it is *taking*. When
// what is offered matches what is taken, and every house involved has pressed
// accept, it settles at once.
//
// Touching any term revokes every acceptance. That is the whole trust model:
// you can never be holding an accept on terms you have not seen.

import { TITLE_BY_ID } from './constants.js';
import { playerById } from './state.js';
import { emptyGoods } from './deals.js';
import { endgameWeight, streamValue } from './horizon.js';

export function blankTable() {
  return { offers: {}, takes: {}, accepted: [] };
}

const norm = (g) => ({
  gold: Math.max(0, Math.floor(g?.gold || 0)),
  lands: Math.max(0, Math.floor(g?.lands || 0)),
  turncoat: Math.max(0, Math.floor(g?.turncoat || 0)),
  titles: [...new Set(g?.titles || [])],
});

const isEmpty = (g) => !g || (!g.gold && !g.lands && !g.turncoat && !(g.titles || []).length);

/** Everyone with something on the table, either side. */
export function dealParticipants(table) {
  const ids = new Set();
  for (const [pid, g] of Object.entries(table.offers || {})) if (!isEmpty(g)) ids.add(pid);
  for (const [pid, g] of Object.entries(table.takes || {})) if (!isEmpty(g)) ids.add(pid);
  return [...ids];
}

function total(side) {
  const sum = emptyGoods();
  for (const g of Object.values(side || {})) {
    const n = norm(g);
    sum.gold += n.gold; sum.lands += n.lands; sum.turncoat += n.turncoat;
    sum.titles.push(...n.titles);
  }
  return sum;
}

/**
 * Why this deal cannot settle yet, or null if it can.
 * Checks both that everyone can pay what they promised and that the pot
 * balances — you cannot take out more than went in.
 */
export function dealProblem(state, table) {
  const players = dealParticipants(table);
  if (players.length < 2) return 'A bargain needs two houses.';

  for (const pid of players) {
    const p = playerById(state, pid);
    const g = norm(table.offers?.[pid] || emptyGoods());
    if (g.gold > p.gold) return `${p.name} has only ${p.gold} gold.`;
    if (g.lands > p.lands) return `${p.name} has only ${p.lands} land.`;
    if (g.turncoat > p.turncoat) return `${p.name} has no such token.`;
    for (const t of g.titles) {
      if (!p.titles.includes(t)) return `${p.name} does not hold the ${TITLE_BY_ID[t]?.name ?? t}.`;
    }
  }

  const offered = total(table.offers);
  const taken = total(table.takes);
  if (offered.gold !== taken.gold) return `Gold does not balance: ${offered.gold} offered, ${taken.gold} claimed.`;
  if (offered.lands !== taken.lands) return `Land does not balance: ${offered.lands} offered, ${taken.lands} claimed.`;
  if (offered.turncoat !== taken.turncoat) return `Tokens do not balance: ${offered.turncoat} offered, ${taken.turncoat} claimed.`;
  const o = [...offered.titles].sort().join(',');
  const t = [...taken.titles].sort().join(',');
  if (o !== t) return 'The titles offered are not the titles claimed.';
  return null;
}

export function everyoneAccepted(table) {
  const players = dealParticipants(table);
  return players.length >= 2 && players.every((pid) => table.accepted.includes(pid));
}

/** Set one house's terms. Any change to the pot clears every acceptance. */
export function setTerms(state, pid, { offers, takes }) {
  const table = state.dealTable;
  if (offers !== undefined) table.offers[pid] = norm(offers);
  if (takes !== undefined) table.takes[pid] = norm(takes);
  table.accepted = [];
  return table;
}

export function acceptTerms(state, pid) {
  const table = state.dealTable;
  if (!table.accepted.includes(pid)) table.accepted.push(pid);
  return table;
}

export function withdraw(state, pid) {
  const table = state.dealTable;
  delete table.offers[pid];
  delete table.takes[pid];
  table.accepted = [];
  return table;
}

/** Move everything at once. Assumes dealProblem returned null. */
export function settleTable(game) {
  const state = game.state;
  const table = state.dealTable;
  const moved = [];
  for (const pid of dealParticipants(table)) {
    const p = playerById(state, pid);
    const out = norm(table.offers?.[pid] || emptyGoods());
    p.gold -= out.gold; p.lands -= out.lands; p.turncoat -= out.turncoat;
    p.titles = p.titles.filter((t) => !out.titles.includes(t));
  }
  for (const pid of dealParticipants(table)) {
    const p = playerById(state, pid);
    const inn = norm(table.takes?.[pid] || emptyGoods());
    p.gold += inn.gold; p.lands += inn.lands; p.turncoat += inn.turncoat;
    for (const t of inn.titles) if (!p.titles.includes(t)) p.titles.push(t);
    if (!isEmpty(inn)) moved.push(`${p.name} takes ${describe(inn)}`);
  }
  state.deals.push({ round: state.round, offers: { ...table.offers }, takes: { ...table.takes } });
  state.dealTable = blankTable();
  return moved;
}

export function describe(goods) {
  const g = norm(goods);
  const bits = [];
  if (g.gold) bits.push(`${g.gold} gold`);
  if (g.lands) bits.push(`${g.lands} land`);
  for (const t of g.titles) bits.push(TITLE_BY_ID[t]?.name ?? t);
  if (g.turncoat) bits.push(`${g.turncoat} token${g.turncoat === 1 ? '' : 's'}`);
  return bits.length ? bits.join(', ') : 'nothing';
}

/**
 * What this deal is worth to one house, roughly, in gold.
 *
 * Land is priced at a three-move horizon plus its claim on the end-of-deck
 * tie-break, not at "every harvest between now and the end of the game" — the
 * old formula made a field on round two worth eleven gold, which meant no
 * bargain involving land could ever look sane to the house giving it up.
 */
export function balanceFor(state, table, pid) {
  const remaining = state.deck.length;
  const landWorth = streamValue(state.tuning?.landIncome ?? 1, remaining) + 2.5 * endgameWeight(remaining);
  const worth = (g) => {
    const n = norm(g);
    return n.gold + n.lands * landWorth + n.titles.length * 6 + n.turncoat * 3;
  };
  return worth(table.takes?.[pid] || {}) - worth(table.offers?.[pid] || {});
}
