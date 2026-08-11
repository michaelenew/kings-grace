// What a house says it is *going to do*, as opposed to what it hands over.
//
// Goods move through deals.js. This module is only the vocabulary of intent and
// how a bot weighs one: a stated intention is table talk, it binds nobody, and
// the bots discount it by their own treachery once the goods are banked.

import { CROWN, ORDER } from './constants.js';
import { playerById } from './state.js';

export const INTENTS = [
  { id: 'joinCoup', label: 'I will march on the Crown this round' },
  { id: 'attack', label: 'I will attack someone', needsSubject: true },
  { id: 'supportAttack', label: 'I will reinforce your attack' },
  { id: 'supportDefense', label: 'I will reinforce your defense' },
  { id: 'standDown', label: 'I will leave you alone this round' },
];

export const INTENT_BY_ID = Object.fromEntries(INTENTS.map((i) => [i.id, i]));

/** Does this order keep the promise? Used by bots weighing their own word. */
export function matchesIntent(candidate, pact) {
  switch (pact?.kind) {
    case 'joinCoup':
      return candidate.order === ORDER.ATTACK && candidate.target === CROWN;
    case 'attack':
      return candidate.order === ORDER.ATTACK && candidate.target === pact.subject;
    case 'supportAttack':
    case 'supportDefense':
      return candidate.order === ORDER.SUPPORT && candidate.target === pact.with;
    case 'standDown':
      return !(candidate.order === ORDER.ATTACK && candidate.target === pact.with);
    default:
      return false;
  }
}

export function describeIntent(state, intent) {
  const name = (id) => (id === CROWN ? 'the Crown' : playerById(state, id)?.name ?? id);
  switch (intent?.kind) {
    case 'joinCoup': return 'to march on the Crown alongside them';
    case 'attack': return `to attack ${name(intent.subject)}`;
    case 'supportAttack': return 'to reinforce their attack';
    case 'supportDefense': return 'to reinforce their defense';
    case 'standDown': return 'to leave them be this round';
    default: return 'to come to an understanding';
  }
}
