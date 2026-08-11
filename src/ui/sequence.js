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
    detail: 'Turn the top card of the royal deck and resolve it at once — a tax, a levy, a favour granted, or a scapegoat purged. Everything after this happens knowing what the Crown just did.',
  },
  {
    id: 'deals',
    label: 'Deals',
    phases: ['deals'],
    detail: 'Strike bargains. Gold, land, titles and turncoat tokens change hands the moment every house named in a deal accepts. Anything anybody promises to *do* is not part of the deal and binds nobody.',
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
    detail: 'Outlaws look at what they should not: a rival’s sealed order, or the next royal card, or at −3 both. Each takes a turncoat token, and anyone holding one may spend it to change their own sealed order — including a token they bought from somebody else.',
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
 * @param {string|null} hovered stage id the pointer is over
 * @param {(id: string|null) => void} onHover
 */
export function sequenceCard(state, hovered, onHover) {
  const remaining = {};
  for (const card of state.deck) remaining[card] = (remaining[card] || 0) + 1;
  const current = stageFor(state.phase);
  const shown = STAGES.find((s) => s.id === (hovered || current));

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
    el('ol', { class: 'stages' }, STAGES.map((stage, i) => el('li', {
      class: `stage-step${stage.id === current ? ' now' : ''}${stage.id === hovered ? ' hovered' : ''}`,
      onmouseenter: () => onHover(stage.id),
      onmouseleave: () => onHover(null),
      onfocus: () => onHover(stage.id),
      onblur: () => onHover(null),
      tabindex: 0,
    }, [
      el('span', { class: 'stage-num' }, String(i + 1)),
      el('span', { class: 'stage-label' }, stage.label),
    ]))),

    el('div', { class: 'stage-detail' }, [
      el('h5', {}, shown ? shown.label : ''),
      el('p', {}, shown ? shown.detail : ''),
    ]),
  ]);
}
