// The King's Graces — rules engine.
//
// The engine drives the whole round loop and asks each seat's *controller* for
// decisions through an async `decide(request, view)` interface. The UI plugs a
// human controller in (resolving a promise from a form); tests plug scripted
// controllers in; the AI module plugs a bot in. Nothing about the rules knows
// what a DOM is.

import {
  BAND, CARD, CARD_LABEL, CROWN, ORDER, ORDER_LABEL,
  TITLE_BY_ID, bandOf, clampFealty,
} from './constants.js';
import {
  commitCeiling, createGame, crownStrength, hasTitle, legalOrders, petitionCostFor,
  claimableTitles, playerById, unclaimedTitles, viewFor,
} from './state.js';
import { INTENT_BY_ID, describeIntent } from './diplomacy.js';
import {
  decayTrust, makePromise, settleBargain, settleDeeds, settlePromises,
} from './trust.js';

const seatOrder = (state) => state.players.slice().sort((a, b) => a.seat - b.seat);

/**
 * Precedence at court, used wherever two houses want the same thing at the same
 * moment: the last land in the pool, a title two of them just qualified for, or
 * the order two attacks land on one defender.
 *
 * The Herald first, because that is what the Herald is for. Then standing, then
 * land, then wealth — the court defers to whoever the court thinks is
 * important, which is the same order the throne itself is inherited in. Only
 * when houses are indistinguishable on all three does it come down to a coin,
 * and the coin is drawn once per house rather than inside the comparison, so
 * the sort stays consistent.
 */
function precedence(state, players) {
  const coin = new Map(players.map((p) => [p.id, state.rng()]));
  return players.slice().sort((a, b) => {
    const ah = hasTitle(a, 'herald') ? 1 : 0;
    const bh = hasTitle(b, 'herald') ? 1 : 0;
    if (ah !== bh) return bh - ah;
    if (a.fealty !== b.fealty) return b.fealty - a.fealty;
    if (a.lands !== b.lands) return b.lands - a.lands;
    if (a.gold !== b.gold) return b.gold - a.gold;
    return coin.get(a.id) - coin.get(b.id);
  });
}

export class Game {
  /**
   * @param {object} opts see createGame, plus:
   *   controllers: {pid: {decide(request, view): Promise<any>}}
   */
  constructor(opts = {}) {
    this.state = opts.state || createGame(opts);
    this.controllers = opts.controllers || {};
    this.listeners = new Set();
    // Optional beat between phases so a watching human can read the board.
    this.pause = opts.pause || (async () => {});
  }

  // ---------------------------------------------------------------- plumbing

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn(this.state);
  }

  emit(kind, text, data = {}) {
    this.state.log.push({ round: this.state.round, kind, text, ...data });
    this.notify();
  }

  setPhase(phase) {
    this.state.phase = phase;
    this.notify();
  }

  ask(pid, request) {
    const controller = this.controllers[pid];
    if (!controller) throw new Error(`no controller for ${pid}`);
    return Promise.resolve(controller.decide(request, viewFor(this.state, pid)));
  }

  player(id) {
    return playerById(this.state, id);
  }

  nameOf(id) {
    if (id === CROWN) return 'the Crown';
    return this.player(id)?.name ?? id;
  }

  // ------------------------------------------------------------- main loop

  async run() {
    const s = this.state;
    if (s.round === 0) {
      s.round = 1;
      this.emit('setup', 'The court convenes. Four houses, one throne.');
    }
    while (!s.winner) {
      await this.crownFlip();
      if (s.winner) break;
      this.grantTurncoatTokens();
      await this.pause('crown');
      await this.commitPhase();
      await this.peekPhase();
      await this.resolvePhase();
      if (s.winner) break;
      this.incomeStep();
      if (s.deck.length === 0) {
        this.inherit();
        break;
      }
      await this.pause('roundEnd');
      decayTrust(s);
      s.round += 1;
      this.notify();
    }
    this.setPhase('gameOver');
    return s.winner;
  }

  // ----------------------------------------------------- 1. crown flip (§6)

  async crownFlip() {
    const s = this.state;
    this.setPhase('crownFlip');
    // A host called up last round is home again before this one is called.
    for (const p of s.players) p.noArmy = false;
    const card = s.deck.shift();
    s.discard.push(card);
    s.lastCard = card;
    this.emit('crown', `Round ${s.round}: the Crown reveals ${CARD_LABEL[card]}. Crown strength is now ${crownStrength(s)}.`, { card });

    if (card === CARD.TAX) this.resolveTax();
    else if (card === CARD.LEVY) await this.resolveLevy();
    else if (card === CARD.FAVOR) this.resolveFavor();

    this.notify();
  }

  /**
   * The Crown takes its due in coin, and in land from anyone who cannot find
   * the coin. Seized fields go back to the *unclaimed pool*, not out of play:
   * the Crown has no use for a field, it wants a tenant who can pay. That is
   * the only thing in the game that puts land back on the board, and it is what
   * keeps Develop alive past the midpoint.
   */
  resolveTax() {
    const s = this.state;
    const perLand = s.tuning.taxLandValue || 0;
    for (const p of seatOrder(s)) {
      let due = s.tuning.taxByBand[bandOf(p.fealty)];
      if (hasTitle(p, 'chancellor')) due = Math.max(0, due - s.tuning.chancellorRelief);
      const paid = Math.min(due, p.gold);
      p.gold -= paid;
      s.crownGold += paid;
      let debt = due - paid;
      let seized = 0;
      while (perLand > 0 && debt > 0 && p.lands > 0) {
        p.lands -= 1;
        s.neutralPool += 1;
        debt -= perLand;
        seized += 1;
      }
      const owed = paid < due ? ` (owed ${due})` : '';
      if (seized) {
        this.emit('tax', `${p.name} pays ${paid} gold in tax${owed} and forfeits `
          + `${seized} land${seized === 1 ? '' : 's'} to the Crown, which puts ${seized === 1 ? 'it' : 'them'} back out to tenancy.`);
      } else {
        const short = paid < due ? `${owed}, and has nothing left to seize` : '';
        this.emit('tax', `${p.name} pays ${paid} gold in tax${short}.`);
      }
    }
  }

  /**
   * The levy calls up your host. Serve and your army marches under the royal
   * banner — you have no walls and no attack this round, and a house with no
   * walls can be stripped of a title, not merely a land. Refuse and the court
   * remembers it.
   *
   * This resolves at the royal card, before orders are sealed, so who is
   * defenceless is public knowledge when everyone chooses their target. That is
   * deliberate: the window has to be visible to be worth bargaining over.
   */
  async resolveLevy() {
    const s = this.state;
    const drop = s.tuning.levyRefusal;
    for (const p of seatOrder(s)) {
      // Optional rule: the levy falls on the outlaws as a seizure of land
      // rather than a call for troops. They are not being asked, they are being
      // made an example of — and they keep their army, which makes a levy round
      // the outlaws' hour.
      if (s.options.levyTargetsOutlaws && bandOf(p.fealty) === BAND.OUTLAW) {
        const due = p.fealty <= -3 ? 2 : 1;
        const taken = Math.min(due, p.lands);
        p.lands -= taken;
        s.crownLands += taken;
        const short = taken < due ? ` (owed ${due}, had only ${taken})` : '';
        this.emit('levy', taken
          ? `Levy: the Crown seizes ${taken} land${taken === 1 ? '' : 's'} from ${p.name}${short}.`
          : `Levy: ${p.name} has no land left for the Crown to seize.`);
        continue;
      }
      let choice = await this.ask(p.id, {
        type: 'levy',
        refusalCost: drop,
        text: `Send your host — no walls and no attack this round — or refuse and drop ${drop} fealty.`,
      });
      if (choice !== 'serve' && choice !== 'refuse') choice = 'refuse';
      if (choice === 'serve') {
        p.noArmy = true;
        this.emit('levy', `${p.name} answers the levy. Their host marches for the Crown — no walls, no attack this round.`);
      } else {
        const before = p.fealty;
        p.fealty = clampFealty(p.fealty - drop);
        const note = p.fealty === before ? ' (already at the bottom of the track)' : '';
        this.emit('levy', `${p.name} refuses the levy: ${fmt(p.fealty)}${note}.`);
      }
    }
  }

  /** Favor pays the loyal: gold to every favorite, and land at the top. */
  resolveFavor() {
    const s = this.state;
    const t = s.tuning;
    const favorites = seatOrder(s).filter((p) => bandOf(p.fealty) === BAND.FAVORITE);
    if (!favorites.length) {
      this.emit('crown-card', 'Favor: the Crown looks for a friend and finds none.');
      return;
    }
    for (const p of favorites) {
      p.gold += t.favorGold;
      let note = '';
      if (p.fealty >= t.favorLandAt) {
        if (s.neutralPool > 0) {
          s.neutralPool -= 1;
          p.lands += 1;
          note = ' and a land';
        } else {
          note = ' (no land left to grant)';
        }
      }
      this.emit('crown-card', `Favor: ${p.name} is granted ${t.favorGold} gold${note}.`);
    }
  }

  // -------------------------------------------------------- 2. commit (§3)

  async commitPhase() {
    const s = this.state;
    this.setPhase('commit');
    await this.inviteBotDeals();
    await this.inviteBotAcceptance();
    s.commitments = {};
    s.knowledge = {};
    s.revealed = false;
    for (const p of s.players) s.knowledge[p.id] = { orders: {}, topCard: null };

    for (const p of seatOrder(s)) {
      const answer = await this.ask(p.id, {
        type: 'order',
        legal: legalOrders(s, p),
        petitionCost: petitionCostFor(s, p),
      });
      this.commit(p.id, answer);
    }
    this.emit('commit', 'All orders are sealed.');
  }

  /**
   * Outlaws take their token as the round opens, not at the whispers step, so
   * they have the whole round to bargain with it.
   */
  grantTurncoatTokens() {
    const s = this.state;
    for (const p of seatOrder(s)) {
      if (bandOf(p.fealty) !== BAND.OUTLAW) continue;
      if (p.turncoat >= s.tuning.turncoatMax) continue;
      p.turncoat += 1;
      this.emit('turncoat', `${p.name} takes a turncoat token.`);
    }
  }

  /**
   * Deals are not a step. They are open from the moment the royal card turns
   * until orders start resolving, which is the whole point of them: a bargain
   * struck after you have seen somebody's face is worth more than one struck to
   * a schedule. `dealsOpen` is what the UI and the bots both read.
   */
  get dealsOpen() {
    return !['resolve', 'income', 'gameOver', 'setup'].includes(this.state.phase);
  }

  /** Ask every bot whether it wants to put something to the table right now. */
  async inviteBotDeals() {
    const s = this.state;
    if (!this.dealsOpen) return;
    for (const p of s.rng.shuffle(s.players.slice())) {
      const controller = this.controllers[p.id];
      if (!controller || controller.kind === 'human') continue;
      const deal = await this.ask(p.id, {
        type: 'proposeDeal',
        others: s.players.filter((x) => x.id !== p.id).map((x) => x.id),
      });
      if (deal?.promise?.to && deal.promise.kind) {
        this.declarePromise(p.id, deal.promise);
      }
      if (!deal || !deal.transfers?.length) continue;
      await this.putDeal({ ...deal, proposer: p.id });
    }
  }

  // ------------------------------------------------------ the open deal

  /** Set a house's terms. Any change clears every acceptance (§3). */
  async setDealTerms(pid, terms) {
    const { setTerms } = await import('./dealtable.js');
    setTerms(this.state, pid, terms);
    this.emit('deal', `${this.nameOf(pid)} changes their terms; every acceptance is withdrawn.`, { quiet: true });
    return this.state.dealTable;
  }

  async withdrawFromDeal(pid) {
    const { withdraw } = await import('./dealtable.js');
    withdraw(this.state, pid);
    this.notify();
    return this.state.dealTable;
  }

  /**
   * Accept the terms as they stand. When everyone involved has accepted and the
   * pot balances, it settles at once.
   */
  async acceptDeal(pid) {
    const dt = await import('./dealtable.js');
    if (!this.dealsOpen) return { settled: false, reason: 'The orders are already resolving.' };
    dt.acceptTerms(this.state, pid);
    const problem = dt.dealProblem(this.state, this.state.dealTable);
    if (problem) { this.notify(); return { settled: false, reason: problem }; }
    if (!dt.everyoneAccepted(this.state.dealTable)) {
      const waiting = dt.dealParticipants(this.state.dealTable)
        .filter((x) => !this.state.dealTable.accepted.includes(x))
        .map((x) => this.nameOf(x));
      this.notify();
      return { settled: false, waiting };
    }
    // Read the balance before the goods move, then move them, then let the
    // ledger record who came off well out of it.
    const table = this.state.dealTable;
    const worth = Object.fromEntries(dt.dealParticipants(table)
      .map((x) => [x, dt.balanceFor(this.state, table, x)]));
    const moved = dt.settleTable(this);
    settleBargain(this.state, { offers: table.offers, takes: table.takes }, (x) => worth[x] ?? 0);
    this.emit('deal', `A bargain settles — ${moved.join('; ')}.`);
    return { settled: true };
  }

  /**
   * Declare an undertaking to another house. Free, binding on nobody, and no
   * bargain ever waits on it — the goods on the table settle regardless. What
   * it does is put your word on the record, so that keeping it or breaking it
   * is something the whole court can see when the orders turn over.
   */
  declarePromise(pid, { to, kind, subject = null }) {
    if (!this.dealsOpen) return { ok: false, reason: 'The orders are already resolving.' };
    if (pid === to) return { ok: false, reason: 'You need somebody to say it to.' };
    if (!INTENT_BY_ID[kind]) return { ok: false, reason: 'No such undertaking.' };
    makePromise(this.state, pid, { to, kind, subject });
    this.emit('promise', `${this.nameOf(pid)} gives ${this.nameOf(to)} their word ${describeIntent(this.state, { kind, subject })}.`);
    return { ok: true };
  }

  /** Bots look at the open pot and accept if it pays them. */
  async inviteBotAcceptance() {
    const dt = await import('./dealtable.js');
    const table = this.state.dealTable;
    if (dt.dealProblem(this.state, table)) return;
    for (const pid of dt.dealParticipants(table)) {
      const controller = this.controllers[pid];
      if (!controller || controller.kind === 'human') continue;
      if (table.accepted.includes(pid)) continue;
      const answer = await this.ask(pid, {
        type: 'dealTable',
        balance: dt.balanceFor(this.state, table, pid),
        table,
      });
      if (answer?.accept) await this.acceptDeal(pid);
    }
  }

  /** Put a deal to the table. Goods only — nothing anybody says is part of it. */
  async putDeal(deal) {
    if (!this.dealsOpen) return { accepted: false, reason: 'The orders are already resolving.' };
    const { proposeDeal } = await import('./deals.js');
    return proposeDeal(this, deal);
  }

  /** Validate + escrow an order. Committed gold is spent immediately (§3). */
  commit(pid, answer) {
    const s = this.state;
    const p = this.player(pid);
    const legal = legalOrders(s, p);
    let { order, target = null, gold = 0 } = answer || {};
    if (!legal.includes(order)) order = legal[0];

    if (order === ORDER.ATTACK || order === ORDER.SUPPORT) {
      const targets = s.players.filter((x) => x.id !== pid).map((x) => x.id).concat(CROWN);
      if (!targets.includes(target)) target = targets[0];
      gold = Math.max(1, Math.min(Math.floor(gold) || 1, commitCeiling(s, p)));
    } else if (order === ORDER.PETITION) {
      gold = petitionCostFor(s, p);
      target = null;
    } else if (order === ORDER.DEVELOP) {
      gold = s.tuning.developCost;
      target = null;
    } else if (order === ORDER.RANSOM) {
      const targets = s.players.filter((x) => x.id !== pid).map((x) => x.id).concat(CROWN);
      if (!targets.includes(target)) target = targets[0];
      gold = 0;
    } else {
      gold = 0;
      target = null;
    }

    if (gold > p.gold) throw new Error(`${p.name} cannot commit ${gold} gold`);
    p.gold -= gold;
    p.escrow = gold;
    s.commitments[pid] = { order, target, gold };
    this.notify();
    return s.commitments[pid];
  }

  /** Refund an escrowed order so it can be replaced (turncoat, §2). */
  recommit(pid, answer) {
    const p = this.player(pid);
    p.gold += p.escrow;
    p.escrow = 0;
    delete this.state.commitments[pid];
    return this.commit(pid, answer);
  }

  // ---------------------------------------- 2b. peeks & turncoat rights (§2)

  async peekPhase() {
    const s = this.state;
    this.setPhase('peek');
    await this.inviteBotDeals();
    await this.inviteBotAcceptance();
    for (const p of s.players) if (!s.knowledge[p.id]) s.knowledge[p.id] = { orders: {}, topCard: null };

    for (const p of seatOrder(s)) {
      const band = bandOf(p.fealty);
      const isOutlaw = band === BAND.OUTLAW;

      if (isOutlaw) {
        const both = p.fealty <= -3;
        if (both) {
          await this.doPeek(p, 'order');
          await this.doPeek(p, 'card');
        } else {
          const pick = await this.ask(p.id, {
            type: 'peekChoice',
            options: ['order', 'card'],
            text: 'Outlaw at −2: peek at one player\'s order, or at the top crown card.',
          });
          await this.doPeek(p, pick === 'card' ? 'card' : 'order');
        }
      }

      if (hasTitle(p, 'spymaster')) {
        await this.doPeek(p, 'order', true);
      }
    }

    // Tokens are spent after every outlaw has looked. A token is a thing you
    // hold, so it can be traded away in a deal before it is ever spent.
    for (const p of seatOrder(s)) {
      while (p.turncoat > 0) {
        const answer = await this.ask(p.id, {
          type: 'turncoat',
          tokens: p.turncoat,
          text: 'Spend a turncoat token to change your sealed order?',
        });
        if (answer?.action !== 'change') break;
        p.turncoat -= 1;
        const next = await this.ask(p.id, {
          type: 'order',
          legal: legalOrders(s, { ...p, gold: p.gold + p.escrow }),
          petitionCost: petitionCostFor(s, p),
          reason: 'turncoat',
        });
        this.recommit(p.id, next);
        this.emit('turncoat', `${p.name} spends a turncoat token and quietly changes their order.`, { secret: true, pid: p.id });
      }
    }
  }

  async doPeek(peeker, kind, viaSpymaster = false) {
    const s = this.state;
    if (kind === 'card') {
      const top = s.deck[0] ?? null;
      s.knowledge[peeker.id].topCard = top;
      this.emit('peek', `${peeker.name} looks at the top of the crown deck.`, { secret: true, pid: peeker.id });
      return;
    }
    const others = s.players.filter((x) => x.id !== peeker.id).map((x) => x.id);
    const answer = await this.ask(peeker.id, {
      type: 'peekTarget',
      options: others,
      viaSpymaster,
      text: viaSpymaster ? 'Spymaster: peek at one player\'s committed order.' : 'Peek at one player\'s committed order.',
    });
    const target = others.includes(answer) ? answer : others[0];
    s.knowledge[peeker.id].orders[target] = { ...s.commitments[target] };
    this.emit('peek', `${peeker.name} reads ${this.nameOf(target)}'s sealed order${viaSpymaster ? ' (Spymaster)' : ''}.`, { secret: true, pid: peeker.id });
  }

  // --------------------------------------------------- 3. reveal & resolve

  async resolvePhase() {
    const s = this.state;
    this.setPhase('resolve');
    s.revealed = true;
    // A structured record of what happened, in the order it happened, so the
    // client can show it rather than dumping twenty lines of text at once.
    s.beats = [];
    for (const p of seatOrder(s)) {
      const c = s.commitments[p.id];
      this.emit('reveal', `${p.name}: ${describeOrder(c, (id) => this.nameOf(id), s.tuning.pardonCost)}.`);
    }

    // Bands are read at resolution time (§2). Petitions move fealty first, so
    // everything after step 3.1 uses the recalculated bands.
    const bandsAtStart = Object.fromEntries(s.players.map((p) => [p.id, bandOf(p.fealty)]));

    await this.step_petitions(bandsAtStart);
    if (s.winner) return;

    const bands = Object.fromEntries(s.players.map((p) => [p.id, bandOf(p.fealty)]));
    const fealtyNow = Object.fromEntries(s.players.map((p) => [p.id, p.fealty]));

    // Order matters and is worth stating plainly: standing moves first, so a
    // pardon lands before the swords do; then land is settled; then support is
    // counted; then the attacks resolve against it.
    // Words and deeds are scored the moment the orders are face up, before any
    // of them resolve: what the court thinks of you is settled by what you
    // committed to, not by whether it happened to work.
    settlePromises(s, (kind, text) => this.emit(kind, text));
    settleDeeds(s, (kind, text) => this.emit(kind, text));

    this.step_develop();
    const support = this.tallySupport();
    await this.step_crownAssault(support);
    if (s.winner) return;
    // A failed coup (or a civil war) does not stop the swords between houses.
    await this.step_battles(support, bands, fealtyNow);
    this.step_attackFealty(bands);
    await this.grantTitles();
    this.notify();
  }

  /** 3.1 — petitions, pardons and (optional) ransoms. */
  async step_petitions(bandsAtStart) {
    const s = this.state;
    for (const p of seatOrder(s)) {
      const c = s.commitments[p.id];
      if (!c || c.order !== ORDER.PETITION) continue;
      if (bandsAtStart[p.id] === BAND.OUTLAW) {
        p.fealty = 0;
        s.beats.push({ kind: 'appeal', actor: p.id, pardon: true });
        this.emit('petition', `${p.name} buys a pardon for ${s.tuning.pardonCost} gold and returns to fealty 0.`);
      } else {
        p.fealty = clampFealty(p.fealty + 1);
        s.beats.push({ kind: 'appeal', actor: p.id, fealty: p.fealty });
        this.emit('petition', `${p.name} petitions the Crown: fealty ${fmt(p.fealty)}.`);
      }
    }

    if (s.options.ransom) {
      for (const p of seatOrder(s)) {
        const c = s.commitments[p.id];
        if (!c || c.order !== ORDER.RANSOM) continue;
        p.ransomUsed = true;
        if (c.target === CROWN) {
          p.gold += s.tuning.ransomCrownGold;
          p.fealty = -3;
          this.emit('ransom', `${p.name} ransoms the Crown's own coffers: +${s.tuning.ransomCrownGold} gold, fealty −3.`);
          continue;
        }
        const victim = this.player(c.target);
        const taken = Math.min(s.tuning.ransomTake, victim.gold);
        victim.gold -= taken;
        p.gold += taken;
        let note = '';
        if (bandsAtStart[victim.id] === BAND.FAVORITE) {
          p.fealty = clampFealty(p.fealty - 2);
          note = ` The crown protects its own: ${p.name} drops to ${fmt(p.fealty)}.`;
        } else if (bandsAtStart[victim.id] === BAND.OUTLAW) {
          p.fealty = clampFealty(p.fealty + 1);
          note = ` Bounty work: ${p.name} rises to ${fmt(p.fealty)}.`;
        }
        this.emit('ransom', `${p.name} ransoms ${victim.name} for ${taken} gold.${note}`);
      }
    }

    await this.grantTitles();
  }

  /** Support routing (§4): to the target's attack if they attacked, else defense. */
  tallySupport() {
    const s = this.state;
    const toAttack = {};
    const toDefense = {};
    let toCrown = 0;
    for (const p of seatOrder(s)) {
      const c = s.commitments[p.id];
      if (!c || c.order !== ORDER.SUPPORT) continue;
      if (c.target === CROWN) {
        toCrown += c.gold;
        s.beats.push({ kind: 'support', actor: p.id, target: CROWN, gold: c.gold });
        this.emit('support', `${p.name} sends ${c.gold} gold to the Crown's defense.`);
        continue;
      }
      const tc = s.commitments[c.target];
      s.beats.push({ kind: 'support', actor: p.id, target: c.target, gold: c.gold });
      if (tc && tc.order === ORDER.ATTACK) {
        toAttack[c.target] = (toAttack[c.target] || 0) + c.gold;
        this.emit('support', `${p.name} reinforces ${this.nameOf(c.target)}'s attack with ${c.gold} gold.`);
      } else {
        toDefense[c.target] = (toDefense[c.target] || 0) + c.gold;
        this.emit('support', `${p.name} reinforces ${this.nameOf(c.target)}'s defense with ${c.gold} gold.`);
      }
    }
    return { toAttack, toDefense, toCrown };
  }

  attackStrength(pid, support, targetIsCrown, bands, fealtyNow) {
    const s = this.state;
    const p = this.player(pid);
    const c = s.commitments[pid];
    let str = c.gold + (support.toAttack[pid] || 0);
    if (hasTitle(p, 'marshal')) str += s.tuning.marshalBonus;
    if (!targetIsCrown) {
      // §2 favorite punching-down bonus.
      const me = fealtyNow[pid];
      const them = fealtyNow[c.target];
      if (bands[pid] === BAND.FAVORITE && them < me) str += Math.round(me * s.tuning.punchDownScale);
    }
    return str;
  }

  defenseOf(pid, support) {
    const s = this.state;
    const p = this.player(pid);
    const c = s.commitments[pid];
    // Two ways to have no walls: your army is out attacking, or it is out
    // serving the Crown's levy. The gate is open either way.
    const inTheField = !!(c && c.order === ORDER.ATTACK) || !!p.noArmy;
    let def = inTheField ? 0 : s.tuning.walls;
    def += support.toDefense[pid] || 0;
    if (hasTitle(p, 'warden')) def += s.tuning.wardenBonus;
    return { def, wallsDown: inTheField };
  }

  /** §5 — attacking the Crown. */
  async step_crownAssault(support) {
    const s = this.state;
    const conspirators = seatOrder(s).filter((p) => {
      const c = s.commitments[p.id];
      return c && c.order === ORDER.ATTACK && c.target === CROWN;
    });
    if (conspirators.length === 0) return { attempted: false, won: false };

    const contributions = conspirators.map((p) => ({
      pid: p.id,
      name: p.name,
      value: this.attackStrength(p.id, support, true, null, null),
    }));
    const pool = contributions.reduce((a, b) => a + b.value, 0);
    const defense = crownStrength(s) + support.toCrown;
    const heraldConspirator = conspirators.find((p) => hasTitle(p, 'herald'));
    const won = pool > defense || (pool === defense && !!heraldConspirator);

    const marchers = conspirators.map((p) => p.name);
    const verb = marchers.length === 1 ? 'marches' : 'march';
    const who = marchers.length > 1
      ? `${marchers.slice(0, -1).join(', ')} and ${marchers[marchers.length - 1]}`
      : marchers[0];
    for (const c of contributions) {
      s.beats.push({ kind: 'attack', actor: c.pid, target: CROWN, strength: c.value, defense, won });
    }
    this.emit('coup', `Usurpation! ${who} ${verb} on the throne: ${pool} against the Crown's ${defense}.`);

    if (!won) {
      for (const p of conspirators) {
        p.fealty = -3;
        if (p.lands > 0) {
          p.lands -= 1;
          s.crownLands += 1;
        }
      }
      this.emit('coup', 'The assault breaks on the royal guard. Every conspirator is cast down to −3 and forfeits a land.');
      return { attempted: true, won: false };
    }

    const top = Math.max(...contributions.map((c) => c.value));
    let leaders = contributions.filter((c) => c.value === top);
    if (leaders.length > 1) {
      const herald = leaders.find((c) => hasTitle(this.player(c.pid), 'herald'));
      if (herald) leaders = [herald];
    }
    if (leaders.length > 1) {
      for (const p of conspirators) p.fealty = -3;
      s.winner = null;
      this.emit('coup', `Civil war: ${leaders.map((l) => l.name).join(' and ')} contributed equally and neither will kneel. No one takes the throne; all conspirators fall to −3.`);
      return { attempted: true, won: true, civilWar: true };
    }

    s.winner = { playerIds: [leaders[0].pid], how: 'usurp' };
    this.emit('victory', `${leaders[0].name} takes the throne by force and is crowned.`);
    this.setPhase('gameOver');
    return { attempted: true, won: true };
  }

  /** §5 — player versus player. */
  async step_battles(support, bands, fealtyNow) {
    const s = this.state;
    const attacks = seatOrder(s)
      .map((p) => ({ p, c: s.commitments[p.id] }))
      .filter(({ c }) => c && c.order === ORDER.ATTACK && c.target !== CROWN)
      .map(({ p, c }) => ({
        attacker: p.id,
        target: c.target,
        strength: this.attackStrength(p.id, support, false, bands, fealtyNow),
      }));
    if (attacks.length === 0) return;

    const byTarget = new Map();
    for (const a of attacks) {
      if (!byTarget.has(a.target)) byTarget.set(a.target, []);
      byTarget.get(a.target).push(a);
    }

    for (const [targetId, list] of byTarget) {
      const { def, wallsDown } = this.defenseOf(targetId, support);
      const defender = this.player(targetId);
      this.emit('combat', `${defender.name} defends with ${def}${wallsDown ? ' (walls down — their army is in the field)' : ''}.`);

      // Descending attack strength; equal strength is settled by precedence at
      // court, so who strikes first is a fact about the table rather than a
      // die roll.
      const rank = new Map(precedence(s, list.map((a) => this.player(a.attacker)))
        .map((p, i) => [p.id, i]));
      list.sort((a, b) => (b.strength - a.strength) || (rank.get(a.attacker) - rank.get(b.attacker)));

      for (const a of list) {
        const attacker = this.player(a.attacker);
        const heraldWinsTie = hasTitle(attacker, 'herald') && !hasTitle(defender, 'herald');
        const wins = a.strength > def || (a.strength === def && heraldWinsTie);
        s.beats.push({ kind: 'attack', actor: a.attacker, target: targetId, strength: a.strength, defense: def, won: wins });
        if (!wins) {
          this.emit('combat', `${attacker.name} strikes at ${defender.name} with ${a.strength} and is thrown back.`);
          continue;
        }
        this.emit('combat', `${attacker.name} strikes at ${defender.name} with ${a.strength} and breaks through.`);
        await this.takeSpoils(attacker, defender, wallsDown);
      }
    }
  }

  /** §5 spoils — a land, or a title if the loser's walls were down. */
  async takeSpoils(winner, loser, wallsDown) {
    // Plunder first, and it is not a choice: you break the gate, the strongboxes
    // go. This is what makes a fat purse a reason to be attacked.
    const plunder = Math.min(this.state.tuning.spoilsGold || 0, loser.gold);
    if (plunder > 0) {
      loser.gold -= plunder;
      winner.gold += plunder;
      this.emit('spoils', `${winner.name} plunders ${plunder} gold from ${loser.name}.`);
    }
    const canTakeTitle = wallsDown && loser.titles.length > 0;
    const canTakeLand = loser.lands > 0;
    if (!canTakeLand && !canTakeTitle) {
      if (!plunder) this.emit('spoils', `${loser.name} has nothing left worth taking.`);
      return;
    }
    let choice = { kind: canTakeLand ? 'land' : 'title', title: loser.titles[0] };
    if (canTakeLand && canTakeTitle) {
      const answer = await this.ask(winner.id, {
        type: 'spoils',
        loser: loser.id,
        canTakeTitle: true,
        titles: loser.titles.slice(),
      });
      if (answer && answer.kind === 'title' && loser.titles.includes(answer.title)) {
        choice = { kind: 'title', title: answer.title };
      }
    } else if (!canTakeLand && canTakeTitle) {
      const answer = await this.ask(winner.id, {
        type: 'spoils',
        loser: loser.id,
        canTakeTitle: true,
        titles: loser.titles.slice(),
        landsAvailable: false,
      });
      if (answer && answer.title && loser.titles.includes(answer.title)) choice.title = answer.title;
    }

    if (choice.kind === 'land') {
      loser.lands -= 1;
      winner.lands += 1;
      this.emit('spoils', `${winner.name} takes a land from ${loser.name}.`);
    } else {
      loser.titles = loser.titles.filter((t) => t !== choice.title);
      winner.titles.push(choice.title);
      this.emit('spoils', `${winner.name} strips ${loser.name} of the title of ${TITLE_BY_ID[choice.title].name}.`);
    }
  }

  /** §4 Develop, resolved after standing and before the swords. */
  step_develop() {
    const s = this.state;
    const developers = seatOrder(s).filter((p) => s.commitments[p.id]?.order === ORDER.DEVELOP);
    if (developers.length === 0) return;
    for (const p of precedence(s, developers)) {
      if (s.neutralPool <= 0) {
        p.gold += s.tuning.developCost; // nothing left to buy; the purse comes home
        this.emit('develop', `${p.name} finds no unclaimed land left to settle; the ${s.tuning.developCost} gold is returned.`);
        continue;
      }
      s.neutralPool -= 1;
      p.lands += 1;
      s.beats.push({ kind: 'develop', actor: p.id, lands: p.lands });
      this.emit('develop', `${p.name} settles a new land (${p.lands} total).`);
    }
  }

  /** §4 — fealty consequences of attacking, by the target's band at resolution. */
  step_attackFealty(bands) {
    const s = this.state;
    for (const p of seatOrder(s)) {
      const c = s.commitments[p.id];
      if (!c || c.order !== ORDER.ATTACK) continue;
      if (c.target === CROWN) {
        if (p.fealty !== -3) {
          p.fealty = -3;
          this.emit('fealty', `${p.name} raised a hand against the Crown: fealty −3.`);
        }
        continue;
      }
      const delta = s.tuning.attackFealty[bands[c.target]];
      if (delta === 0) continue;
      const before = p.fealty;
      p.fealty = clampFealty(p.fealty + delta);
      if (p.fealty === before) continue;
      const why = delta < 0 ? `striking the Crown's favorite` : `hunting an outlaw`;
      this.emit('fealty', `${p.name} ${delta < 0 ? 'loses' : 'gains'} standing for ${why}: ${fmt(p.fealty)}.`);
    }
  }

  /**
   * §2 — title grants at +2 and +3, once each per player, ever.
   *
   * A grant may be spent on a title somebody already holds, for
   * `titleClaimCost` gold to the Crown. That is what keeps a coronet from
   * being a thing you bank: the first house to +3 does not stand alone with the
   * Herald, because the next house to +3 can simply ask for it. No sword
   * required, but it costs coin and it makes an enemy of a friend.
   */
  async grantTitles() {
    const s = this.state;
    const claimants = seatOrder(s).filter((p) => (p.fealty >= 2 && !p.titleGrants[2]) || (p.fealty >= 3 && !p.titleGrants[3]));
    if (claimants.length === 0) return;
    for (const p of precedence(s, claimants)) {
      for (const threshold of [2, 3]) {
        if (p.fealty < threshold || p.titleGrants[threshold]) continue;
        const available = unclaimedTitles(s);
        const claimable = claimableTitles(s, p);
        if (available.length === 0 && claimable.length === 0) {
          this.emit('title', `${p.name} has earned a title, but all six are spoken for${p.gold < s.tuning.titleClaimCost ? ` and a claim on one costs ${s.tuning.titleClaimCost} gold` : ''}.`);
          continue;
        }
        const answer = await this.ask(p.id, {
          type: 'title',
          available,
          claimable,
          claimCost: s.tuning.titleClaimCost,
          threshold,
        });
        const claim = claimable.find((c) => c.title === answer);
        const chosen = available.includes(answer) ? answer
          : claim ? answer
            : (available[0] ?? claimable[0].title);
        const taking = available.includes(chosen) ? null : claimable.find((c) => c.title === chosen);
        if (taking) {
          const holder = this.player(taking.holder);
          holder.titles = holder.titles.filter((t) => t !== chosen);
          p.gold -= taking.cost;
          s.crownGold += taking.cost;
          this.emit('title', `${p.name} claims the title of ${TITLE_BY_ID[chosen].name} from ${holder.name}, and pays the Crown ${taking.cost} gold to soothe the slight.`);
        } else {
          this.emit('title', `${p.name} is named ${TITLE_BY_ID[chosen].name}.`);
        }
        p.titles.push(chosen);
        p.titleGrants[threshold] = true;
      }
    }
  }

  // ------------------------------------------------------------ 4. income

  incomeStep() {
    const s = this.state;
    this.setPhase('income');
    for (const p of seatOrder(s)) {
      let income = p.lands * s.tuning.landIncome;
      const bits = [`${income} from land`];
      if (bandOf(p.fealty) === BAND.NEUTRAL && s.tuning.neutralIncome) {
        income += s.tuning.neutralIncome;
        bits.push(`${s.tuning.neutralIncome} for keeping their head down`);
      }
      if (hasTitle(p, 'steward') && s.tuning.stewardIncome) {
        income += s.tuning.stewardIncome;
        bits.push(`${s.tuning.stewardIncome} as Steward`);
      }
      p.gold += income;
      p.escrow = 0;
      this.emit('income', `${p.name} collects ${income} gold (${bits.join(', ')}).`);
    }
    this.notify();
  }

  // ------------------------------------------------------------ 8. victory

  inherit() {
    const s = this.state;
    const rank = (p) => [p.fealty, p.lands, p.gold];
    let best = s.players.slice().sort((a, b) => {
      const [af, al, ag] = rank(a);
      const [bf, bl, bg] = rank(b);
      return bf - af || bl - al || bg - ag;
    });
    const top = best[0];
    const tied = best.filter((p) => p.fealty === top.fealty && p.lands === top.lands && p.gold === top.gold);
    s.winner = { playerIds: tied.map((p) => p.id), how: 'inherit' };
    if (tied.length === 1) {
      this.emit('victory', `The crown deck is spent. ${top.name} is the highest in the King's graces and inherits the throne.`);
    } else {
      this.emit('victory', `The crown deck is spent and ${tied.map((p) => p.name).join(' and ')} are inseparable in the King's graces. They rule together.`);
    }
    this.setPhase('gameOver');
  }

  // ------------------------------------------------- table-talk transactions

  /** §3 standing rule — gold may be given away at any time. Escrow is untouchable. */
  gift(fromId, toId, amount) {
    const from = this.player(fromId);
    const to = this.player(toId);
    const n = Math.floor(amount);
    if (!from || !to || from === to || !(n > 0)) return false;
    if (from.gold < n) return false;
    from.gold -= n;
    to.gold += n;
    const key = `${fromId}>${toId}`;
    this.state.goodwill[key] = (this.state.goodwill[key] || 0) + n;
    this.emit('gift', `${from.name} gives ${n} gold to ${to.name}.`);
    return true;
  }
}

export function describeOrder(c, nameOf, pardonCost = 3) {
  if (!c) return 'no order';
  switch (c.order) {
    case ORDER.ATTACK: return `Attack ${nameOf(c.target)} with ${c.gold} gold`;
    case ORDER.SUPPORT: return `Support ${nameOf(c.target)} with ${c.gold} gold`;
    case ORDER.PETITION: return c.gold >= pardonCost ? `Petition (pardon, ${c.gold} gold)` : `Petition (${c.gold} gold)`;
    case ORDER.DEVELOP: return `Develop (${c.gold} gold)`;
    case ORDER.RANSOM: return `Ransom ${nameOf(c.target)}`;
    default: return 'Hold';
  }
}

function fmt(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

export { ORDER, ORDER_LABEL, CROWN };
