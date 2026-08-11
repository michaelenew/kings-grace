// The King's Graces — rules engine.
//
// The engine drives the whole round loop and asks each seat's *controller* for
// decisions through an async `decide(request, view)` interface. The UI plugs a
// human controller in (resolving a promise from a form); tests plug scripted
// controllers in; the AI module plugs a bot in. Nothing about the rules knows
// what a DOM is.

import {
  ATTACK_FEALTY_DELTA, BAND, CARD, CARD_LABEL, COSTS, CROWN, ORDER, ORDER_LABEL,
  TAX_BY_BAND, TITLE_BY_ID, WALLS, bandOf, clampFealty,
} from './constants.js';
import {
  createGame, crownStrength, hasTitle, legalOrders, petitionCostFor, playerById,
  unclaimedTitles, viewFor,
} from './state.js';

const seatOrder = (state) => state.players.slice().sort((a, b) => a.seat - b.seat);

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
    const card = s.deck.shift();
    s.discard.push(card);
    s.lastCard = card;
    this.emit('crown', `Round ${s.round}: the Crown reveals ${CARD_LABEL[card]}. Crown strength is now ${crownStrength(s)}.`, { card });

    if (card === CARD.TAX) this.resolveTax();
    else if (card === CARD.LEVY) await this.resolveLevy();
    else if (card === CARD.FAVOR) this.resolveFavor();
    else if (card === CARD.PURGE) this.resolvePurge();

    this.notify();
  }

  resolveTax() {
    for (const p of seatOrder(this.state)) {
      let due = TAX_BY_BAND[bandOf(p.fealty)];
      if (hasTitle(p, 'chancellor')) due = Math.max(0, due - 1);
      const paid = Math.min(due, p.gold);
      p.gold -= paid;
      this.state.crownGold += paid;
      const short = paid < due ? ` (owed ${due}, could only pay ${paid})` : '';
      this.emit('tax', `${p.name} pays ${paid} gold in tax${short}.`);
    }
  }

  async resolveLevy() {
    for (const p of seatOrder(this.state)) {
      let choice;
      if (p.gold < COSTS.LEVY) {
        choice = 'fealty';
      } else {
        choice = await this.ask(p.id, {
          type: 'levy',
          cost: COSTS.LEVY,
          text: 'Pay 2 gold to the Crown, or drop 1 fealty.',
        });
        if (choice !== 'pay' && choice !== 'fealty') choice = 'fealty';
      }
      if (choice === 'pay') {
        p.gold -= COSTS.LEVY;
        this.state.crownGold += COSTS.LEVY;
        this.emit('levy', `${p.name} pays the levy: 2 gold.`);
      } else {
        const before = p.fealty;
        p.fealty = clampFealty(p.fealty - 1);
        const note = p.fealty === before ? ' (already at the bottom of the track)' : '';
        this.emit('levy', `${p.name} refuses the levy and loses standing${note}.`);
      }
    }
  }

  resolveFavor() {
    const s = this.state;
    const best = Math.max(...s.players.map((p) => p.fealty));
    const winners = s.players.filter((p) => p.fealty === best);
    if (winners.length !== 1) {
      this.emit('crown-card', 'Favor: the court cannot agree on a single favorite. No effect.');
      return;
    }
    if (s.neutralPool <= 0) {
      this.emit('crown-card', 'Favor: no unclaimed land remains. No effect.');
      return;
    }
    s.neutralPool -= 1;
    winners[0].lands += 1;
    this.emit('crown-card', `Favor: ${winners[0].name} is granted a land from the neutral pool.`);
  }

  resolvePurge() {
    const s = this.state;
    const worst = Math.min(...s.players.map((p) => p.fealty));
    const losers = s.players.filter((p) => p.fealty === worst);
    if (losers.length !== 1) {
      this.emit('crown-card', 'Purge: no single scapegoat. No effect.');
      return;
    }
    const victim = losers[0];
    if (victim.lands <= 0) {
      this.emit('crown-card', `Purge: ${victim.name} has no land left to forfeit.`);
      return;
    }
    victim.lands -= 1;
    s.crownLands += 1;
    this.emit('crown-card', `Purge: ${victim.name} forfeits a land to the Crown.`);
  }

  // -------------------------------------------------------- 2. commit (§3)

  async commitPhase() {
    const s = this.state;
    this.setPhase('commit');
    s.commitments = {};
    s.knowledge = {};
    s.pacts = {};
    s.changeRights = {};
    s.revealed = false;
    for (const p of s.players) s.knowledge[p.id] = { orders: {}, topCard: null };

    for (const p of seatOrder(s)) {
      const answer = await this.ask(p.id, {
        type: 'order',
        legal: legalOrders(s, p),
        petitionCost: petitionCostFor(p),
      });
      this.commit(p.id, answer);
    }
    this.emit('commit', 'All orders are sealed.');
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
      gold = Math.max(1, Math.min(Math.floor(gold) || 1, p.gold));
    } else if (order === ORDER.PETITION) {
      gold = petitionCostFor(p);
      target = null;
    } else if (order === ORDER.DEVELOP) {
      gold = COSTS.DEVELOP;
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
        s.changeRights[p.id] = (s.changeRights[p.id] || 0) + 1;
      }

      if (hasTitle(p, 'spymaster')) {
        await this.doPeek(p, 'order', true);
      }
    }

    // Turncoat rights are exercised after every outlaw has looked.
    for (const p of seatOrder(s)) {
      while ((s.changeRights[p.id] || 0) > 0) {
        s.changeRights[p.id] -= 1;
        const answer = await this.ask(p.id, {
          type: 'turncoat',
          others: s.players.filter((x) => x.id !== p.id).map((x) => x.id),
          text: 'Turncoat: change your own order, hand the right to another player, or decline.',
        });
        const action = answer?.action || 'none';
        if (action === 'change') {
          const before = s.commitments[p.id];
          const next = await this.ask(p.id, {
            type: 'order',
            legal: legalOrders(s, { ...p, gold: p.gold + p.escrow }),
            petitionCost: petitionCostFor(p),
            reason: 'turncoat',
          });
          this.recommit(p.id, next);
          this.emit('turncoat', `${p.name} quietly changes their order.`, { secret: true, pid: p.id, before });
        } else if (action === 'give' && answer.to && this.player(answer.to)) {
          s.changeRights[answer.to] = (s.changeRights[answer.to] || 0) + 1;
          this.emit('turncoat', `${p.name} hands a change of orders to ${this.nameOf(answer.to)}.`);
          // The recipient exercises it right away.
          const to = this.player(answer.to);
          while ((s.changeRights[to.id] || 0) > 0) {
            s.changeRights[to.id] -= 1;
            const use = await this.ask(to.id, {
              type: 'turncoatGranted',
              from: p.id,
              text: `${p.name} gives you one change of orders. Use it?`,
            });
            if (use?.action === 'change') {
              const next = await this.ask(to.id, {
                type: 'order',
                legal: legalOrders(s, { ...to, gold: to.gold + to.escrow }),
                petitionCost: petitionCostFor(to),
                reason: 'turncoat',
              });
              this.recommit(to.id, next);
              this.emit('turncoat', `${to.name} changes their order.`, { secret: true, pid: to.id });
            } else {
              this.emit('turncoat', `${to.name} declines to change anything.`);
            }
          }
        } else {
          this.emit('turncoat', `${p.name} lets the orders stand.`);
        }
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
    for (const p of seatOrder(s)) {
      const c = s.commitments[p.id];
      this.emit('reveal', `${p.name}: ${describeOrder(c, (id) => this.nameOf(id))}.`);
    }

    // Bands are read at resolution time (§2). Petitions move fealty first, so
    // everything after step 3.1 uses the recalculated bands.
    const bandsAtStart = Object.fromEntries(s.players.map((p) => [p.id, bandOf(p.fealty)]));

    await this.step_petitions(bandsAtStart);
    if (s.winner) return;

    const bands = Object.fromEntries(s.players.map((p) => [p.id, bandOf(p.fealty)]));
    const fealtyNow = Object.fromEntries(s.players.map((p) => [p.id, p.fealty]));

    const support = this.tallySupport();
    await this.step_crownAssault(support);
    if (s.winner) return;
    // A failed coup (or a civil war) does not stop the swords between houses.
    await this.step_battles(support, bands, fealtyNow);
    this.step_develop();
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
        this.emit('petition', `${p.name} buys a pardon for 3 gold and returns to fealty 0.`);
      } else {
        p.fealty = clampFealty(p.fealty + 1);
        this.emit('petition', `${p.name} petitions the Crown: fealty ${fmt(p.fealty)}.`);
      }
    }

    if (s.options.ransom) {
      for (const p of seatOrder(s)) {
        const c = s.commitments[p.id];
        if (!c || c.order !== ORDER.RANSOM) continue;
        p.ransomUsed = true;
        if (c.target === CROWN) {
          p.gold += 5;
          p.fealty = -3;
          this.emit('ransom', `${p.name} ransoms the Crown's own coffers: +5 gold, fealty −3.`);
          continue;
        }
        const victim = this.player(c.target);
        const taken = Math.min(2, victim.gold);
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
        this.emit('support', `${p.name} sends ${c.gold} gold to the Crown's defense.`);
        continue;
      }
      const tc = s.commitments[c.target];
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
    if (hasTitle(p, 'marshal')) str += 1;
    if (!targetIsCrown) {
      // §2 favorite punching-down bonus.
      const me = fealtyNow[pid];
      const them = fealtyNow[c.target];
      if (bands[pid] === BAND.FAVORITE && them < me) str += me;
    }
    return str;
  }

  defenseOf(pid, support) {
    const s = this.state;
    const p = this.player(pid);
    const c = s.commitments[pid];
    const inTheField = c && c.order === ORDER.ATTACK;
    let def = inTheField ? 0 : WALLS;
    def += support.toDefense[pid] || 0;
    if (hasTitle(p, 'warden')) def += 1;
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
        tiebreak: s.rng(),
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

      // Descending attack strength; Herald wins ordering ties, then rng.
      list.sort((a, b) => {
        if (b.strength !== a.strength) return b.strength - a.strength;
        const ah = hasTitle(this.player(a.attacker), 'herald') ? 1 : 0;
        const bh = hasTitle(this.player(b.attacker), 'herald') ? 1 : 0;
        if (ah !== bh) return bh - ah;
        return a.tiebreak - b.tiebreak;
      });

      for (const a of list) {
        const attacker = this.player(a.attacker);
        const heraldWinsTie = hasTitle(attacker, 'herald') && !hasTitle(defender, 'herald');
        const wins = a.strength > def || (a.strength === def && heraldWinsTie);
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
    const canTakeTitle = wallsDown && loser.titles.length > 0;
    const canTakeLand = loser.lands > 0;
    if (!canTakeLand && !canTakeTitle) {
      this.emit('spoils', `${loser.name} has nothing left worth taking.`);
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

  /** §4 Develop, resolved after spoils so a fresh land cannot be looted the same round. */
  step_develop() {
    const s = this.state;
    const developers = seatOrder(s).filter((p) => s.commitments[p.id]?.order === ORDER.DEVELOP);
    if (developers.length === 0) return;
    const ordered = developers.slice().sort((a, b) => {
      const ah = hasTitle(a, 'herald') ? 1 : 0;
      const bh = hasTitle(b, 'herald') ? 1 : 0;
      if (ah !== bh) return bh - ah;
      return s.rng() - 0.5;
    });
    for (const p of ordered) {
      if (s.neutralPool <= 0) {
        p.gold += COSTS.DEVELOP; // nothing left to buy; the purse comes home
        this.emit('develop', `${p.name} finds no unclaimed land left to settle; the 3 gold is returned.`);
        continue;
      }
      s.neutralPool -= 1;
      p.lands += 1;
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
      const delta = ATTACK_FEALTY_DELTA[bands[c.target]];
      if (delta === 0) continue;
      const before = p.fealty;
      p.fealty = clampFealty(p.fealty + delta);
      if (p.fealty === before) continue;
      const why = delta < 0 ? `striking the Crown's favorite` : `hunting an outlaw`;
      this.emit('fealty', `${p.name} ${delta < 0 ? 'loses' : 'gains'} standing for ${why}: ${fmt(p.fealty)}.`);
    }
  }

  /** §2 — title grants at +2 and +3, once each per player, ever. */
  async grantTitles() {
    const s = this.state;
    for (const p of seatOrder(s)) {
      for (const threshold of [2, 3]) {
        if (p.fealty < threshold || p.titleGrants[threshold]) continue;
        const available = unclaimedTitles(s);
        if (available.length === 0) {
          this.emit('title', `${p.name} has earned a title, but all six are spoken for.`);
          continue;
        }
        const answer = await this.ask(p.id, {
          type: 'title',
          available,
          threshold,
        });
        const chosen = available.includes(answer) ? answer : available[0];
        p.titles.push(chosen);
        p.titleGrants[threshold] = true;
        this.emit('title', `${p.name} is named ${TITLE_BY_ID[chosen].name}.`);
      }
    }
  }

  // ------------------------------------------------------------ 4. income

  incomeStep() {
    const s = this.state;
    this.setPhase('income');
    for (const p of seatOrder(s)) {
      let income = p.lands;
      const bits = [`${p.lands} from land`];
      if (bandOf(p.fealty) === BAND.NEUTRAL) {
        income += 1;
        bits.push('1 for keeping their head down');
      }
      if (hasTitle(p, 'steward')) {
        income += 1;
        bits.push('1 as Steward');
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

export function describeOrder(c, nameOf) {
  if (!c) return 'no order';
  switch (c.order) {
    case ORDER.ATTACK: return `Attack ${nameOf(c.target)} with ${c.gold} gold`;
    case ORDER.SUPPORT: return `Support ${nameOf(c.target)} with ${c.gold} gold`;
    case ORDER.PETITION: return c.gold >= COSTS.PARDON ? 'Petition (pardon, 3 gold)' : 'Petition (2 gold)';
    case ORDER.DEVELOP: return 'Develop (3 gold)';
    case ORDER.RANSOM: return `Ransom ${nameOf(c.target)}`;
    default: return 'Hold';
  }
}

function fmt(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

export { ORDER, ORDER_LABEL, CROWN };
