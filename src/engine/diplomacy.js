// Table talk (§3 standing rule). Gold changes hands for real; promises do not
// bind. A bot accepts a bargain when the bribe genuinely makes the pledged
// order its best line — and may still walk away from it at commit time,
// because a paid promise is discounted by treachery once the gold is banked.

import { CROWN, ORDER } from './constants.js';
import { legalOrders, playerById, viewFor } from './state.js';

export const PARLEY_KINDS = [
  { id: 'joinCoup', label: 'March on the Crown with me this round' },
  { id: 'attack', label: 'Attack someone for me', needsSubject: true },
  { id: 'supportAttack', label: 'Reinforce my attack' },
  { id: 'supportDefense', label: 'Reinforce my defense' },
  { id: 'standDown', label: 'Leave me alone this round' },
];

const REFUSALS = {
  loyalist: 'The King has my sword. Keep your coin.',
  merchant: 'The ledger does not balance. No.',
  schemer: 'A pretty offer. Not a persuasive one.',
  wolf: 'I hunt where I please.',
};

const ACCEPTANCES = {
  loyalist: 'Reluctantly — but a debt is a debt.',
  merchant: 'Paid in full. Consider it arranged.',
  schemer: 'How interesting. Very well.',
  wolf: 'Your gold, my teeth. Agreed.',
};

function matchesPledge(candidate, pact, meId) {
  switch (pact.kind) {
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

/**
 * Put an offer to a bot. Returns {accepted, line}. On acceptance the gold moves
 * immediately and the pact is recorded for this round only.
 *
 * @param {import('./game.js').Game} game
 * @param {{from:string,to:string,kind:string,subject?:string,gold:number,expected?:number}} offer
 */
export function proposeParley(game, offer) {
  const state = game.state;
  const controller = game.controllers[offer.to];
  const from = playerById(state, offer.from);
  const to = playerById(state, offer.to);
  const gold = Math.max(0, Math.floor(offer.gold || 0));
  if (!from || !to || from === to) return { accepted: false, line: 'There is no one to talk to.' };
  if (!controller || controller.kind !== 'ai' || !controller.rankOrders) {
    return { accepted: false, line: 'That seat answers for itself.' };
  }
  if (gold > from.gold) return { accepted: false, line: 'You do not have that gold to give.' };

  const pact = {
    kind: offer.kind,
    subject: offer.subject || null,
    with: offer.from,
    paid: gold + (state.goodwill[`${offer.from}>${offer.to}`] || 0) * 0.35,
    expected: offer.expected ?? (offer.kind === 'joinCoup' ? Math.max(1, from.gold) : 2),
    evaluating: true,
  };

  const view = viewFor(state, offer.to);
  const legal = legalOrders(state, to);
  const withPact = { ...view, pacts: { ...view.pacts, [offer.to]: pact } };
  const ranked = controller.rankOrders(legal, withPact);
  const top = ranked[0];
  const accepted = !!top && matchesPledge(top, pact, offer.to);

  const flavour = controller.personality || 'schemer';
  if (!accepted) {
    return { accepted: false, line: REFUSALS[flavour] || REFUSALS.schemer };
  }

  if (gold > 0) game.gift(offer.from, offer.to, gold);
  state.pacts[offer.to] = { ...pact, evaluating: false };
  game.emit('parley', `${to.name} agrees: ${describePact(state, state.pacts[offer.to], to)}`);
  return { accepted: true, line: ACCEPTANCES[flavour] || ACCEPTANCES.schemer };
}

export function describePact(state, pact, who) {
  const name = (id) => (id === CROWN ? 'the Crown' : playerById(state, id)?.name ?? id);
  switch (pact.kind) {
    case 'joinCoup': return `${who.name} will march on the Crown alongside ${name(pact.with)}.`;
    case 'attack': return `${who.name} will attack ${name(pact.subject)}.`;
    case 'supportAttack': return `${who.name} will reinforce ${name(pact.with)}'s attack.`;
    case 'supportDefense': return `${who.name} will reinforce ${name(pact.with)}'s defense.`;
    case 'standDown': return `${who.name} will not raise a hand against ${name(pact.with)}.`;
    default: return 'an understanding is reached.';
  }
}
