// The turn tracker: what is left in the royal deck, and where in the round we
// are. Mousing over a stage explains it — including the one thing that catches
// everyone out, which is that standing settles before the swords do.

import { CARD_LABEL } from '../engine/constants.js';
import { el } from './dom.js';

export const STAGES = [
  {
    id: 'crownFlip',
    label: 'The royal card',
    phases: ['crownFlip'],
    detail: 'Turn the top card of the royal deck and resolve it at once — a tax, a levy, or a favour paid to the loyal. Outlaws take their turncoat token now, and can bargain with it for the rest of the round. Everything after this happens knowing what the Crown just did.',
  },
  {
    id: 'commit',
    label: 'Sealed orders',
    phases: ['commit'],
    detail: 'Everyone chooses one order in secret — attack, support, appeal or develop — and commits gold to it. Committed gold is spent whatever happens, and cannot be traded away afterwards.',
  },
  {
    id: 'peek',
    label: 'Whispers',
    phases: ['peek'],
    detail: 'Outlaws look at what they should not: a rival’s sealed order, or the next royal card, or at −3 both. Anyone holding a turncoat token may spend it here to change their own sealed order — including a token they bought earlier in the round.',
  },
  {
    id: 'resolve',
    label: 'Reveal & resolve',
    phases: ['resolve', 'income', 'gameOver'],
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
  const remaining = {};
  for (const card of state.deck) remaining[card] = (remaining[card] || 0) + 1;
  const current = stageFor(state.phase);
  const shown = STAGES.find((s) => s.id === current);

  return el('aside', { class: 'sequence' }, [
    el('div', { class: 'deck-count' }, [
      el('strong', {}, `${state.deck.length}`),
      el('span', {}, ` / ${state.deckStart} cards remain`),
    ]),
    el('div', { class: 'deck-breakdown' },
      Object.entries(CARD_LABEL)
        .filter(([id]) => remaining[id])
        .map(([id, label]) => el('span', { class: `deck-tag tag-${id}` }, `${label}: ${remaining[id]}`))
        .concat(state.deck.length ? [] : [el('span', { class: 'deck-tag' }, 'the deck is spent')])),

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
