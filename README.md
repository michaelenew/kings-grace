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
npm test                   # 93 rules, bot, trust and balance tests
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
- **Your word is free and it is not free.** You can give any house an
  undertaking at any time. Nothing binds you to it and no bargain waits on it —
  but it is given in open court, and when the orders turn over everyone sees
  whether it held. Break it, or put a sword in a house you have just bargained
  with, and the whole table thinks less of you. A house that thinks little of
  you wants a much better bargain before it signs, and past a point will not
  deal with you at all.
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
node tools/simulate.js --search --grid 'commitCap=5|6|7,tax=3|4|5'
node tools/title-value.js -n 600                # causal value of each title
node tools/order-diary.js -n 300                # what each round looks like inside
```

It scores each configuration against a target profile — both roads live, no
strategy dead or dominant, no title deciding the game, the deck mostly used,
coups a real gamble, nobody priced out of their own turn — and prints what each
configuration is failing at. `test/balance.test.js` asserts the shipped rules
still hit those targets, so the claims below are checked rather than remembered.

Where it lands, across 600 games per table size:

| Players | Ends in usurpation | Mean ending round (of 10) | Battles/game | Doctrine spread |
|---|---|---|---|---|
| 3 | 61% | 9.6 | 5.6 | 28pt |
| 4 | 47% | 9.7 | 7.4 | 18pt |
| 5 | 39% | 9.7 | 8.8 | 21pt |
| 6 | 34% | 9.7 | 10.3 | 22pt |

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

**Theft in the field caught up once war paid.** It sat at 0.06 a game while a
raid was worth one field; with the three-move horizon and 4 gold of plunder it
is **1.19 a game**, slightly ahead of the 0.86 taken by grant. Both roads to a
coronet are now live.

**Being a favorite ought to be dangerous, and against these bots it is not.**
Favor pays every favorite, which makes climbing lucrative, and the bots let it
happen: they do not gang up on whoever is getting fat under the crown. At a real
table two or three houses would take that land off you every round, and the
jealousy of the court is supposed to make the favorite band as risky as the
outlaw band — the same mechanic pointing the other way. Read the climbing lane's
win rate with that in mind; it is measuring a table that does not retaliate.

**The horizon was the whole problem.** Everything the bots valued used to be
priced over the entire remaining deck: a field bought on round two was worth
eleven harvests. That made building and climbing overwhelmingly correct from the
first turn and made fighting — a cost now for a gain now — look like a waste.
`src/engine/horizon.js` prices things over about three moves instead, and it
moved more than every constant in the game put together: battles 5.5 -> 7.3,
outlaw band occupancy 8% -> 18%, doctrine spread 33pt -> 25pt. Adding plunder on
top took battles to 8.9 and the spread to 12pt.

**The back half was the problem, so there is less of it.** The deck went from
twelve cards to ten — 3 Tax, 4 Levy, 3 Favor — which took the enjoyment score
from 72 to 79 and put a winner's building turns on target for the first time,
without changing a single order's text. Which card comes out matters more than
how many: dropping a Levy instead of a Tax costs nine points of affordability,
because the Tax is the squeeze and the Levy is what opens gates.

**Land had to be recycled and there had to be more of it, and neither worked
alone.** Failed taxes are now paid in land, and those fields go back to the
unclaimed pool rather than out of play; the pool itself went from 2 fields per
player to 3. Measured apart: the land-tax improves a winner's mix and starves
the board (priced-out turns 17% -> 26%); the bigger pool fixes affordability and
does nothing for the mix. Together, enjoyment 69 -> 72 and gold at the end lands
on 10. The full table is in RULES.md Appendix B, along with a note on the
double-counted penalty that made the comparison come out backwards the first
time.

**The houses do not pull apart on standing.** The leader finishes 1.5 land and 0.5 fealty
ahead of the median at four players, and the fealty gap *peaks* around round 5
and then shrinks — everybody arrives at the top of the track together and the
throne comes down to a tie-break nobody can move. That is why war had to be made
to pay: a raid is the only thing that can break a tie, and it was paying one
field for a commitment of three or more gold.

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

*The bots could not see an open gate.* `estimateDefense` assumed walls were up
at 70% everywhere, so a house that had answered the Crown's levy — publicly
undefended, before anyone sealed an order — looked exactly as hard to crack as
one behind its walls. That is most of why the levy opened a window nobody
climbed through. They also valued winning a battle at "one land" flat, so the
richest, most decorated house on the board scored no better as a target than a
pauper, and `positionScore` priced every coronet the same whether it was the
Marshal or the Spymaster.

*The starvation metric counted the wrong thing.* It flagged any turn offering
two orders or fewer, so once the levy started taking the Attack order away it
read 15% starved — of houses who were, in fact, rich. Being short of coin is
starvation; having your host away with the Crown is a choice. It now measures
whether you can afford an appeal or a develop, and reads 1%.

### What the numbers do not cover

They can now give their word and break it — about 30 undertakings a game, kept
just under half the time — and they hold opinions of each other that gate who
will deal with whom. Broken down by kind, the numbers are their own argument:
a promise to stand down is kept 98% of the time and a promise to march on the
Crown together is kept **10%**, because the coup logic refuses to march when
marching would crown somebody else. That is not a bug in the arithmetic. It is
the most realistic thing they do.

What they still cannot do: bluff, or gang up. Support between houses
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
  horizon.js        how far ahead a house is supposed to be thinking
  deals.js          one-shot bargains
  dealtable.js      the open pot: offers, takes, acceptances
  trust.js          the ledger: words given, deeds done, opinions held
  briefing.js       the board and the question, in prose, for an agent
  constants.js      names, titles, card text
  state.js          setup, deck construction, redacted per-player views
  game.js           the round loop, resolution, combat, victory
  ai.js             bot seat controllers: personalities and doctrines
  diplomacy.js      gifts, bribes and pacts
  rng.js            seeded PRNG, so any game can be replayed
src/ui/             the browser client
tools/              tournament core, the CLI over it, the causal title test,
                    the per-round order diary, and the agent harness
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
