# The King's Graces

A playable web implementation of *The King's Graces* — a four-player game of
medieval noble politics. Serve the crown, grow fat, or vanish into outlawry,
then take the throne before someone else inherits it.

The rules are in [RULES.md](RULES.md): the v0.1 sheet, an appendix listing every
edge case it left open and how this build resolves them, and the tuned constants
this build ships with.

## Running it

No dependencies, no build step. The app is plain ES modules, so it needs to be
served over http rather than opened from the filesystem.

```sh
npm start                  # http://localhost:5173
npm test                   # 56 rules, bot and balance tests
node tools/simulate.js     # the bot tournament harness the constants came from
```

## Playing

Pick who sits in each of the four seats — any mix of humans and bots. One human
against three bots is the default; four humans is hot seat, with a "pass the
table" screen between private decisions; four bots lets you watch a game play
itself.

Three things are worth knowing before your first game:

- **Attacking drops your own walls to zero.** An army in the field cannot hold a
  gate, and a defender with no walls can have a *title* taken, not just a land.
- **No single order can carry more than 6 gold.** You cannot buy the throne out
  of your own purse. A usurpation needs somebody else's sword.
- **Gold given away is really gone; everything else is words.** Each round opens
  with table talk. You can send gold to anyone and put a proposal to a bot —
  join my coup, hit that one, reinforce me, leave me alone — and bots will put
  proposals to you. A bot accepts when the bribe genuinely makes that its best
  line, and may still walk away from the promise when orders are sealed. The
  treacherous personalities discount a promise hardest once the gold is banked.

Support aimed at someone attacking the Crown counts toward *their* strength, so
a bought sword crowns the buyer, not the seller. That is the whole endgame.

## What the constants are, and how they got that way

Two presets ship. **v0.1** is the rules sheet exactly as written — the reference
the test suite checks against. **Tuned** is the default, and the difference is:

| | v0.1 | Tuned | Why |
|---|---|---|---|
| Crown strength constant | 4 | 6 | The crown decays 18 → 6 instead of 16 → 4 |
| Most gold in one order | uncapped | 6 | No purse buys the throne alone; a coup needs a conspiracy |
| Tax (favorite/neutral/outlaw) | 1 / 2 / 3 | 2 / 3 / 4 | Gold has to leave the table as fast as it arrives |
| Levy demand | 2 | 4 | As above, and refusing becomes a real choice |
| Petition | 2 | 3 | Standing is the win condition; it should not be the cheapest thing on the board |
| Pardon | 3 | 4 | Kept one step above a petition |
| Crown deck | 4/4/3/1 tax/levy/favor/purge | 5/4/2/1 | Fewer Favors: they paid the leader for leading |

Everything else — walls, titles, the punching-down bonus, the standing cost of
attacking, land income, the neutral granary, starting position — is unchanged
from v0.1. Each was tried and each was better where the sheet had it.

Measured over 4,000 bot games per preset, four seats drawn from five committed
strategies:

| | v0.1 | Tuned |
|---|---|---|
| Games ending in usurpation | 86% | 44% |
| Games ending in inheritance | 14% | 56% |
| Mean ending round (of 12) | 8.5 | 11.2 |
| Battles per game | 5.9 | 14.2 |
| Coup attempts per game | 2.8 | 1.5 |
| Coups that succeed | 31% | 30% |
| Best/worst strategy win rate | 31% / 16% | 32% / 17% |
| Seat win rates | 23/26/26/26% | 25/24/25/27% |

The headline is the first two rows. Under v0.1 the crown deck almost never ran
out: the table out-earned the decaying crown by about round six and whoever had
hoarded hardest walked up and took the throne, so the inheritance road — half
the design — was decoration. Under the tuned constants both roads are live, the
game uses eleven of its twelve rounds, and there is more than twice as much
fighting along the way.

### How to retune it yourself

`tools/simulate.js` runs bot tournaments over any constants you like.

```sh
node tools/simulate.js --preset tuned -n 2000          # one preset in detail
node tools/simulate.js --preset tuned --sweep crownBase=4,6,8,10
node tools/simulate.js --search --grid 'crownBase=6|8,commitCap=6|8,levyCost=3|4'
```

It scores each configuration against a target profile — both roads live, no
strategy dead or dominant, the deck mostly used, coups a real gamble, no order
eating the whole round — and prints what each configuration is failing at. The
`--search` mode grid-searches and ranks. Every number in the table above came
out of it, and `test/balance.test.js` asserts the tuned preset still hits those
targets, so the claims are checked rather than remembered.

The setup screen exposes the same constants, so you can play a variant without
touching code.

## What tuning turned up

**Three bugs, found by measurement rather than by reading.**

*Seat one won 43% of games.* Two causes, both invisible without a tournament.
Titles and the last land in the pool were awarded in seat order when several
players qualified at once, so the lowest seat took first pick — including the
Herald, which then won every tie in the game. And the bots' tie-break jitter was
keyed off seat number, which is a standing advantage rather than noise. Contested
claims are now shuffled and the jitter is keyed off a per-game salt. Seat win
rates are 25/24/25/27%.

*Commitments were not simultaneous.* Gold is escrowed when an order is sealed,
so a player asked later in the round could read everyone else's war chest off
the board by watching their purse shrink. Other players' purses now look
untouched until the reveal.

*Bots petitioned at +3*, where it does nothing, burning 2 gold a round. That one
inflated the petition share of all orders by about eight points and made the
climbing strategy look worse than it is.

**Two things the bots can't do, which the numbers should be read against.**
Bots only ever use Support to shield the throne or to honour a bargain, so
support-between-houses is under-represented in every table above. And the outlaw
band's toolkit is *information* — a peek at a sealed order, a change of orders
you can sell — which a heuristic bot converts into value far worse than a person
does. The shadow strategy's 17% is the weakest of the five, and some of that gap
is the measuring instrument rather than the game. Head to head against a
free-playing bot it comes out 24% to 26%, which is close to even.

**One thing that is genuinely true of the design.** Nothing lowers a rival's
fealty. Attacking a favorite costs *you* two standing and leaves theirs
untouched, so a runaway heir cannot be dragged down — only out-petitioned or
usurped. That makes the crown's strength the single most important number in the
game, because it is the only thing standing between a leader and the throne.

## Layout

```
index.html          shell
styles.css
server.js           zero-dependency static server
src/engine/         the rules; knows nothing about the DOM
  constants.js      names, titles, card text
  tuning.js         every number the game is made of, plus the presets
  state.js          setup, deck construction, redacted per-player views
  game.js           the round loop, resolution, combat, victory
  ai.js             bot seat controllers: personalities and doctrines
  diplomacy.js      gifts, bribes and pacts
  rng.js            seeded PRNG, so any game can be replayed
src/ui/             the browser client
tools/              tournament core and the CLI over it
test/               rules, bot and balance suites
```

The engine drives the whole game and asks each seat's *controller* for decisions
through one async interface:

```js
controller.decide(request, view) -> Promise<answer>
```

The UI plugs a human controller in that resolves a promise from a form; the bots
plug in a heuristic; tests plug in scripted answers. A controller only ever sees
`view`, a redacted state with other players' sealed orders, their committed
gold, other people's private deals, and the crown deck's contents removed — bots
cannot cheat, because there is nothing to cheat with.

Bots have a *personality* (how greedy, how treacherous, how much nerve) and a
*doctrine* (a strategy they have committed to: climber, granary, shadow, raider,
bulwark, or a free-playing opportunist). Doctrines exist mostly so the harness
can put whole strategies against each other, which is what "balanced" is
measured against.

Games are seeded. The same seed with the same seats and settings replays the
same game exactly, which is what makes every table above reproducible.
