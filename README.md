# The King's Graces

A playable web implementation of *The King's Graces* — a game of medieval noble
politics for **2 to 6 players**. Serve the crown, grow fat, or vanish into
outlawry, then take the throne before someone else inherits it.

[RULES.md](RULES.md) is the ruleset in play, with an appendix of rulings and a
note on what changed from the original v0.1 sheet and why.

## Running it

No dependencies, no build step. The app is plain ES modules, so it needs to be
served over http rather than opened from the filesystem.

```sh
npm start                  # http://localhost:5173
npm test                   # 61 rules, bot and balance tests
node tools/simulate.js     # the bot tournament harness the constants came from
```

## Playing

Choose a table of 2 to 6 and pick who sits in each seat — any mix of humans and
bots. One human against three bots is the default; all-human is hot seat, with a
"pass the table" screen between private decisions; all-bot lets you watch.

Three things are worth knowing before your first game:

- **Attacking drops your own walls to zero.** An army in the field cannot hold a
  gate, and a defender with no walls can have a *title* taken, not just a land.
- **No order may carry more than 6 gold.** You cannot buy the throne out of your
  own purse. A usurpation needs somebody else's sword — and support aimed at an
  attacker counts toward *their* strength, so a bought sword crowns the buyer.
- **Gold given away is really gone; everything else is words.** Each round opens
  with table talk. Send gold to anyone, put a proposal to a bot — join my coup,
  hit that one, reinforce me, leave me alone — and bots will put proposals to
  you. A bot accepts when the bribe genuinely makes that its best line, and may
  still walk away when orders are sealed. The treacherous personalities discount
  a promise hardest once the gold is banked.

The setup screen exposes the constants, so you can play a variant without
touching code.

## How the constants got that way

`tools/simulate.js` runs bot tournaments over any constants you like. Four seats
are drawn from five *doctrines* — committed strategies rather than personality
flavours — so a doctrine's win rate answers "is this line viable?".

```sh
node tools/simulate.js -n 2000                 # four players, in detail
node tools/simulate.js --counts                # every table size, side by side
node tools/simulate.js --sweep crownBase=4,6,8
node tools/simulate.js --search --grid 'commitCap=5|6|7,levyCost=3|4|5'
node tools/title-value.js -n 600                # causal value of each title
```

It scores each configuration against a target profile — both roads live, no
strategy dead or dominant, no title deciding the game, the deck mostly used,
coups a real gamble, nobody priced out of their own turn — and prints what each
configuration is failing at. `test/balance.test.js` asserts the shipped rules
still hit those targets, so the claims below are checked rather than remembered.

Where it lands, across 1,200 games per table size:

| Players | Ends in usurpation | Mean ending round (of 12) | Battles/game | Best–worst strategy |
|---|---|---|---|---|
| 2 | 33% | 11.3 | 6.0 | 28pt |
| 3 | 66% | 10.9 | 7.9 | 20pt |
| 4 | 69% | 10.3 | 9.6 | 13pt |
| 5 | 62% | 10.1 | 10.9 | 6pt |
| 6 | 47% | 10.5 | 12.0 | 6pt |

Seat win rates sit within a couple of points of the 1/players baseline at every
size. Doctrine spread is widest at small tables, where each seat's share is
larger and the matchup is closer to rock-paper-scissors — two-handed play is the
roughest configuration and honestly always will be, since a game about
conspiracy has nobody to conspire with.

### What the measurements say, and what they cannot

**A title is worth less than it looks.** Saying "Herald holders win 2.1× the
baseline" measures a correlation: titles are granted at +2 and +3, so their
holders are the houses already climbing. `tools/title-value.js` runs the causal
version — gift one title at setup, play the identical game with the same seed
and the same bots, compare — and the effect is far smaller and far flatter:

| | Marshal | Herald | Warden | Chancellor | Spymaster | Steward |
|---|---|---|---|---|---|---|
| Win rate over a 26.5% baseline | +11.8pt | +7.2pt | +6.5pt | +2.0pt | +1.3pt | −0.2pt |

**Titles almost never change hands: 0.06 steals per game.** You can only take a
title from a house whose walls were down, meaning one that attacked this round,
and title-holders are favorites who rarely attack. So the counterweight the
design intends — an advantage becomes your opponent's the moment it is stolen,
and defending it costs you the land and gold you were not building — is
currently unreachable. That is the thing worth fixing, not the titles' numbers.

**Being a favorite ought to be dangerous, and against these bots it is not.**
Favor pays every favorite, which makes climbing lucrative, and the bots let it
happen: they do not gang up on whoever is getting fat under the crown. At a real
table two or three houses would take that land off you every round, and the
jealousy of the court is supposed to make the favorite band as risky as the
outlaw band — the same mechanic pointing the other way. Read the climbing lane's
win rate with that in mind; it is measuring a table that does not retaliate.

**Crown strength is the single most important number.** Too weak and the game is
nothing but coups; too strong and the coup stops being a check on the leader,
which matters because nothing in the game lowers a rival's fealty. It is flat,
because growing it with the table shut usurpation down to 1% at five and six
players — a bigger table already supplies more houses who might rally to the
throne.

### Three bugs the tournaments found

None of these were visible by reading the code.

*Seat one won 43% of games.* Titles and the last land in the pool were awarded
in seat order when several players qualified at once, so the lowest seat took
first pick — including the Herald, which then won every tie in the game. The
bots' tie-break jitter was also keyed off seat number, which is a standing
advantage rather than noise. Contested claims are now shuffled and the jitter is
keyed off a per-game salt.

*Commitments were not simultaneous.* Gold is escrowed when an order is sealed,
so anyone asked later in the round could read the table's war chests by watching
purses shrink. Other purses now look untouched until the reveal.

*Bots petitioned at +3*, where it does nothing, and could commit a hopeless
march on the Crown when no other order was affordable — the candidate list came
back with exactly one entry.

### What the numbers do not cover

The bots cannot bargain, never bluff, and do not gang up. Support between houses
is under-represented because they only ever use it to shield the throne or
honour a deal. The outlaw band's payoff is *information* — a peek at a sealed
order, a turncoat token you can sell — which a scoring function converts far
worse than a person does. Nobody punishes a runaway favorite. And an advantage
is only worth what you can do with it, which is precisely the part a blunt
instrument cannot measure.

That is what `tools/agent-harness.js` is for: it puts agents in the seats, each
with the rules, a strategy nudge and a briefing of what that seat is entitled to
see, answering through the same engine the app runs on so they cannot make an
illegal move. The heuristic bots stay as a regression instrument — a thousand
games a second for crashes, seat fairness and dead lanes — not as a balance one.

## Layout

```
index.html          shell
styles.css
server.js           zero-dependency static server
src/engine/         the rules; knows nothing about the DOM
  tuning.js         every number the game is made of
  constants.js      names, titles, card text
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

Games are seeded. The same seed with the same seats and settings replays the
same game exactly, which is what makes every table above reproducible.
