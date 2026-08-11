// The static rules reference. Always on screen, never a modal you have to go
// looking for. Reads the tuning actually in play so it cannot drift from the
// game being played.

import { BAND_LABEL, TITLES, TITLE_BY_ID } from '../engine/constants.js';
import { el } from './dom.js';

function block(title, children) {
  return el('section', { class: 'ref-block' }, [el('h4', {}, title), ...children]);
}

function line(term, text) {
  return el('p', { class: 'ref-line' }, [el('b', {}, term), ' ', text]);
}

export function referenceCard(tuning, players) {
  const cap = tuning.commitCap;
  const crown = tuning.crownBase + tuning.crownPerPlayer * players;

  return el('aside', { class: 'reference' }, [
    el('h3', {}, 'Rules'),

    block('The round', [
      el('p', { class: 'ref-line dim' }, 'Royal card → deals → sealed orders → whispers → reveal. For detail, mouse over the turn tracker above.'),
    ]),

    block('Standing', [
      el('p', { class: 'ref-line dim' }, 'Fealty runs −3 to +3. Appeal to climb; refuse a levy, strike a favorite, or raise a hand against the Crown to fall.'),
      line(`${BAND_LABEL.favorite} (+2, +3)`, 'Attacks gain +fealty against anyone lower — never against the Crown. A title at +2 and another at +3, once each, kept forever.'),
      line(`${BAND_LABEL.neutral} (−1 to +1)`, `+${tuning.neutralIncome} gold every income step. Nobody is watching your fields.`),
      line(`${BAND_LABEL.outlaw} (−2, −3)`, 'Peek before the reveal, and take a turncoat token — spend it to change your sealed order, or sell it. Taxed hardest.'),
    ]),

    block('Orders — one each round', [
      line('Attack', `1–${cap ?? '∞'} gold. Your own walls drop to 0.`),
      line('Support', `1–${cap ?? '∞'} gold, joining the target's attack if they strike, otherwise their defense.`),
      line('Appeal', `${tuning.petitionCost} gold for +1 fealty. As an outlaw it is a pardon: ${tuning.pardonCost} gold, straight to 0.`),
      line('Develop', `${tuning.developCost} gold for one land. Land pays ${tuning.landIncome} gold a round.`),
    ]),

    block('Combat', [
      el('p', { class: 'ref-line dim' }, `Attack = gold + support + Marshal + punching-down bonus. Defense = walls ${tuning.walls} (0 if you also attacked) + support + Warden. Attacker needs strictly more. Spoils: a land, or a title if their walls were down.`),
    ]),

    block('Winning', [
      line('Inherit', 'Highest fealty when the royal deck runs out. Ties: most land, then most gold.'),
      line('Usurp', `Attackers on the Crown pool their strength against ${crown} + cards remaining. The largest single contributor takes the throne; equal largest is civil war.`),
    ]),

    block('Titles', TITLES.map((t) => line(t.name, t.text))),

    block('Table talk', [
      el('p', { class: 'ref-line dim' }, 'Strike a deal at any time, with anyone, for any reason. Gold, land, titles and turncoat tokens change hands the moment everyone accepts. What anybody says they will *do* with them is words, and words bind nobody.'),
    ]),
  ]);
}

export { TITLE_BY_ID };
