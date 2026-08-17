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
  const crown = tuning.crownBase + tuning.crownPerPlayer * players;

  return el('aside', { class: 'reference' }, [
    el('h3', {}, 'Rules'),

    block('The round', [
      el('p', { class: 'ref-line dim' }, 'Royal card → sealed orders → whispers → reveal. Click any step in the turn tracker above for detail.'),
      el('p', { class: 'ref-line dim' }, 'Deals are not a step. Strike one at any time until the orders resolve.'),
    ]),

    block('Standing', [
      el('p', { class: 'ref-line dim' }, 'Fealty runs −3 to +3. Appeal to climb; refuse a levy, strike a favorite, or raise a hand against the Crown to fall.'),
      line(`${BAND_LABEL.favorite} (+2, +3)`, `Attacks gain +fealty against anyone lower — never against the Crown. A title at +2 and another at +3, once each. The grant may take a title somebody already holds, for ${tuning.titleClaimCost} gold.`),
      line(`${BAND_LABEL.neutral} (−1 to +1)`, `+${tuning.neutralIncome} gold every income step. Nobody is watching your fields.`),
      line(`${BAND_LABEL.outlaw} (−2, −3)`, 'Take a turncoat token as the round opens (one at a time; none while you still hold one). Taxed hardest.'),
    ]),

    block('Orders — one each round', [
      line('Attack', 'As much gold as you hold. Your own walls drop to 0.'),
      line('Support', 'As much gold as you hold, joining the target’s attack if they strike, otherwise their defense — or your own gate, to dig in.'),
      line('Appeal', `${tuning.petitionCost} gold for +1 fealty. As an outlaw it is a pardon: ${tuning.pardonCost} gold, straight to 0.`),
      line('Develop', `${tuning.developCost} gold for one land. Land pays ${tuning.landIncome} gold a round.`),
    ]),

    block('The tax', [
      el('p', { class: 'ref-line dim' }, `Favorites pay ${tuning.taxByBand.favorite}, neutrals ${tuning.taxByBand.neutral}, outlaws ${tuning.taxByBand.outlaw}. Pay what coin you have — anything still owed is taken in land, one field per ${tuning.taxLandValue} gold, and the Crown puts those fields straight back out to tenancy. It has no use for a field; it wants a tenant who can pay.`),
    ]),

    block('The levy', [
      el('p', { class: 'ref-line dim' }, `Send your host and your army marches for the Crown: no walls and no attack this round, so a land — or a title — can be taken off you. Refuse and drop ${tuning.levyRefusal} fealty. At +1 you can refuse and still be neutral; from 0 the same refusal makes you an outlaw.`),
    ]),

    block('Combat', [
      el('p', { class: 'ref-line dim' }, `Attack = gold + support + Marshal + punching-down bonus. Defense = walls ${tuning.walls} (0 if you attacked or answered the levy) + support + Warden + a fealty pledge. Attacker needs strictly more.`),
      el('p', { class: 'ref-line dim' }, `An appeal or pardon this round adds the gold it cost to your walls, and striking a house pledging fealty docks the attacker ${tuning.pledgeStrikePenalty} standing. A turncoat token in the attacker’s hand cracks the gate by ${tuning.turncoatWallBreak}.`),
      el('p', { class: 'ref-line dim' }, `Spoils: ${tuning.spoilsGold} gold plundered whatever happens, plus a land — or a title instead of the land, if their walls were down. Repelled, the attacker forfeits the same. A full purse is a reason to be attacked.`),
    ]),

    block('Winning', [
      line('Inherit', 'Highest fealty when the royal deck runs out. Ties: most land, then most gold.'),
      line('Usurp', `Attackers on the Crown pool their strength against ${crown} + cards remaining. The largest single contributor takes the throne; equal largest is civil war.`),
    ]),

    block('Titles', TITLES.map((t) => line(t.name, t.text))),

    block('Deals', [
      el('p', { class: 'ref-line dim' }, 'Set what you offer and what you take on your side of the table. Everything offered has to match everything taken across all houses. It settles the moment every house involved has accepted — and touching any term withdraws every acceptance.'),
      el('p', { class: 'ref-line dim' }, 'Gold, land, titles and turncoat tokens move. Nothing anybody says they will *do* is part of it.'),
    ]),

    block('Whispers', [
      el('p', { class: 'ref-line dim' }, 'Two beats. Espionage: a turncoat token lets you read a rival’s sealed order or the next royal card — both at −3. Looking does not spend it. No token, no peek.'),
      el('p', { class: 'ref-line dim' }, 'Duplicity: spend a token to change your own sealed order. The table is open between the two, so a token — its eyes and its change — can be sold to whoever wants it.'),
    ]),

    block('Your word', [
      el('p', { class: 'ref-line dim' }, 'You may give another house your word at any time. It is free, it binds nobody, and no bargain waits on it — but it is given in open court, and when the orders turn over everyone sees whether it held.'),
      el('p', { class: 'ref-line dim' }, 'Keep it and they think better of you. Break it, or put a sword in a house you have just bargained with, and so does everybody else. A house that thinks little of you wants a far better bargain before it signs, and past a point will not deal with you at all. Betrayal is often worth it; it is never free.'),
    ]),
  ]);
}

export { TITLE_BY_ID };
