// The turn tracker: what is left in the royal deck, and where in the round we
// are. Mousing over a stage explains it — including the one thing that catches
// everyone out, which is that standing settles before the swords do.

import { CARD_LABEL } from '../engine/constants.js';
import { el } from './dom.js';

export const STAGES = [
  {
    id: 'crownFlip',
    label: 'Rents & the royal card',
    phases: ['income', 'crownFlip'],
    detail: 'First every house collects its rents — a gold for each land it holds, and a gold more for a neutral — so the purse you carry into the round is the one you just filled. Then the top card of the royal deck is turned and resolved at once: a tax, a levy, or a favour paid to the loyal. A levy asks for your host: serve and you have no walls and no attack this round, refuse and you lose standing, and the whole table sees which you chose before anyone picks a target. Outlaws take their turncoat token now, and can bargain with it for the rest of the round.',
  },
  {
    id: 'commit',
    label: 'Sealed orders',
    phases: ['commit'],
    detail: 'Everyone chooses one order in secret — attack, support, appeal or develop — and commits gold to it. Committed gold is spent whatever happens, and cannot be traded away afterwards.',
  },
  {
    id: 'espionage',
    label: 'Whispers · Espionage',
    phases: ['espionage'],
    detail: 'A turncoat token is the right to look. Whoever holds one reads a rival’s sealed order or the next royal card — both, at −3. Looking does not spend the token. No token, no peek, whatever your standing: sell your coat and you have sold your eyes.',
  },
  {
    id: 'duplicity',
    label: 'Whispers · Duplicity',
    phases: ['duplicity'],
    detail: 'The token is also the right to change your own sealed order. Whoever holds one now may spend it to reseal. Between the looking and the changing the table is open, so a token can be sold to whoever wants the change — the house that spied and the house that reseals need not be the same one.',
  },
  {
    id: 'resolve',
    label: 'Reveal & resolve',
    phases: ['resolve', 'gameOver'],
    detail: 'Orders flip at once and settle in a fixed order: appeals and pardons first, so standing — and therefore every band effect — is already updated when the swords land; then land is settled; then support is counted; then attacks resolve and spoils change hands. Income last.',
  },
];

export function stageFor(phase) {
  return STAGES.find((s) => s.phases.includes(phase))?.id ?? null;
}

/**
 * @param {object} state
 * @param {(title: string, text: string) => void} explain opens a popover
 */
export function sequenceCard(state, explain) {
  // Solo play passes the raw state (a deck array); a networked seat renders from
  // a redacted view, which carries the public per-kind counts instead. Accept
  // either — never the deck's order, which is secret.
  const remaining = {};
  if (state.deck) for (const card of state.deck) remaining[card] = (remaining[card] || 0) + 1;
  else Object.assign(remaining, state.deckCounts || {});
  const left = state.deck ? state.deck.length : (state.deckCount ?? 0);
  const current = stageFor(state.phase);
  const shown = STAGES.find((s) => s.id === current);

  return el('aside', { class: 'sequence' }, [
    el('div', { class: 'deck-count' }, [
      el('strong', {}, `${left}`),
      el('span', {}, ` / ${state.deckStart} cards remain`),
    ]),
    el('div', { class: 'deck-breakdown' },
      Object.entries(CARD_LABEL)
        .filter(([id]) => remaining[id])
        .map(([id, label]) => el('span', { class: `deck-tag tag-${id}` }, `${label}: ${remaining[id]}`))
        .concat(left ? [] : [el('span', { class: 'deck-tag' }, 'the deck is spent')])),

    el('h3', {}, 'The round'),
    el('ol', { class: 'stages' }, STAGES.map((stage, i) => el('li', {}, [
      el('button', {
        class: `stage-step${stage.id === current ? ' now' : ''}`,
        onclick: () => explain(stage.label, stage.detail),
      }, [
        el('span', { class: 'stage-num' }, String(i + 1)),
        el('span', { class: 'stage-label' }, stage.label),
        el('span', { class: 'stage-more' }, '?'),
      ]),
    ]))),
    el('p', { class: 'hint' }, 'Deals are not a step — strike them at any time until the orders resolve. Click a step for detail.'),

    el('div', { class: 'stage-detail' }, [
      el('h5', {}, shown ? shown.label : ''),
      el('p', {}, shown ? shown.detail : ''),
    ]),
  ]);
}
