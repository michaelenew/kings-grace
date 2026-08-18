// Deals: the only way anything changes hands outside of combat.
//
// A deal is a list of transfers. Each transfer moves gold, land, titles or
// turncoat tokens from one house to another. Everyone named in it must accept,
// and then the whole thing settles at once — so three-cornered bargains
// ("I give you a land, you give her gold, she gives me the Herald") are a
// single object rather than a chain of trust.
//
// Nothing here binds anyone to an *order*. You can sell a promise to attack
// somebody, but the promise is table talk and the deal only moves goods.

import { TITLE_BY_ID } from './constants.js';
import { playerById } from './state.js';

/** An empty parcel of goods. */
export const emptyGoods = () => ({ gold: 0, lands: 0, titles: [], turncoat: 0 });

export function goodsAreEmpty(g) {
  return !g || (!g.gold && !g.lands && !(g.titles || []).length && !g.turncoat);
}

export function describeGoods(goods) {
  if (!goods) return 'nothing';
  const bits = [];
  if (goods.gold) bits.push(`${goods.gold} gold`);
  if (goods.lands) bits.push(`${goods.lands} land${goods.lands === 1 ? '' : 's'}`);
  for (const t of goods.titles || []) bits.push(TITLE_BY_ID[t]?.name ?? t);
  if (goods.turncoat) bits.push(`${goods.turncoat} turncoat token${goods.turncoat === 1 ? '' : 's'}`);
  return bits.length ? bits.join(', ') : 'nothing';
}

/** Everyone a deal touches, giver or taker. */
export function participants(deal) {
  const ids = new Set();
  for (const t of deal.transfers || []) {
    if (t.from) ids.add(t.from);
    if (t.to) ids.add(t.to);
  }
  return [...ids];
}

/**
 * Can this deal actually settle right now? Gold already committed to an order
 * is spent and cannot be traded, which is the standing rule from §3.
 */
export function validateDeal(state, deal) {
  const owed = {};
  for (const t of deal.transfers || []) {
    if (!t.from || !t.to || t.from === t.to) return 'A transfer needs two different houses.';
    const giver = playerById(state, t.from);
    const taker = playerById(state, t.to);
    if (!giver || !taker) return 'That house is not at this table.';
    owed[t.from] ??= emptyGoods();
    owed[t.from].gold += Math.max(0, Math.floor(t.goods?.gold || 0));
    owed[t.from].lands += Math.max(0, Math.floor(t.goods?.lands || 0));
    owed[t.from].turncoat += Math.max(0, Math.floor(t.goods?.turncoat || 0));
    for (const title of t.goods?.titles || []) {
      if (!giver.titles.includes(title)) return `${giver.name} does not hold the ${TITLE_BY_ID[title]?.name ?? title}.`;
      if (owed[t.from].titles.includes(title)) return 'The same title cannot be promised twice.';
      owed[t.from].titles.push(title);
    }
  }
  if (!Object.keys(owed).length) return 'A deal has to move something.';
  for (const [pid, goods] of Object.entries(owed)) {
    const p = playerById(state, pid);
    if (goods.gold > p.gold) return `${p.name} does not have ${goods.gold} gold to give.`;
    if (goods.lands > p.lands) return `${p.name} does not have ${goods.lands} lands to give.`;
    if (goods.turncoat > p.turncoat) return `${p.name} does not have that many turncoat tokens.`;
  }
  // A turncoat token is a thing you hold one of, never a stack: no deal may
  // leave a house holding more than the cap. (Net across the whole deal, so
  // giving one and taking one in the same bargain is fine.)
  const cap = state.tuning?.turncoatMax ?? 1;
  const net = {};
  for (const t of deal.transfers || []) {
    const tok = Math.max(0, Math.floor(t.goods?.turncoat || 0));
    if (!tok) continue;
    net[t.from] = (net[t.from] || 0) - tok;
    net[t.to] = (net[t.to] || 0) + tok;
  }
  for (const [pid, delta] of Object.entries(net)) {
    if (delta <= 0) continue;
    const p = playerById(state, pid);
    if (p.turncoat + delta > cap) {
      return `${p.name} already holds a turncoat token — a house can hold only ${cap === 1 ? 'one' : cap}.`;
    }
  }
  return null;
}

/** Move everything at once. Assumes validateDeal already passed. */
export function settleDeal(game, deal) {
  const state = game.state;
  for (const t of deal.transfers || []) {
    const from = playerById(state, t.from);
    const to = playerById(state, t.to);
    const g = t.goods || {};
    const gold = Math.max(0, Math.floor(g.gold || 0));
    const lands = Math.max(0, Math.floor(g.lands || 0));
    const tokens = Math.max(0, Math.floor(g.turncoat || 0));
    from.gold -= gold; to.gold += gold;
    from.lands -= lands; to.lands += lands;
    from.turncoat -= tokens; to.turncoat += tokens;
    for (const title of g.titles || []) {
      from.titles = from.titles.filter((x) => x !== title);
      if (!to.titles.includes(title)) to.titles.push(title);
    }
    if (gold) {
      const key = `${t.from}>${t.to}`;
      state.goodwill[key] = (state.goodwill[key] || 0) + gold;
    }
  }
  state.deals.push({ round: state.round, transfers: deal.transfers });
}

export function summariseDeal(state, deal) {
  const name = (id) => playerById(state, id)?.name ?? id;
  return (deal.transfers || [])
    .filter((t) => !goodsAreEmpty(t.goods))
    .map((t) => `${name(t.from)} → ${name(t.to)}: ${describeGoods(t.goods)}`)
    .join('; ');
}

/**
 * Put a deal to the table. Every participant except the proposer is asked; the
 * deal settles only if all of them accept.
 *
 * @returns {Promise<{accepted:boolean, reason?:string, replies:Array}>}
 */
export async function proposeDeal(game, deal) {
  const state = game.state;
  const problem = validateDeal(state, deal);
  if (problem) return { accepted: false, reason: problem, replies: [] };

  const others = participants(deal).filter((pid) => pid !== deal.proposer);
  if (!others.length) return { accepted: false, reason: 'A deal needs somebody on the other side.', replies: [] };

  const replies = [];
  for (const pid of others) {
    const answer = await game.ask(pid, { type: 'deal', deal, proposer: deal.proposer });
    const ok = !!(answer === true || answer?.accept);
    replies.push({ pid, accepted: ok, line: answer?.line || null });
    if (!ok) {
      game.emit('deal', `${game.nameOf(pid)} refuses ${game.nameOf(deal.proposer)}'s terms.`, {
        secret: true, pid: deal.proposer,
      });
      return { accepted: false, reason: `${game.nameOf(pid)} refused.`, replies };
    }
  }

  // Re-check: gold may have moved while the table was talking.
  const stillGood = validateDeal(state, deal);
  if (stillGood) return { accepted: false, reason: stillGood, replies };

  settleDeal(game, deal);
  game.emit('deal', `A bargain is struck — ${summariseDeal(state, deal)}.`);
  return { accepted: true, replies };
}

/**
 * What a parcel is worth to a given player, in rough gold. Used by bots to
 * decide whether a deal is worth taking, and by the UI to show a running total.
 */
export function goodsValue(goods, player, state) {
  if (!goods) return 0;
  const remaining = state.deck.length;
  let v = goods.gold || 0;
  v += (goods.lands || 0) * (2 + remaining * 0.8);
  v += ((goods.titles || []).length) * 6;
  v += (goods.turncoat || 0) * 3;
  return v;
}

/** Net worth of a deal to one player: what they get minus what they give. */
export function dealBalance(state, deal, pid) {
  const p = playerById(state, pid);
  let net = 0;
  for (const t of deal.transfers || []) {
    if (t.to === pid) net += goodsValue(t.goods, p, state);
    if (t.from === pid) net -= goodsValue(t.goods, p, state);
  }
  return net;
}
