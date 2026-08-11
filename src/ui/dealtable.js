// The deal table. Build a bargain of any shape: who gives what to whom, in any
// number of legs, between any number of houses. It settles only when every
// house named in it accepts, so three-cornered trades are one object rather
// than a chain of promises.

import { TITLE_BY_ID } from '../engine/constants.js';
import { INTENTS } from '../engine/diplomacy.js';
import { describeGoods, emptyGoods } from '../engine/deals.js';
import { el, number, select } from './dom.js';

export function blankDraft(me, others) {
  return {
    transfers: [{ from: me, to: others[0], goods: emptyGoods() }],
    intent: null,
    intentOf: others[0],
    intentSubject: others[0],
  };
}

function goodsEditor(state, transfer, onChange) {
  const giver = state.players.find((p) => p.id === transfer.from);
  const g = transfer.goods;
  const heldTitles = giver ? giver.titles : [];
  return el('div', { class: 'goods' }, [
    el('label', {}, [
      el('span', {}, 'gold'),
      number(g.gold, 0, giver ? giver.gold : 0, (v) => { g.gold = v; onChange(); }, { class: 'narrow' }),
    ]),
    el('label', {}, [
      el('span', {}, 'land'),
      number(g.lands, 0, giver ? giver.lands : 0, (v) => { g.lands = v; onChange(); }, { class: 'narrow' }),
    ]),
    el('label', {}, [
      el('span', {}, 'tokens'),
      number(g.turncoat, 0, giver ? giver.turncoat : 0, (v) => { g.turncoat = v; onChange(); }, { class: 'narrow' }),
    ]),
    heldTitles.length ? el('div', { class: 'goods-titles' }, heldTitles.map((t) => el('button', {
      class: `title-toggle${g.titles.includes(t) ? ' on' : ''}`,
      type: 'button',
      onclick: () => {
        g.titles = g.titles.includes(t) ? g.titles.filter((x) => x !== t) : [...g.titles, t];
        onChange();
      },
    }, TITLE_BY_ID[t].name))) : null,
  ]);
}

/**
 * @param {object} state
 * @param {string} me
 * @param {object} draft mutable draft (see blankDraft)
 * @param {object} handlers {onChange, onPropose, onPass, reply}
 */
export function dealBuilder(state, me, draft, handlers) {
  const everyone = state.players.map((p) => ({ value: p.id, label: p.name }));
  const others = state.players.filter((p) => p.id !== me);
  const change = handlers.onChange;

  const rows = draft.transfers.map((transfer, i) => el('div', { class: 'deal-row' }, [
    select(everyone, transfer.from, (v) => { transfer.from = v; transfer.goods.titles = []; change(); }),
    el('span', { class: 'deal-arrow' }, '→'),
    select(everyone, transfer.to, (v) => { transfer.to = v; change(); }),
    goodsEditor(state, transfer, change),
    draft.transfers.length > 1
      ? el('button', { class: 'ghost small', onclick: () => { draft.transfers.splice(i, 1); change(); } }, 'Remove')
      : null,
  ]));

  const summary = draft.transfers
    .filter((t) => t.goods.gold || t.goods.lands || t.goods.turncoat || t.goods.titles.length)
    .map((t) => {
      const name = (id) => state.players.find((p) => p.id === id)?.name ?? id;
      return `${name(t.from)} → ${name(t.to)}: ${describeGoods(t.goods)}`;
    });

  return el('div', { class: 'deal-table' }, [
    el('p', { class: 'blurb' }, 'Put up anything you like and say what you want for it. Every house named has to accept, and then it all changes hands at once.'),
    ...rows,
    el('div', { class: 'deal-actions' }, [
      el('button', {
        class: 'ghost small',
        onclick: () => {
          draft.transfers.push({ from: others[0].id, to: me, goods: emptyGoods() });
          change();
        },
      }, '+ Add a leg'),
    ]),

    el('div', { class: 'deal-intent' }, [
      el('span', { class: 'court-label' }, 'Say'),
      select(
        [{ value: '', label: '(nothing — just the goods)' }, ...INTENTS.map((i) => ({ value: i.id, label: i.label }))],
        draft.intent || '',
        (v) => { draft.intent = v || null; change(); },
      ),
      draft.intent ? select(others.map((p) => ({ value: p.id, label: `to ${p.name}` })), draft.intentOf, (v) => { draft.intentOf = v; change(); }) : null,
      draft.intent === 'attack'
        ? select(state.players.filter((p) => p.id !== draft.intentOf).map((p) => ({ value: p.id, label: `about ${p.name}` })), draft.intentSubject, (v) => { draft.intentSubject = v; })
        : null,
    ]),
    draft.intent ? el('p', { class: 'hint' }, 'Saying it is free and binds nobody — including you.') : null,

    summary.length ? el('div', { class: 'deal-summary' }, summary.map((line) => el('p', {}, line))) : null,
    handlers.reply ? el('p', { class: `reply ${handlers.reply.accepted ? 'yes' : 'no'}` }, handlers.reply.text) : null,

    el('div', { class: 'deal-actions' }, [
      el('button', { class: 'primary', disabled: !summary.length, onclick: handlers.onPropose }, 'Put it to the table'),
      el('button', { class: 'ghost', onclick: handlers.onPass }, 'No deals this round'),
    ]),
  ]);
}

/** The panel shown to a player who has had a deal put to them. */
export function dealOffer(state, request, onAnswer) {
  const name = (id) => state.players.find((p) => p.id === id)?.name ?? id;
  const legs = (request.deal.transfers || []).map((t) => el('p', { class: 'deal-leg' },
    `${name(t.from)} → ${name(t.to)}: ${describeGoods(t.goods)}`));
  const intent = request.deal.intent;
  return el('div', { class: 'form' }, [
    el('p', { class: 'blurb' }, `${name(request.proposer)} puts this to the table:`),
    el('div', { class: 'deal-summary' }, legs),
    intent ? el('p', { class: 'hint' }, `They say: “${INTENTS.find((i) => i.id === intent)?.label ?? intent}.” They are not bound by it.`) : null,
    el('div', { class: 'choices' }, [
      el('button', { class: 'choice', onclick: () => onAnswer({ accept: true }) }, [
        el('strong', {}, 'Accept'), el('span', {}, 'Everything changes hands at once.'),
      ]),
      el('button', { class: 'choice', onclick: () => onAnswer({ accept: false }) }, [
        el('strong', {}, 'Refuse'), el('span', {}, 'Nothing moves.'),
      ]),
    ]),
  ]);
}
