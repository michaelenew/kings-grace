// Turning a decision request into something an agent can read, and its answer
// back into something the engine can use.
//
// The heuristic bots in ai.js cannot play this game well any more and are not
// meant to. Gold is the currency of table talk, table talk is where the game is
// won, and a scoring function cannot bargain. What a bot *is* good for is fast
// regression: a thousand games in a second, checking nothing crashes and no
// seat has an edge. For balance, put agents in the seats.

import { BAND_LABEL, CARD_LABEL, CROWN, ORDER_LABEL, TITLE_BY_ID, bandOf, cardText } from './constants.js';

const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);

/** Everything a seat is entitled to know, as prose. */
export function boardBriefing(view) {
  const me = view.players.find((p) => p.id === view.me);
  const t = view.tuning;
  const lines = [];

  lines.push(`Round ${view.round}. ${view.deckCount} of ${view.deckStart} royal cards remain.`);
  lines.push(`The Crown defends with ${view.crownStrength} (${t.crownBase} + ${t.crownPerPlayer} per player + one per card left), plus any support sent to it.`);
  if (view.lastCard) lines.push(`Last decree: ${CARD_LABEL[view.lastCard]} — ${cardText(view.lastCard, t)}`);
  lines.push(`Unclaimed land: ${view.neutralPool}.`);
  lines.push('');

  lines.push('THE TABLE');
  for (const p of view.players) {
    const who = p.id === view.me ? 'YOU' : p.name;
    const titles = p.titles.length ? p.titles.map((x) => TITLE_BY_ID[x].name).join(', ') : 'no titles';
    const tok = p.turncoat ? `, ${p.turncoat} turncoat token(s)` : '';
    lines.push(`- ${who}: fealty ${fmt(p.fealty)} (${BAND_LABEL[bandOf(p.fealty)]}), ${p.lands} land, ${p.gold} gold, ${titles}${tok}`);
  }
  lines.push('');

  const known = Object.entries(view.commitments).filter(([id]) => id !== view.me);
  if (known.length) {
    lines.push('WHAT YOU KNOW OF THEIR SEALED ORDERS');
    for (const [id, c] of known) {
      const name = view.players.find((p) => p.id === id)?.name ?? id;
      lines.push(`- ${name}: ${ORDER_LABEL[c.order]}${c.target ? ` → ${c.target === CROWN ? 'the Crown' : view.players.find((p) => p.id === c.target)?.name}` : ''}${c.gold ? ` with ${c.gold} gold` : ''}${c.peeked ? ' (as of when you looked)' : ''}`);
    }
    lines.push('');
  }
  if (view.knownTopCard) lines.push(`You have seen the next royal card: ${CARD_LABEL[view.knownTopCard]}.`, '');

  const pacts = Object.entries(view.pacts || {});
  if (pacts.length) {
    lines.push('WHAT WAS SAID THIS ROUND (nobody is bound by any of it)');
    for (const [who, pact] of pacts) {
      const name = view.players.find((p) => p.id === who)?.name ?? who;
      lines.push(`- ${name} said they would ${pact.kind}, to ${view.players.find((p) => p.id === pact.with)?.name}`);
    }
    lines.push('');
  }

  lines.push(`You win by holding the highest fealty when the deck runs out, or by being the largest contributor to a successful attack on the Crown. You are ${me.name}.`);
  return lines.join('\n');
}

/** The question being asked, and the shape of a valid answer. */
export function requestBriefing(request, view) {
  const t = view.tuning;
  const others = view.players.filter((p) => p.id !== view.me);
  const names = others.map((p) => `${p.id} (${p.name})`).join(', ');
  switch (request.type) {
    case 'order':
      return [
        'Seal one order for this round.',
        `Legal right now: ${request.legal.join(', ')}.`,
        `Attack/Support carry 1 to ${t.commitCap ?? 'any'} gold. Appeal costs ${request.petitionCost}. Develop costs ${t.developCost}.`,
        'Attacking drops your own walls to 0 this round, which exposes your titles.',
        `Targets: ${names}, or "crown".`,
        'Answer: {"order":"attack|support|petition|develop|hold","target":"<id or crown or null>","gold":<number>}',
      ].join('\n');
    case 'proposeDeal':
      return [
        'You may put one bargain to the table, or pass.',
        'A deal is a list of transfers of gold, land, titles and turncoat tokens. Every house named must accept, then it all settles at once.',
        'You may also say what you intend to do — it is free and binds nobody.',
        `Houses: ${names}.`,
        'Answer either null to pass, or {"transfers":[{"from":"<id>","to":"<id>","goods":{"gold":0,"lands":0,"titles":[],"turncoat":0}}],"intent":{"kind":"joinCoup|attack|supportAttack|supportDefense|standDown","of":"<id>","subject":"<id or null>"}}',
      ].join('\n');
    case 'deal':
      return [
        'A bargain has been put to you. Accept and everything moves at once; refuse and nothing does.',
        JSON.stringify(request.deal.transfers),
        request.deal.intent ? `They say they will: ${request.deal.intent.kind}.` : 'They said nothing about their plans.',
        'Answer: {"accept":true|false}',
      ].join('\n');
    case 'levy':
      return `The levy: pay ${request.cost} gold or drop 1 fealty. Answer: "pay" or "fealty"`;
    case 'title':
      return `You have reached +${request.threshold}. Choose a title, kept forever unless taken in the field: ${request.available.join(', ')}. Answer: "<title id>"`;
    case 'spoils':
      return `You broke through. Take a land, or one of their titles (${request.titles.join(', ')}). Answer: {"kind":"land"} or {"kind":"title","title":"<id>"}`;
    case 'peekChoice':
      return 'As an outlaw you may look at one rival\'s sealed order, or at the next royal card. Answer: "order" or "card"';
    case 'peekTarget':
      return `Whose sealed order do you read? ${request.options.join(', ')}. Answer: "<player id>"`;
    case 'turncoat':
      return `You hold ${request.tokens} turncoat token(s). Spend one to change your sealed order? Answer: {"action":"change"} or {"action":"none"}`;
    default:
      return 'Answer null.';
  }
}

/** Strategy nudges, so a run can put named approaches against each other. */
export const DOCTRINE_BRIEFS = {
  climber: 'You mean to inherit. Climb the fealty track, collect titles, and make yourself expensive to attack. Watch for the coup that would undo it.',
  granary: 'You mean to grow. Take land, keep your head down in the neutral band, and stay rich enough that everyone needs your gold.',
  shadow: 'You mean to work from the dark. Dive to outlaw, use what you see, and sell what you see. Cash out with a pardon if the clock beats you.',
  raider: 'You mean to take. Watch for houses whose armies are in the field and strip their land and titles. Standing is a cost of doing business.',
  bulwark: 'You mean to be the last one standing. Defend the throne, punish traitors, and be the obvious heir when the deck runs out.',
  opportunist: 'You have no fixed plan. Read the table each round and take whatever is going cheap.',
};

export const HOUSE_RULES = `You are playing The King's Graces, a game of medieval court politics.

Two roads to the throne: hold the highest fealty when the royal deck runs out, or
be the largest single contributor to a successful attack on the Crown.

Things that catch people out:
- Standing settles before the swords. An appeal or pardon this round changes your
  band before combat is worked out.
- Attacking drops your OWN walls to zero, so your titles can be taken.
- Support aimed at someone attacking the Crown counts toward THEIR contribution.
  Buying somebody's coup crowns them, not you.
- No order carries more than the commitment cap, so no purse alone outreaches the
  Crown. A usurpation has to be a conspiracy.
- Gold, land, titles and turncoat tokens move only through deals, and a deal
  settles only when everyone named accepts. Anything anyone promises to DO is
  words. Words bind nobody, including you.`;

/** Coerce whatever came back into something the engine will accept. */
export function parseDecision(text, request) {
  let value = text;
  if (typeof text === 'string') {
    const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      value = JSON.parse(trimmed);
    } catch {
      value = trimmed.replace(/^"|"$/g, '');
    }
  }
  if (request.type === 'levy') return value === 'pay' ? 'pay' : 'fealty';
  if (request.type === 'title') return typeof value === 'string' ? value : request.available[0];
  if (request.type === 'peekChoice') return value === 'card' ? 'card' : 'order';
  if (request.type === 'peekTarget') return typeof value === 'string' ? value : request.options[0];
  return value;
}
