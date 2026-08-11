# The King's Graces

A playable web implementation of *The King's Graces* — a game of medieval noble
politics for **3 to 6 players**. Serve the crown, grow fat, or vanish into
outlawry, then take the throne before someone else inherits it.

[RULES.md](RULES.md) is the ruleset in play, with an appendix of rulings and a
note on what changed from the original v0.1 sheet and why.

## Running it

No dependencies, no build step. The app is plain ES modules, so it needs to be
served over http rather than opened from the filesystem.

```sh
npm start                  # http://localhost:5173
npm test                   # 79 rules, bot and balance tests
node tools/simulate.js     # the bot tournament harness the constants came from
```

## Playing

Choose a table of 3 to 6 and pick who sits in each seat — any mix of humans and
bots. One human against three bots is the default; all-human is hot seat, with a
"pass the table" screen between private decisions; all-bot lets you watch.

Three things are worth knowing before your first game:

- **Attacking drops your own walls to zero,** and so does answering the Crown's
  levy. An army in the field cannot hold a gate, and a defender with no walls can
  have a *title* taken, not just a land. The levy resolves before orders are
  sealed, so everyone can see whose gate is open before they pick a target.
- **A title is not yours to keep.** A grant at +2 or +3 can be spent on one
  somebody already holds, for 2 gold to the Crown. The first house to the Herald
  does not get to sit on it.
- **No order may carry more than 9 gold.** You cannot buy the throne out of your
  own purse. A usurpation needs somebody else's sword — and support aimed at an
  attacker counts toward *their* strength, so a bought sword crowns the buyer.
- **Deals are not a step.** The table is open from the royal card until the
  orders resolve. Each house sets what it is offering and what it is taking on
  its own tray; it settles the moment everything offered matches everything
  taken and every house involved has accepted. Touching any term withdraws every
  acceptance. Gold, land, titles and turncoat tokens move — nothing anybody says
  they will *do* is part of it.

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

Where it lands, across 600 games per table size:

| Players | Ends in usurpation | Mean ending round (of 12) | Battles/game |
|---|---|---|---|
| 3 | 28% | 11.8 | 3.3 |
| 4 | 39% | 11.7 | 4.3 |
| 5 | 31% | 11.6 | 5.2 |
| 6 | 28% | 11.7 | 5.8 |

Seat win rates sit within a couple of points of the 1/players baseline at every
size. Both roads to the throne stay open at every table size, which is the
headline the constants were chosen for.

### What the measurements say, and what they cannot

**A title is worth less than it looks.** Saying "Herald holders win 2.1× the
baseline" measures a correlation: titles are granted at +2 and +3, so their
holders are the houses already climbing. `tools/title-value.js` runs the causal
version — gift one title at setup, play the identical game with the same seed
and the same bots, compare — and the effect was far smaller even before titles
could be taken: +11.8pt for the Marshal rather than a multiple of the baseline.

**Then a title stopped being a thing you could bank, and the numbers collapsed
again.** Answering the Crown's levy now puts your walls down in public, and a
grant at +2 or +3 can be spent claiming a coronet somebody already wears. A
coronet changes hands about 2.5 times a game where it used to change hands 0.06
times. Re-measured over the same 400 seeds:

| | Warden | Herald | Marshal | Steward | Chancellor | Spymaster |
|---|---|---|---|---|---|---|
| Win rate over a 23.5% baseline | +4.0pt | +3.8pt | +3.3pt | +0.8pt | −0.3pt | −1.3pt |
| Still yours at the end | 76% | 44% | 29% | 94% | 83% | 99% |

The second row is the interesting one. Nobody bothers taking the Spymaster and
nobody is allowed to keep the Marshal — the table prices a title by how long you
get to hold it, and no title's text was touched to make that happen. The whole
spread narrowed from about 12 points to about 5.

**Theft in the field is still rare, though: 0.06 a game.** The levy opens the
gate and the bots do not walk through it, because striking a favorite costs 2
fealty and a bot will not pay that to rob a house it was not already fighting.
Every coronet that moves, moves by claim. Whether people play it that way is
exactly what the bots cannot tell you.

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
advantage rather than noise. Contested claims are now settled by precedence at
court — Herald, then standing, then land, then wealth, then a coin — and the
jitter is keyed off a per-game salt.

*Commitments were not simultaneous.* Gold is escrowed when an order is sealed,
so anyone asked later in the round could read the table's war chests by watching
purses shrink. Other purses now look untouched until the reveal.

*Bots petitioned at +3*, where it does nothing, and could commit a hopeless
march on the Crown when no other order was affordable — the candidate list came
back with exactly one entry.

*Everyone could read the next royal card.* The peeked-card field fell back to
the real top of the deck once orders were revealed, so an outlaw's peek leaked
to the whole table every round.

*The starvation metric counted the wrong thing.* It flagged any turn offering
two orders or fewer, so once the levy started taking the Attack order away it
read 15% starved — of houses who were, in fact, rich. Being short of coin is
starvation; having your host away with the Crown is a choice. It now measures
whether you can afford an appeal or a develop, and reads 1%.

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
  deals.js          one-shot bargains
  dealtable.js      the open pot: offers, takes, acceptances
  briefing.js       the board and the question, in prose, for an agent
  constants.js      names, titles, card text
  state.js          setup, deck construction, redacted per-player views
  game.js           the round loop, resolution, combat, victory
  ai.js             bot seat controllers: personalities and doctrines
  diplomacy.js      gifts, bribes and pacts
  rng.js            seeded PRNG, so any game can be replayed
src/ui/             the browser client
tools/              tournament core, the CLI over it, the causal title test,
                    and the agent harness
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
