import test from 'node:test';
import assert from 'node:assert/strict';

import { BAND, CARD, CROWN, ORDER, bandOf } from '../src/engine/constants.js';
import { buildDeck, crownStrength, legalOrders } from '../src/engine/state.js';
import { RULES, deckSize, neutralPoolFor } from '../src/engine/tuning.js';
import { makeRng } from '../src/engine/rng.js';
import { fillOrders, get, makeGame, set } from './_helpers.js';

// ---------------------------------------------------------------- setup (§1)

test('setup deals what the rules say', () => {
  const g = makeGame();
  assert.equal(g.state.players.length, 4);
  for (const p of g.state.players) {
    assert.equal(p.lands, RULES.startLands);
    assert.equal(p.gold, RULES.startGold);
    assert.equal(p.fealty, RULES.startFealty);
  }
  assert.equal(g.state.neutralPool, neutralPoolFor(RULES, 4));
  assert.equal(g.state.deck.length, deckSize(RULES));
});

test('crown strength is the constant plus the cards left', () => {
  const strengthAt = (players) => {
    const g = makeGame({ players });
    return crownStrength(g.state);
  };
  assert.ok(strengthAt(3) <= strengthAt(4), 'never weaker as the table grows');
  assert.ok(strengthAt(4) <= strengthAt(6), 'nor at six');
  const g = makeGame();
  assert.equal(
    crownStrength(g.state),
    RULES.crownBase + RULES.crownPerPlayer * 4 + g.state.deck.length,
    'crown strength is base + per-player + cards remaining',
  );
});

test('a game can be dealt for three through six players', () => {
  for (let players = 3; players <= 6; players++) {
    const g = makeGame({ players });
    assert.equal(g.state.players.length, players);
    assert.equal(g.state.neutralPool, neutralPoolFor(RULES, players));
    assert.equal(new Set(g.state.players.map((p) => p.name)).size, players, 'every house is named');
  }
});

test('the crown deck holds what the rules say', () => {
  const deck = buildDeck(makeRng(3), false, RULES);
  for (const [card, count] of Object.entries(RULES.deck)) {
    assert.equal(deck.filter((x) => x === card).length, count, card);
  }
});

test('the tuning knob seeds a Favor into the first three flips', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const deck = buildDeck(makeRng(seed), true, RULES);
    assert.ok(deck.slice(0, 3).includes(CARD.FAVOR), `seed ${seed}`);
    assert.equal(deck.length, deckSize(RULES));
  }
});

test('fealty bands', () => {
  assert.equal(bandOf(3), BAND.FAVORITE);
  assert.equal(bandOf(2), BAND.FAVORITE);
  assert.equal(bandOf(1), BAND.NEUTRAL);
  assert.equal(bandOf(-1), BAND.NEUTRAL);
  assert.equal(bandOf(-2), BAND.OUTLAW);
  assert.equal(bandOf(-3), BAND.OUTLAW);
});

// ------------------------------------------------------------ crown deck (§6)

test('tax charges by band, Chancellor pays 1 less, and nobody pays what they lack', () => {
  const g = makeGame();
  set(g.state, 'p0', { fealty: 2, gold: 10 }); // favorite: 1
  set(g.state, 'p1', { fealty: 0, gold: 10 }); // neutral: 2
  set(g.state, 'p2', { fealty: -3, gold: 10, titles: ['chancellor'] }); // outlaw 3, less 1
  set(g.state, 'p3', { fealty: -2, gold: 1 }); // outlaw 3, only has 1
  g.resolveTax();
  assert.equal(get(g.state, 'p0').gold, 9);
  assert.equal(get(g.state, 'p1').gold, 8);
  assert.equal(get(g.state, 'p2').gold, 8);
  assert.equal(get(g.state, 'p3').gold, 0);
  assert.equal(g.state.crownGold, 1 + 2 + 2 + 1);
});

test('levy: pay the demand or drop a fealty, and the poor have no choice', async () => {
  const g = makeGame({
    controllers: {
      p0: { levy: 'pay' },
      p1: { levy: 'fealty' },
      p3: { levy: 'pay' },
    },
  });
  const levy = g.state.tuning.levyCost;
  set(g.state, 'p2', { gold: levy - 1 }); // cannot pay
  set(g.state, 'p3', { fealty: -3 });
  await g.resolveLevy();
  assert.equal(get(g.state, 'p0').gold, RULES.startGold - levy);
  assert.equal(get(g.state, 'p1').fealty, -1);
  assert.equal(get(g.state, 'p2').gold, levy - 1, 'the poor pay nothing');
  assert.equal(get(g.state, 'p2').fealty, -1);
  assert.equal(get(g.state, 'p3').gold, RULES.startGold - levy);
});

test('levy at the floor of the track costs nothing', async () => {
  const g = makeGame({ controllers: { p0: { levy: 'fealty' } } });
  set(g.state, 'p0', { fealty: -3, gold: 5 });
  await g.resolveLevy();
  assert.equal(get(g.state, 'p0').fealty, -3);
  assert.equal(get(g.state, 'p0').gold, 5);
});

test('favor pays every favorite, and land only at the top of the track', () => {
  const g = makeGame();
  const t = g.state.tuning;
  set(g.state, 'p0', { fealty: 3, gold: 0, lands: 3 });
  set(g.state, 'p1', { fealty: 2, gold: 0, lands: 3 });
  set(g.state, 'p2', { fealty: 1, gold: 0, lands: 3 });
  set(g.state, 'p3', { fealty: -2, gold: 0, lands: 3 });
  const pool = g.state.neutralPool;
  g.resolveFavor();
  assert.equal(get(g.state, 'p0').gold, t.favorGold, '+3 is paid');
  assert.equal(get(g.state, 'p0').lands, 4, 'and takes a land');
  assert.equal(get(g.state, 'p1').gold, t.favorGold, '+2 is paid');
  assert.equal(get(g.state, 'p1').lands, 3, 'but takes no land');
  assert.equal(get(g.state, 'p2').gold, 0, 'a neutral gets nothing');
  assert.equal(get(g.state, 'p3').gold, 0, 'an outlaw gets nothing');
  assert.equal(g.state.neutralPool, pool - 1);
});

test('favor still pays gold when no land remains', () => {
  const g = makeGame();
  g.state.neutralPool = 0;
  set(g.state, 'p0', { fealty: 3, gold: 0 });
  g.resolveFavor();
  assert.equal(get(g.state, 'p0').gold, g.state.tuning.favorGold);
  assert.equal(get(g.state, 'p0').lands, 3);
});

test('the optional levy seizes land from outlaws instead of coin', async () => {
  const g = makeGame({ options: { levyTargetsOutlaws: true }, controllers: { p0: { levy: 'pay' } } });
  set(g.state, 'p1', { fealty: -2, lands: 3 });
  set(g.state, 'p2', { fealty: -3, lands: 3 });
  set(g.state, 'p3', { fealty: -3, lands: 1 });
  const goldBefore = get(g.state, 'p1').gold;
  await g.resolveLevy();
  assert.equal(get(g.state, 'p1').lands, 2, 'one land at −2');
  assert.equal(get(g.state, 'p1').gold, goldBefore, 'and no coin');
  assert.equal(get(g.state, 'p2').lands, 1, 'two lands at −3');
  assert.equal(get(g.state, 'p3').lands, 0, 'or whatever is left');
  assert.equal(g.state.crownLands, 4);
});

test('without the option, outlaws face the same levy as everyone', async () => {
  const g = makeGame({ controllers: { p1: { levy: 'fealty' } } });
  set(g.state, 'p1', { fealty: -2, lands: 3 });
  await g.resolveLevy();
  assert.equal(get(g.state, 'p1').lands, 3);
});

// -------------------------------------------------------------- orders (§4)

test('legal orders track what you can afford', () => {
  const g = makeGame();
  const p = get(g.state, 'p0');
  p.gold = 0;
  assert.deepEqual(legalOrders(g.state, p), [ORDER.HOLD]);
  p.gold = 1;
  assert.deepEqual(legalOrders(g.state, p), [ORDER.ATTACK, ORDER.SUPPORT]);
  p.gold = 2;
  assert.ok(legalOrders(g.state, p).includes(ORDER.PETITION));
  p.gold = 3;
  assert.ok(legalOrders(g.state, p).includes(ORDER.DEVELOP));
  p.fealty = -2; // pardon costs 3
  p.gold = 2;
  assert.ok(!legalOrders(g.state, p).includes(ORDER.PETITION));
});

test('committing escrows gold immediately and a turncoat change refunds it', () => {
  const g = makeGame();
  g.commit('p0', { order: ORDER.ATTACK, target: 'p1', gold: 4 });
  assert.equal(get(g.state, 'p0').gold, RULES.startGold - 4);
  assert.equal(get(g.state, 'p0').escrow, 4);
  g.recommit('p0', { order: ORDER.DEVELOP });
  assert.equal(get(g.state, 'p0').gold, RULES.startGold - RULES.developCost);
  assert.equal(g.state.commitments.p0.order, ORDER.DEVELOP);
});

test('develop takes a land from the pool; a depleted pool refunds the purse', async () => {
  const g = makeGame();
  g.state.neutralPool = 1;
  fillOrders(g, {
    p0: { order: ORDER.DEVELOP },
    p1: { order: ORDER.DEVELOP },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  const lands = [get(g.state, 'p0').lands, get(g.state, 'p1').lands].sort();
  assert.deepEqual(lands, [3, 4], 'only one land was available');
  assert.equal(g.state.neutralPool, 0);
  const golds = [get(g.state, 'p0').gold, get(g.state, 'p1').gold].sort((a, b) => a - b);
  assert.deepEqual(
    golds,
    [RULES.startGold - RULES.developCost, RULES.startGold],
    'the player who missed out gets their gold back',
  );
});

// -------------------------------------------------------------- combat (§5)

test('walls are 2 and ties favor the defender', async () => {
  const g = makeGame();
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 2 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p1').lands, 3, 'a tie is thrown back');
  assert.equal(get(g.state, 'p0').lands, 3);
});

test('strictly greater takes a land', async () => {
  const g = makeGame();
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 3 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p1').lands, 2);
  assert.equal(get(g.state, 'p0').lands, 4);
});

test('an attacker has no walls, and their titles can be stripped', async () => {
  const g = makeGame({ controllers: { p0: { spoils: { kind: 'title', title: 'marshal' } } } });
  set(g.state, 'p1', { titles: ['marshal'], gold: 10 });
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 1 },
    p1: { order: ORDER.ATTACK, target: 'p2', gold: 1 },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p1').titles.length, 0);
  assert.deepEqual(get(g.state, 'p0').titles, ['marshal']);
  assert.equal(get(g.state, 'p1').lands, 3, 'the title was taken instead of a land');
});

test('Marshal adds to attack and Warden adds to defense', async () => {
  const g = makeGame();
  set(g.state, 'p0', { titles: ['marshal'] });
  set(g.state, 'p1', { titles: ['warden'] });
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 3 }, // 3 + 1 = 4 vs 2 + 1 = 3
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p1').lands, 2);
});

test('a favorite punches down but not sideways or up', async () => {
  // p0 at +3 attacking p1 at 0 with 1 gold: 1 + 3 = 4 beats walls of 2.
  const down = makeGame();
  set(down.state, 'p0', { fealty: 3, titleGrants: { 2: true, 3: true } });
  fillOrders(down, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 1 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await down.resolvePhase();
  assert.equal(get(down.state, 'p1').lands, 2);

  // Same attack against an equal: no bonus, 1 against 2, thrown back.
  const level = makeGame();
  set(level.state, 'p0', { fealty: 3, titleGrants: { 2: true, 3: true } });
  set(level.state, 'p1', { fealty: 3, titleGrants: { 2: true, 3: true } });
  fillOrders(level, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 1 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await level.resolvePhase();
  assert.equal(get(level.state, 'p1').lands, 3);
});

test('support goes to the target\'s attack when they attack, else to their defense', async () => {
  const attackSide = makeGame();
  fillOrders(attackSide, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 1 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.SUPPORT, target: 'p0', gold: 2 }, // 1 + 2 = 3 > 2
    p3: { order: ORDER.PETITION },
  });
  await attackSide.resolvePhase();
  assert.equal(get(attackSide.state, 'p1').lands, 2);

  const defenseSide = makeGame();
  fillOrders(defenseSide, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 4 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.SUPPORT, target: 'p1', gold: 2 }, // defense 2 + 2 = 4, ties hold
    p3: { order: ORDER.PETITION },
  });
  await defenseSide.resolvePhase();
  assert.equal(get(defenseSide.state, 'p1').lands, 3);
});

test('Herald wins ties it is party to, attacking or defending', async () => {
  const attacking = makeGame();
  set(attacking.state, 'p0', { titles: ['herald'] });
  fillOrders(attacking, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 2 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await attacking.resolvePhase();
  assert.equal(get(attacking.state, 'p1').lands, 2);

  const defending = makeGame();
  set(defending.state, 'p1', { titles: ['herald'] });
  fillOrders(defending, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 2 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await defending.resolvePhase();
  assert.equal(get(defending.state, 'p1').lands, 3);
});

test('several attacks hit the same defense and each takes its own spoils', async () => {
  const g = makeGame();
  set(g.state, 'p1', { gold: 10 });
  set(g.state, 'p2', { gold: 10 });
  fillOrders(g, {
    p0: { order: ORDER.PETITION },
    p1: { order: ORDER.ATTACK, target: 'p0', gold: 3 },
    p2: { order: ORDER.ATTACK, target: 'p0', gold: 4 },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p0').lands, 1, 'both attacks got through');
  assert.equal(get(g.state, 'p1').lands, 4);
  assert.equal(get(g.state, 'p2').lands, 4);
});

// ------------------------------------------------- fealty and timing (§3, §4)

test('attacking a favorite costs 2 fealty, an outlaw pays 1', async () => {
  const g = makeGame();
  set(g.state, 'p1', { fealty: 2, titleGrants: { 2: true, 3: true } });
  set(g.state, 'p3', { fealty: -2 });
  set(g.state, 'p2', { gold: 8 });
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 1 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.ATTACK, target: 'p3', gold: 1 },
    p3: { order: ORDER.DEVELOP },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p0').fealty, -2);
  assert.equal(get(g.state, 'p2').fealty, 1);
});

test('a pardon lands before the swords do, so the raider gets no bounty', async () => {
  const g = makeGame();
  set(g.state, 'p1', { fealty: -2, gold: 5 });
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 1 },
    p1: { order: ORDER.PETITION }, // pardon: −2 -> 0
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p1').fealty, 0);
  assert.equal(get(g.state, 'p0').fealty, 0, 'p1 was neutral when the attack resolved');
});

test('petitioning to +2 grants a title in time to use it that same round', async () => {
  const g = makeGame({ controllers: { p0: { title: 'marshal' } } });
  set(g.state, 'p0', { fealty: 1, gold: 6 });
  fillOrders(g, {
    p0: { order: ORDER.PETITION },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.deepEqual(get(g.state, 'p0').titles, ['marshal']);
  assert.equal(get(g.state, 'p0').titleGrants[2], true);
});

test('each fealty threshold grants a title only once, ever', async () => {
  const g = makeGame({ controllers: { p0: { title: (r) => r.available[0] } } });
  set(g.state, 'p0', { fealty: 2, titleGrants: { 2: true, 3: false }, titles: ['warden'] });
  fillOrders(g, {
    p0: { order: ORDER.PETITION },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p0').fealty, 3);
  assert.equal(get(g.state, 'p0').titles.length, 2);

  // Drop back down and climb again: no third title.
  set(g.state, 'p0', { fealty: 2, gold: 10 });
  g.state.commitments = {};
  fillOrders(g, {
    p0: { order: ORDER.PETITION },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p0').titles.length, 2);
});

// ---------------------------------------------------------- usurpation (§5)

test('a winning coalition crowns its largest contributor', async () => {
  const g = makeGame({ tuning: { commitCap: null } });
  g.state.deck = [CARD.TAX];
  const need = crownStrength(g.state) + 1; // must beat it outright
  const big = Math.ceil(need / 2) + 1;
  const small = need - big + 1;
  set(g.state, 'p0', { gold: big });
  set(g.state, 'p1', { gold: small });
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: CROWN, gold: big },
    p1: { order: ORDER.ATTACK, target: CROWN, gold: small },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.deepEqual(g.state.winner, { playerIds: ['p0'], how: 'usurp' });
});

test('equal contributions end in civil war, not a coronation', async () => {
  const g = makeGame();
  g.state.deck = [CARD.TAX]; // strength 5
  set(g.state, 'p0', { gold: 4 });
  set(g.state, 'p1', { gold: 4 });
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: CROWN, gold: 4 },
    p1: { order: ORDER.ATTACK, target: CROWN, gold: 4 },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(g.state.winner, null);
  assert.equal(get(g.state, 'p0').fealty, -3);
  assert.equal(get(g.state, 'p1').fealty, -3);
});

test('a failed coup casts every conspirator down and takes a land each', async () => {
  const g = makeGame();
  g.state.deck = [CARD.TAX, CARD.TAX, CARD.TAX]; // strength 7
  set(g.state, 'p0', { gold: 3 });
  set(g.state, 'p1', { gold: 3 });
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: CROWN, gold: 3 },
    p1: { order: ORDER.ATTACK, target: CROWN, gold: 3 },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(g.state.winner, null);
  for (const pid of ['p0', 'p1']) {
    assert.equal(get(g.state, pid).fealty, -3);
    assert.equal(get(g.state, pid).lands, 2);
  }
  assert.equal(g.state.crownLands, 2);
});

test('support for the Crown can hold the throne', async () => {
  const g = makeGame();
  g.state.deck = [CARD.TAX]; // strength 5
  set(g.state, 'p0', { gold: 6 });
  set(g.state, 'p2', { gold: 6 });
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: CROWN, gold: 6 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.SUPPORT, target: CROWN, gold: 2 }, // defense 7 vs 6
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(g.state.winner, null);
  assert.equal(get(g.state, 'p0').fealty, -3);
});

test('no punching-down bonus applies against the Crown', async () => {
  const g = makeGame();
  g.state.deck = [CARD.TAX]; // strength 5
  set(g.state, 'p0', { gold: 5, fealty: 3, titleGrants: { 2: true, 3: true } });
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: CROWN, gold: 5 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(g.state.winner, null, '5 against 5 is not strictly greater');
});

test('a failed coup does not shield the conspirator from their neighbours', async () => {
  const g = makeGame();
  g.state.deck = [CARD.TAX, CARD.TAX, CARD.TAX]; // strength 7
  set(g.state, 'p0', { gold: 3 });
  set(g.state, 'p1', { gold: 3 });
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: CROWN, gold: 3 },
    p1: { order: ORDER.ATTACK, target: 'p0', gold: 1 }, // p0's walls are down
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p0').lands, 1, 'one land to the Crown, one to p1');
  assert.equal(get(g.state, 'p1').lands, 4);
});

// ------------------------------------------------------------- income (§3.4)

test('income pays per land, plus the neutral granary and the Steward', () => {
  const g = makeGame();
  set(g.state, 'p0', { lands: 4, fealty: 0, gold: 0 });
  set(g.state, 'p1', { lands: 2, fealty: 2, gold: 0 });
  set(g.state, 'p2', { lands: 3, fealty: -3, gold: 0, titles: ['steward'] });
  set(g.state, 'p3', { lands: 1, fealty: 1, gold: 0 });
  g.incomeStep();
  assert.equal(get(g.state, 'p0').gold, 5);
  assert.equal(get(g.state, 'p1').gold, 2);
  assert.equal(get(g.state, 'p2').gold, 4);
  assert.equal(get(g.state, 'p3').gold, 2);
});

// ------------------------------------------------------------ victory (§8)

test('the deck running out crowns the highest fealty, breaking ties on land then gold', () => {
  const g = makeGame();
  set(g.state, 'p0', { fealty: 1, lands: 3, gold: 9 });
  set(g.state, 'p1', { fealty: 2, lands: 2, gold: 1 });
  set(g.state, 'p2', { fealty: 2, lands: 3, gold: 0 });
  set(g.state, 'p3', { fealty: 0, lands: 9, gold: 9 });
  g.inherit();
  assert.deepEqual(g.state.winner, { playerIds: ['p2'], how: 'inherit' });
});

test('a dead heat crowns co-rulers', () => {
  const g = makeGame();
  for (const pid of ['p0', 'p1', 'p2', 'p3']) set(g.state, pid, { fealty: 0, lands: 3, gold: 5 });
  g.inherit();
  assert.equal(g.state.winner.playerIds.length, 4);
});

// ----------------------------------------------------- table talk & turncoat

test('gold can be given away, but escrowed gold cannot', () => {
  const g = makeGame();
  assert.equal(g.gift('p0', 'p1', 3), true);
  assert.equal(get(g.state, 'p0').gold, RULES.startGold - 3);
  assert.equal(get(g.state, 'p1').gold, RULES.startGold + 3);
  g.commit('p0', { order: ORDER.ATTACK, target: 'p1', gold: RULES.startGold - 3 });
  assert.equal(g.gift('p0', 'p1', 1), false, 'nothing left outside the war chest');
});

test('an outlaw peeks, earns a token and may spend it', async () => {
  const g = makeGame({
    controllers: {
      p0: {
        peekChoice: 'order',
        peekTarget: 'p1',
        turncoat: { action: 'change' },
        order: (req) => (req.reason === 'turncoat'
          ? { order: ORDER.DEVELOP }
          : { order: ORDER.ATTACK, target: 'p1', gold: 1 }),
      },
    },
  });
  set(g.state, 'p0', { fealty: -2, gold: 6 });
  g.grantTurncoatTokens();
  assert.equal(get(g.state, 'p0').turncoat, 1, 'the token arrives as the round opens');
  fillOrders(g, {
    p0: { order: ORDER.ATTACK, target: 'p1', gold: 1 },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.peekPhase();
  assert.equal(g.state.commitments.p0.order, ORDER.DEVELOP);
  assert.deepEqual(Object.keys(g.state.knowledge.p0.orders), ['p1']);
});

test('an outlaw at −3 sees both a rival order and the top card', async () => {
  const g = makeGame({ controllers: { p0: { peekTarget: 'p2' } } });
  set(g.state, 'p0', { fealty: -3, gold: 6 });
  fillOrders(g, {
    p0: { order: ORDER.DEVELOP },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.peekPhase();
  assert.equal(g.state.knowledge.p0.topCard, g.state.deck[0]);
  assert.ok(g.state.knowledge.p0.orders.p2);
});

test('a turncoat token can be traded away and spent by whoever holds it', async () => {
  const g = makeGame({
    controllers: {
      p1: {
        turncoat: { action: 'change' },
        order: (req) => (req.reason === 'turncoat' ? { order: ORDER.DEVELOP } : { order: ORDER.PETITION }),
      },
    },
  });
  set(g.state, 'p0', { fealty: -2, gold: 6, turncoat: 1 });
  fillOrders(g, {
    p0: { order: ORDER.DEVELOP },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  // The outlaw sells the token before the change window opens.
  const { settleDeal, emptyGoods } = await import('../src/engine/deals.js');
  settleDeal(g, { transfers: [{ from: 'p0', to: 'p1', goods: { ...emptyGoods(), turncoat: 1 } }] });
  assert.equal(get(g.state, 'p0').turncoat, 0);
  assert.equal(get(g.state, 'p1').turncoat, 1);

  await g.peekPhase();
  assert.equal(g.state.commitments.p1.order, ORDER.DEVELOP, 'the buyer spent it');
  assert.equal(get(g.state, 'p1').turncoat, 0);
  assert.equal(g.state.commitments.p0.order, ORDER.DEVELOP, 'the seller keeps their own order');
});

// ------------------------------------------------------ ransom module (§9)

test('ransom steals gold and reads the target\'s band', async () => {
  const g = makeGame({ options: { ransom: true } });
  set(g.state, 'p1', { fealty: 2, gold: 5, titleGrants: { 2: true, 3: true } });
  set(g.state, 'p3', { fealty: -2, gold: 5 });
  fillOrders(g, {
    p0: { order: ORDER.RANSOM, target: 'p1' },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.RANSOM, target: 'p3' },
    p3: { order: ORDER.DEVELOP },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p0').gold, RULES.startGold + RULES.ransomTake);
  assert.equal(get(g.state, 'p0').fealty, -2, 'the crown protects its own');
  assert.equal(get(g.state, 'p2').fealty, 1, 'bounty hunting pays');
  assert.equal(get(g.state, 'p0').ransomUsed, true);
});

test('ransoming the Crown pays 5 gold and outlaws you', async () => {
  const g = makeGame({ options: { ransom: true } });
  fillOrders(g, {
    p0: { order: ORDER.RANSOM, target: CROWN },
    p1: { order: ORDER.PETITION },
    p2: { order: ORDER.PETITION },
    p3: { order: ORDER.PETITION },
  });
  await g.resolvePhase();
  assert.equal(get(g.state, 'p0').gold, RULES.startGold + RULES.ransomCrownGold);
  assert.equal(get(g.state, 'p0').fealty, -3);
});

test('ransom is once per game', () => {
  const g = makeGame({ options: { ransom: true } });
  const p = get(g.state, 'p0');
  assert.ok(legalOrders(g.state, p).includes(ORDER.RANSOM));
  p.ransomUsed = true;
  assert.ok(!legalOrders(g.state, p).includes(ORDER.RANSOM));
});

// ------------------------------------------------------- the open deal (§3)

/** A game mid-round, when the deal table is open. */
const openTable = (opts) => {
  const g = makeGame(opts);
  g.state.phase = 'commit';
  return g;
};

test('an open deal settles only when it balances and everyone accepts', async () => {
  const g = openTable();
  set(g.state, 'p0', { gold: 10, lands: 3 });
  set(g.state, 'p1', { gold: 4, lands: 3 });

  await g.setDealTerms('p0', { offers: { gold: 6 }, takes: { lands: 1 } });
  await g.setDealTerms('p1', { offers: { lands: 1 }, takes: { gold: 6 } });

  let res = await g.acceptDeal('p0');
  assert.equal(res.settled, false, 'one signature is not a bargain');
  assert.deepEqual(res.waiting, ['Roderic of Thornfell']);

  res = await g.acceptDeal('p1');
  assert.equal(res.settled, true);
  assert.equal(get(g.state, 'p0').gold, 4);
  assert.equal(get(g.state, 'p0').lands, 4);
  assert.equal(get(g.state, 'p1').gold, 10);
  assert.equal(get(g.state, 'p1').lands, 2);
  assert.equal(g.state.deals.length, 1);
});

test('a deal that does not balance never settles', async () => {
  const g = openTable();
  await g.setDealTerms('p0', { offers: { gold: 3 }, takes: {} });
  await g.setDealTerms('p1', { offers: {}, takes: { gold: 5 } });
  await g.acceptDeal('p0');
  const res = await g.acceptDeal('p1');
  assert.equal(res.settled, false);
  assert.match(res.reason, /Gold does not balance/);
  assert.equal(get(g.state, 'p1').gold, g.state.tuning.startGold);
});

test('changing any term withdraws every acceptance', async () => {
  const g = openTable();
  set(g.state, 'p0', { gold: 10 });
  await g.setDealTerms('p0', { offers: { gold: 4 }, takes: {} });
  await g.setDealTerms('p1', { offers: {}, takes: { gold: 4 } });
  await g.acceptDeal('p0');
  assert.deepEqual(g.state.dealTable.accepted, ['p0']);
  await g.setDealTerms('p0', { offers: { gold: 5 }, takes: {} });
  assert.deepEqual(g.state.dealTable.accepted, [], 'the signature is void');
});

test('nobody can put up what they do not hold', async () => {
  const g = openTable();
  await g.setDealTerms('p0', { offers: { gold: 999 }, takes: {} });
  await g.setDealTerms('p1', { offers: {}, takes: { gold: 999 } });
  await g.acceptDeal('p0');
  const res = await g.acceptDeal('p1');
  assert.equal(res.settled, false);
  assert.match(res.reason, /has only/);
});

test('a three-cornered pot settles in one move', async () => {
  const g = openTable();
  set(g.state, 'p0', { gold: 10 });
  set(g.state, 'p1', { lands: 3 });
  set(g.state, 'p2', { titles: ['herald'] });
  await g.setDealTerms('p0', { offers: { gold: 8 }, takes: { titles: ['herald'] } });
  await g.setDealTerms('p1', { offers: { lands: 1 }, takes: { gold: 8 } });
  await g.setDealTerms('p2', { offers: { titles: ['herald'] }, takes: { lands: 1 } });
  for (const pid of ['p0', 'p1', 'p2']) await g.acceptDeal(pid);
  assert.deepEqual(get(g.state, 'p0').titles, ['herald']);
  assert.equal(get(g.state, 'p1').gold, g.state.tuning.startGold + 8);
  assert.equal(get(g.state, 'p2').lands, g.state.tuning.startLands + 1);
  assert.deepEqual(get(g.state, 'p2').titles, []);
});

test('deals shut once the orders are resolving', async () => {
  const g = makeGame();
  g.state.phase = 'resolve';
  const res = await g.acceptDeal('p0');
  assert.equal(res.settled, false);
  assert.match(res.reason, /already resolving/);
});
