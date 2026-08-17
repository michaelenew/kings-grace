// The open deal on the table.
//
// One house builds the whole bargain — who gives what to whom, in any number of
// legs, across any number of houses — and puts it to the table. Because every
// leg moves goods *from* one house *to* another, the pot is conserved by
// construction: nothing is created or destroyed, it only changes hands. Then
// every other house named in it simply accepts or rejects. When all of them
// have accepted, it settles at once.
//
// This is the transfer model from deals.js, made public and persistent: instead
// of asking each house in turn and settling in one synchronous pass, the
// proposal sits in the middle of the table for all to see until it is accepted,
// rejected, or withdrawn.

import { participants, validateDeal } from './deals.js';

export function blankTable() {
  return { proposer: null, transfers: [], accepted: [] };
}

/** Everyone the open proposal touches, giver or taker. */
export function tableParticipants(table) {
  return participants({ transfers: table?.transfers || [] });
}

/**
 * Put a fresh proposal on the table. The proposer accepts it by building it, so
 * only the other houses named still have to say yes. Any new proposal replaces
 * whatever was there — there is only ever one open deal.
 */
export function setProposal(state, proposer, transfers) {
  state.dealTable = { proposer, transfers: transfers.map(cloneLeg), accepted: [proposer] };
  return state.dealTable;
}

function cloneLeg(t) {
  return {
    from: t.from,
    to: t.to,
    goods: {
      gold: Math.max(0, Math.floor(t.goods?.gold || 0)),
      lands: Math.max(0, Math.floor(t.goods?.lands || 0)),
      turncoat: Math.max(0, Math.floor(t.goods?.turncoat || 0)),
      titles: [...new Set(t.goods?.titles || [])],
    },
  };
}

export function acceptProposal(state, pid) {
  const table = state.dealTable;
  if (!table.accepted.includes(pid)) table.accepted.push(pid);
  return table;
}

/** Have all the houses named in the deal accepted it? */
export function everyoneAccepted(state) {
  const table = state.dealTable;
  const parts = tableParticipants(table);
  return parts.length >= 2 && parts.every((pid) => table.accepted.includes(pid));
}

/** Why this deal cannot settle right now, or null if it can. */
export function proposalProblem(state) {
  const table = state.dealTable;
  const parts = tableParticipants(table);
  if (parts.length < 2) return 'A bargain needs two houses.';
  return validateDeal(state, { transfers: table.transfers });
}

/** Sweep the whole pot off the table — a rejection or a withdrawal. */
export function killTable(state) {
  state.dealTable = blankTable();
  return state.dealTable;
}
