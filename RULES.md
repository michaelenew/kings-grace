# The King's Graces

*A competitive game of medieval noble politics for 3–6 players. Serve the crown,
grow fat, or vanish into outlawry — then take the throne before someone else
inherits it.*

These are the rules in play. Every number here is a constant the app exposes on
its setup screen, and every one was chosen by the bot tournaments described in
the README. Where a number replaces one from the original v0.1 sheet, the reason
is in Appendix B.

---

## 1. Components & Setup

| Item | Quantity / Value |
|---|---|
| Players | 3–6 |
| Starting lands per player | 3 |
| Starting gold per player | 8 |
| Starting fealty per player | 0 |
| Neutral land pool | 3 per player |
| Crown deck | 10 cards (composition in §6) |
| Fealty track | −3 to +3 per player |
| Titles | 6 unique (list in §7) |

Land income: **each land you hold pays 1 gold** in the income step.

**Crown strength** at any moment = **round(11 − 1 × players + 1.4 × cards
remaining)** — at four players, 21 down to 7 as the deck empties.

The base is the floor the throne decays to on the last flip. It sat at 15 to
stop a lone rich house buying the crown with a shrug once gold was uncapped, but
that pushed the throne out of reach until the very last card: nobody came within
striking distance until the deck was spent. Eleven, with the steeper per-player
term below, brings the coup window forward — a house that breaks out early can
make a real pass at the throne around round seven, and usurpation stops waiting
for the final round.

The per-player term is negative, which **reverses** an earlier ruling in this
document that the crown must never weaken as the table grows. That ruling was an
instinct written before there was anything to measure it against. A bigger table
raises a bigger *crowd*, not a bigger coalition: more houses are free to throw
gold behind the Crown, and the largest-single-contributor rule gets harder to
satisfy as a conspiracy grows, so coups are attempted more often at a big table
and land less. A full point a house — up from a quarter — is what makes the
early breakout plausible rather than a curiosity, and the throne a big table has
to beat starts lower and falls faster. What the term must never do is *grow* with
the table: that shuts usurpation down almost entirely at five and six players.

---

## 2. Fealty Bands (the archetype system)

Fealty is a single track per player. Where you stand grants a passive. All band
effects and fealty consequences are evaluated **at resolution time**, not at
commitment time.

### Favorite (+2, +3) — the crown's sword
- Your attacks gain **+fealty** as bonus strength, but **only against targets whose fealty is below yours**. Punching up or sideways gets nothing. The crown is above everyone, so this bonus can never touch the crown, and it cannot be added to the crown's defense (the crown's strength already *is* its loyal armies).
- **Titles:** the first time you reach +2, choose one title. The first time you reach +3, choose a second. Two maximum. A grant may be spent on an **unclaimed** title, or on one **another house already holds** — the King gives what he has already given — in which case it costs **2 gold to the Crown**, because he does not want to make enemies of his friends. You keep what you hold, including after treason, until somebody takes it from you in the field (§5) or claims it with their own grant.

### Neutral (−1, 0, +1) — the granary
- **+1 gold** in every income step. Nobody's watching your fields.

### Outlaw (−2, −3) — the shadow
- **Turncoat token:** an outlaw takes one **turncoat token** as the round opens — but only when it holds none, so the shadow never hands you a second while you still hold the first. Tokens are goods, not rights: sell one at the deal table and the buyer gets everything it does. There is no limit on how many a house can *buy*, which is why a house at neutral standing can be sitting on several.
- **A token is what buys the whispers** (§3), both of them: the right to spy in espionage and the right to reseal in duplicity. No token, no peek, whatever your standing — and a house that buys one may spy with it.
- **Standing sets only how much you see.** With a token, an outlaw at −2 reads one thing; at −3, both a rival's order and the next royal card. A house above the outlaw band that holds a bought token reads one thing.
- The crown taxes you at the highest rate (§6).

---

## 3. Round Structure

One loop, five steps:

1. **Income.** The first thing every round, before the Crown acts: each land pays 1 gold, and a neutral gains +1. You carry the purse you just filled into the royal card, so a tax falls on rents already collected rather than on last round's leavings.
2. **The royal card.** Reveal the top crown card and resolve it immediately (§6). Outlaws take their turncoat token now.
3. **Sealed orders.** Every player secretly chooses one order (§4) and, where relevant, a hidden gold commitment and target.
4. **Whispers**, in two beats with the table open between them:
   1. **Espionage** — a turncoat token is the right to *look*. Whoever holds one reads a rival's sealed order or the next royal card (both, at −3). Looking does not spend the token.
   2. **Duplicity** — a token is also the right to *change your own sealed order*. Whoever holds one now may spend it to reseal. The house that spied and the house that reseals need not be the same one, because a token can change hands between the beats.
5. **Reveal & resolve.** All orders flip at once and settle in this **fixed order** — it is not the order they were sealed in, and it decides everything:
   1. **Appeals and pardons** — standing moves *first*, so every band effect (a favorite's punch-down, an outlaw's exposure) is already updated before anything else is worked out. A pardoned outlaw is a neutral by the time the swords land.
   2. **Develop** — land settles next, so a field bought this round cannot be looted the same round.
   3. **Support** — counted toward whoever it was aimed at, now that we know who is attacking.
   4. **Attacks and spoils** — resolved last, against the standing, land and support already fixed above.

The one-line version: **petition → develop → support → attack.**

**Deals are not a step.** The table is open from the moment the royal card turns
until the orders begin resolving. **One house builds the whole bargain** — who
gives what to whom, in as many legs as it likes, across any number of houses —
and puts it to the table. Because every leg moves goods *from* one house *to*
another, the pot is conserved by construction: it always nets to zero, nothing
is created or destroyed. The proposal is **public**, sitting in the middle of
the table for the whole court to read. The proposer accepts it by building it;
**every other house named simply accepts or rejects**. When all of them accept
it changes hands at once. A rejection by any of them — or the proposer pulling
it — sweeps the whole thing off the table, and a fresh proposal replaces
whatever stood before.

Gold, land, titles and turncoat tokens move. Nothing anybody says they will
*do* is part of a deal, and words bind nobody. Gold already committed to an
order this round is spent and cannot be traded.

---

## 4. Orders

Each player picks exactly one per round:

- **Attack [target]** — commit **as much gold as you hold** as troops. Target may be a player or the Crown. Committed gold is spent win or lose.
- **Support [target]** — commit **as much gold as you hold**. Adds that gold to the target's attack *or* defense this round (whichever situation arises). Supporting the Crown's defense adds gold only — no fealty bonus applies. **The target may be yourself**: digging in puts the gold on your own walls, and because orders are sealed nobody can see that you did it.
- **Appeal** — pay 2 gold, gain +1 fealty. **Band read for outlaws:** an outlaw's Appeal is a **pardon** — pay 3 gold, jump directly to fealty 0. Because appeals resolve before attacks, a pardoned outlaw is no longer an outlaw when the swords land.
- **Develop** — pay 3 gold, take one land from the neutral pool (if any remain).

**There is no cap on what an order may carry.** Gold is uncapped, so a house
that has genuinely crushed the table can spend its way to the throne — a game
you have dominated should not come down to whether the others rally on a whim.
The counterweight is that the crown stands tall (15 + cards), so taking it still
needs a real gold lead or a real coalition, not a passing impulse. A coalition
wins the same way it always did: by rallying uncapped support behind one
champion, whose contribution is the one that counts.

### Fealty consequences of attacking (by the target's band at resolution)

| Target | Attacker's fealty change |
|---|---|
| Favorite (+2/+3) | −2 |
| Neutral (−1..+1) | 0 |
| Outlaw (−2/−3) | +1 |
| The Crown | set to −3 |

---

## 5. Combat (deterministic)

**Attack strength** = gold committed + Support gold aimed at the attacker + favorite punching-down bonus (§2) + Marshal.

**Defense** = walls + Support gold aimed at the defender + Warden + a fealty pledge.

- **Walls = 2**, but **walls = 0 if the defender has no army at home**: either they committed an Attack this round, or they answered the Crown's levy (§6). Their host is in the field either way.
- **A fealty pledge fortifies you.** An Appeal or a pardon this round adds the gold it cost to your walls, for that round only — throw yourself on the Crown's mercy and be sheltered by it. And **striking a house in the act of pledging costs the attacker 1 fealty**, whatever the target's band and whether or not the blow lands, which takes the bounty off hunting a reforming outlaw. This is what stops a loyalist beating up a neutral or an outlaw for free: they can pledge, and if they spied the blow coming (§2) they can pledge at the last moment.
- **A turncoat token in the attacker's hand cracks the gate**, reducing the defender's base walls by 2 (never below zero; the Warden, a pledge and support are proof against it). Holding the token does this — spending it on a reseal (§2) does not, so it is one or the other. Hold the only token at the table and you have a battering ram nobody else does; when the table is thick with outlaws all holding one, walls stop mattering and being an outlaw stops being lonely.

Attacker wins on **strictly greater**. Ties favor the defender (Herald breaks ties in its holder's favor, §7).

**Spoils:** the winner **plunders 4 gold** (or whatever the loser has, if less) —
this is not a choice, you broke the gate and the strongboxes go — and then takes
**one land** of their choice. If the loser's army was in the field (walls were 0
— they attacked, or they answered the levy), the winner may take **one of the
loser's titles** instead of the land.

Plunder is what makes a swollen purse a reason to be attacked rather than a
reason to be safe. Without it a raid paid one field, worth about two and a half
gold at a three-move horizon, for a commitment of three or more — so nobody
raided, gold piled up, and the back half of the game was everyone parking coin
on Support. It is also the game's real gold sink: war destroys the gold
committed to it and moves the rest, and it does both in proportion to how much
there is to fight over.

**A repelled attacker pays the same spoils they came for.** An army thrown back
leaves its baggage on the field, and its own walls are down by definition, so a
broken assault costs the attacker plunder and a field — or a coronet. This is
what makes digging in a play rather than a tax: a gate that holds takes
something off whoever tested it.

Before these two rules, **92% of attacks broke through**, defence was exactly
zero in 57% of them, and only 4% of defences had anything above bare walls at
all. Walls are flat and passive; a house with no friends had no move.

**Multiple attacks on one target** resolve independently against the same defense, in descending attack-strength order (Herald, then random, breaks ordering ties). Each successful attack takes its own spoils.

### Attacking the Crown (usurpation)
- All players who attacked the Crown this round pool their strength (no punching-down bonuses apply). Crown defense = crown strength (§1) + any Support aimed at the Crown.
- **If the coalition wins:** the **largest single contributor** takes the throne and wins the game immediately. Contribution tie = **civil war**: no one wins the round, and all conspirators are set to −3.
- **If the coalition loses:** every attacker is set to −3 and forfeits one land to the Crown.

Support aimed at someone attacking the Crown counts toward **that attacker's**
strength. A bought sword crowns the buyer, not the seller — which is why funding
somebody else's coup is a way of losing.

---

## 6. The Crown Deck (10 cards)

Resolved immediately on flip:

| Card | Count | Effect |
|---|---|---|
| **Tax** | 3 | Favorites pay 6, neutrals pay 7, outlaws pay 8 (Chancellor pays 1 less, min 0). Pay what coin you have; **anything still owed is taken in land**, one field per 5 gold of debt, and those fields go **back to the unclaimed pool**. |
| **Levy** | 4 | The Crown calls up your host. **Serve** — your army marches, so you have **no walls and no Attack order this round** — or **refuse** and drop **2 fealty**. |
| **Favor** | 3 | Every favorite is paid 2 gold. Those at +3 take a land from the neutral pool as well, if any remains. |

The levy resolves on the flip, **before orders are sealed**, so the whole table
sees whose gate is open before anyone chooses a target. That is the point of it.

Two is the right number to lose for a refusal because of where it leaves you.
From **+1** you land at −1 and are still neutral, so the top of the neutral band
is a perch: you can defy the Crown and keep your walls. From **0** the same
refusal makes you an outlaw. And a house climbing toward the throne cannot
afford to fall at all, so a loyalist has no real choice but to serve — which is
what puts their coronet on the table, round after round, in exactly the way
nobody else's is.

**Optional — the levy falls on the outlaws.** With this rule on, a Levy does not
ask an outlaw for anything: the Crown seizes their land instead, one at −2 and
two at −3. They are not being asked, they are being made an example of — and
they keep their army, which makes a levy round the outlaws' hour.

One **Favor** is seeded into the first three flips so loyalty pays early and the
table diverges fast.

---

## 6b. Your word, and what the court thinks

Deals move goods and nothing else: no bargain is ever conditional on anybody's
promise, and none waits on one. But a game about court politics in which
betrayal costs nothing is a game about arithmetic, so words and deeds are both
on the record.

**Giving your word.** At any time while deals are open, a house may declare an
undertaking to another house — *I will leave you be this round*, *I will
reinforce your defense*, *I will march on the Crown alongside you*. It is free
and it binds nobody. When the orders turn over it is checked against what that
house actually sealed.

**The ledger.** Every house holds an opinion of every other, from −3 to +3,
starting at nothing. It is public: a word given in open court is given in open
court. It moves on:

| | Change |
|---|---|
| Keeping your word | **+1** with them, **+0.25** with everyone else |
| Breaking your word | **−2** with them, **−1** with every other house |
| Striking a house you bargained with this round or last | **−2** with them, **−0.5** with the table |
| Holding somebody's wall (Support that went to their defense) | **+0.75** with them |
| Settling a bargain | **+0.4** each way, or nothing for the house that came off badly |

Opinions drift back toward indifference by 0.12 a round. The court has a long
memory, not an infinite one.

**What it buys.** A house that thinks little of you demands a far better bargain
before it signs, and below about −2.5 there is no bargain it will take. That is
the whole cost of conniving: the boost is often worth it, and it is never free.

Bots also carry a **trust tolerance** — how much of anybody's word they will act
on before the ledger is consulted at all. A loyalist takes people near enough at
face value; a wolf assumes everyone is lying. It is a separate dial from how
much their *own* word is worth, which is what makes a credulous traitor and a
suspicious honest broker both playable.

---

## 7. Titles (6)

Granted at fealty thresholds (§2). Taken by the sword per §5, or bought out from
under you by a rival spending their own grant and 2 gold (§2).

- **Marshal** — +1 to your attack strength.
- **Warden** — +1 to your defense.
- **Chancellor** — pay 1 less on Tax cards (min 0).
- **Steward** — +1 gold in the income step.
- **Spymaster** — after commitment, peek at one player's committed order (stacks with, and works outside, the outlaw band).
- **Herald** — win all ties you're party to (combat ties, contribution ties, resolution-order ties).

---

## 8. Winning

Two roads to the throne:

1. **Usurp** — lead a successful attack on the Crown as its largest contributor (§5).
2. **Inherit** — the crown deck runs out with no usurper. The highest-fealty player is crowned. Ties: most lands, then most gold. Still tied: they rule together.

---

## 9. Optional Module: Ransom

*Off by default. Turn it on if the loyalist→outlaw dive feels missing.*

- **Ransom [target]** (a fifth order, usable **once per game** per player) — Petition's mirror: trade standing down into gold. Steal 2 gold from the target. If the target is a favorite, drop 2 fealty (the crown protects its own). If the target is an outlaw, gain +1 fealty (bounty hunting). **Ransom the Crown:** gain 5 gold, set to −3.

---

## Appendix A: rulings

Edges the rules above do not settle, and how this implementation resolves them.

- **Support aimed at a player who both attacks and is attacked** joins their **attack** — their army is in the field. Otherwise it joins their defense.
- **Develop resolves before the swords**, so a land settled this round can be taken the same round. If the neutral pool empties first (two players Develop for one remaining land), the player who misses out gets their gold back.
- **Ransom (§9)** resolves alongside petitions, and reads the target's band from the start of resolution.
- **A player who can afford no order may Hold**, doing nothing. It is not one of the four orders and is unavailable to anyone who can afford anything else.
- **A civil war** (contribution tie among winning conspirators) voids only the coup. Attacks between houses in the same round still resolve.
- **A failed coup** does not shelter the conspirator: their walls are still down for everyone else's attacks that round, and land lost to another house can leave nothing to forfeit to the Crown.
- **Title exhaustion:** if all six titles are held when a player crosses +2 or +3, the grant stays pending rather than being burned — and it stays pending if they cannot afford to claim one either. You never spend a grant on nothing.
- **A claim takes effect the moment it is made**, so if two houses cross a threshold in the same round, the second may claim what the first just took. Precedence decides who chooses first.
- **You cannot claim a title you already hold**, and a claim moves the title without refunding anything to the house that loses it. The 2 gold goes to the Crown, not to them.
- **A house that answered the levy still has an army for defense** in every sense except walls: support aimed at them still counts, and the Warden still adds its point. It is the gate that is unmanned, not the field.
- **Turncoat tokens** are objects, not rights. An outlaw takes one each round they are in the shadow (up to two held at once), and anyone holding one may spend it in the whispers step. That is what makes them sellable.
- **A live bargain is public** — one house builds the whole thing and it sits in the open for the court to read and answer. Once it has **settled**, though, its contents pass out of common memory: third parties are left knowing that a bargain happened and who was in it, not the exact terms.
- **The size of a sealed commitment is hidden**, not just the order — otherwise players asked later in the round could read everyone's war chest off the board.
- **Simultaneous claims on something scarce are shuffled**, not resolved in seat order: two players crossing +2 in the same round, or two Develops for one remaining land. The Herald still goes first.

---

## Appendix B: what changed from v0.1, and why

The original sheet was written for four players with a crown of `4 + cards
remaining`. Bot tournaments (README has the numbers) turned up three problems.

**The crown deck almost never ran out.** The table out-earned the decaying crown
by about round six and whoever hoarded hardest walked up and took the throne;
inheritance, half the design, was decoration. Fixed by the 6-gold commitment cap
— §3's own parenthetical "(1–3)" was closer to right than §10's "uncapped" — plus
one Favor traded for one Tax.

**The crown could not be too strong either.** Pushing its offset up to 8 shut
the coup down, and with no coup a runaway favorite could not be deposed: nothing
in the game lowers a rival's fealty. The first player to +3 then held the Herald
and won every tie forever, taking 1.76× their share of games. At the offset
above, that falls to about 1.4×. The coup is the check on the heir, and it has
to stay live.

**Player count has to reach the crown.** A flat offset made two-handed games 81%
coups and six-handed games 45%, because a large table has more players free to
shield the throne. Hence `(10 − players)`.

**On the titles.** An earlier note here claimed Marshal and Herald were worth
2.4× and 2.1× the baseline. That was a correlation and it was misleading:
titles are granted at +2 and +3, so their holders are by definition the houses
already climbing. `tools/title-value.js` runs the causal experiment instead —
gift one title at setup, play the identical game, compare — and the picture is
much flatter:

| | Marshal | Herald | Warden | Chancellor | Spymaster | Steward |
|---|---|---|---|---|---|---|
| Win rate above a 26.5% baseline | +11.8pt | +7.2pt | +6.5pt | +2.0pt | +1.3pt | −0.2pt |

**Then titles were made takeable, and those numbers collapsed.** The reading
above was of a game where a coronet changed hands 0.06 times, because §5 only
let you take one from a house whose walls were down — a house that attacked this
round — and title-holders are favorites, who rarely attack. So a title was a
thing you banked. Two changes opened it:

- the levy asks for your **host** rather than your purse, so answering it puts
  your gate down in public, and the houses who cannot afford to refuse are
  exactly the ones wearing coronets;
- a grant at +2 or +3 may be spent **claiming a title somebody already holds**,
  for 2 gold.

Coronets now change hands about **2.5 times a game**, and the causal table
re-measured on the same 400-seed experiment reads:

| | Warden | Herald | Marshal | Steward | Chancellor | Spymaster |
|---|---|---|---|---|---|---|
| Win rate above a 23.5% baseline | +4.0pt | +3.8pt | +3.3pt | +0.8pt | −0.3pt | −1.3pt |
| Still yours at the end | 76% | 44% | 29% | 94% | 83% | 99% |

The spread across all six fell from about 12 points to about 5, and nothing was
done to any title's text to achieve it. The second row is why: the titles worth
having are the ones you do not get to keep. A gifted Marshal is gone by the end
of the game 71% of the time and a gifted Spymaster essentially never — the table
prices them, and the price is paid in how long you hold them. An advantage is
only worth what you can do with it before somebody takes it.

**What is still open:** theft *in the field* remains rare — 0.06 a game, barely
moved. The levy opened the gate but these bots do not walk through it, because
attacking a favorite costs 2 fealty and a bot will not pay that to rob a house
it is not already fighting. The claim mechanic is doing all the work. Whether a
real table behaves the same way is exactly the question the bots cannot answer.

**The levy change cost the game its main gold sink, and the Tax had to take it
over.** Levies used to pull 4 gold per house out of play on a third of the deck
and now pull none, so mean gold at the end of a four-handed game climbed to 26.9.
The Tax ladder went from 1/2/3 to **6/7/8** to answer it, and starting gold from
6 to 8 — because at 6, a Tax on the very first flip left a third of the table
unable to afford any order at all, which is not a first turn anybody should have.
That lands mean end gold at 15.8.

The whole curve, 600 four-player games at each rung, because the trade is worth
seeing rather than being told:

| Tax ladder | Gold left at the end | Battles/game | Turns you can afford nothing |
|---|---|---|---|
| 1/2/3 | 27.0 | 4.4 | 0% |
| 3/4/5 | 21.2 | 5.3 | 3% |
| 4/5/6 | 18.7 | 6.2 | 5% |
| **6/7/8** (in play) | **15.8** | **5.8** | **9%** |

Taxing harder buys battles up to a point and then starts taking them away, for
the obvious reason: past a certain weight, nobody can afford to fight either.

### The horizon, and why it was the whole problem

Almost every judgement in this game is secretly a judgement about how far ahead
you are supposed to be thinking. A field is a stream of gold — over how long?
Standing is a claim on a throne — how many rounds away? Betrayal pays now and
costs later — how much later is "later"?

The answer is **about three moves**: this one and two more, with the two
together mattering slightly less than the one in hand. `src/engine/horizon.js`
is that decision with a number attached, and everything that used to reason over
"the whole remaining deck" now reads from it.

That single change did more than every constant in this file put together.
Before it, a field bought on round two was priced at eleven harvests, which made
building and climbing overwhelmingly correct from the first turn and made
fighting — a cost now for a gain now — look like a waste:

| | Before | After the horizon | And with plunder |
|---|---|---|---|
| Battles per game | 5.5 | 7.3 | **8.9** |
| A winner's turns spent attacking | 15% | 22% | **30%** |
| Coronets taken by the sword | 0.27 | 0.93 | **1.19** |
| Usurpation / inheritance | 35 / 65 | 46 / 54 | **55 / 46** |
| Gold left on the table at the end | 13.9 | 13.0 | **11.2** |
| Doctrine spread (best lane minus worst) | 33pt | 25pt | **12pt** |
| Enjoyment (tools/enjoyment.js) | 62 | 62 | **69** |

The bands came back too: the outlaw band went from 8% of all player-rounds to
18%, because the shadow's payoff is immediate and the shadow was being priced
against an eleven-round land habit.

### The one thing constants have not fixed

Skipping a lane should be a road less travelled, not the main road. It is
currently the main road. Only a third of winners use all three lanes, 44% skip
one outright, and the skipped one is **never building** — it is attacking 57% of
the time, and 90% of the time when the bots carry no committed doctrine, which
rules out "the doctrines are specialists" as the explanation.

Split by road, the reason is plain:

| | Building | Attacking | Conniving |
|---|---|---|---|
| Usurpers | 39% | 48% | 14% |
| Inheritors | 44% | 12% | 45% |

**The two roads to the throne are two of the three lanes.** Inheriting is
climbing and dealing; usurping is climbing and fighting. Neither road needs the
third thing, so the balanced 40/40/20 average is just the midpoint of two
lopsided lines rather than a description of anybody's game.

No constant reaches this. What would is a rule that makes each road need the
lane it currently skips — an inheritance that cannot be won without having taken
something by force, or a throne that cannot be seized without somebody else's
consent. That is a rules change and it is not made here.

### The deck went from twelve cards to ten

The back half was the problem all along, and the cheapest fix for a bad back
half is to have less of it. Ten cards — **3 Tax, 4 Levy, 3 Favor** — with the
crown's per-card term raised from 1 to 1.4 so the throne still starts at 20 and
still decays to 6.

| Deck | Enjoyment | A winner's mix | Options (of 25) | Gold at the end |
|---|---|---|---|---|
| 12 (4/4/4) | 72 | build 36 · attack 30 · connive 34 | 22 | 10.2 |
| 10 (4/3/3) | 74 | build 42 · attack 35 · connive 23 | **16** | 4.7 |
| **10 (3/4/3)** | **79** | build 41 · attack 30 · connive 29 | **25** | 9.2 |
| 9 (3/3/3) | 76 | build 43 · attack 31 · connive 26 | 23 | 6.4 |

Two things fall out of that table. The first is that shortening the deck fixes
the mix by deleting the rounds that had nothing in them: **building lands on
target for the first time**, and conniving falls from 34% to 29% without
Support's terms changing at all. The second is that *which* card you remove
matters more than how many: taking out a Levy instead of a Tax costs nine points
of options and five gold a game, because the Tax is the squeeze and the Levy is
the thing that opens gates.

Nine cards was the original instinct and it measures well, but ten with an extra
Levy beats it on affordability, breadth, fights and doctrine spread, at a cost of
about half a round of length.

**The crown's per-card term is now the most violent number in the game.** On a
ten-card deck, leaving it at 1 gives 57% usurpation; one point of `crownBase`
takes that to 13%, and two points to 5%. The fractional per-card term exists so
the curve can be steered without that cliff — which is why crown strength is now
rounded for display.

### Two changes to the land economy, tested apart and together

The back half had no building in it: the pool was dry by round seven and after
that a winner's turns had nowhere to go but Support. Two candidate fixes, each
measured alone against the same 500 seeds and then together.

| | Enjoyment | Mix (of 50) | Options (of 25) | Priced out | Gold at the end |
|---|---|---|---|---|---|
| Neither | 69 | 33 | 22 | 17% | 11.2 |
| Failed taxes paid in land | 68 | 34 | **19** | **26%** | 8.7 |
| 3 fields per player, not 2 | 71 | 33 | **25** | 16% | 13.6 |
| **Both** | **72** | **36** | 22 | 23% | 10.2 |

They fix different halves and neither is sufficient alone. Paying tax in land
improves the *mix* — it is a real sink, and recycled fields give Develop
somewhere to point — but on its own it is a poverty spiral: you cannot pay, so
you lose a field, so your income falls, so you cannot pay next time either.
A bigger pool fixes affordability and does nothing for the mix. Together the mix
lands at its best measured value and the gold at the end lands on 10.

**A note on the instrument.** This comparison first came out backwards, because
`imbalance()` was charging for being priced out *twice* — once in its own
`starved-choices` term and again through the enjoyment score's options
component — and the older, cruder term was large enough to dominate. It ranked a
configuration that scored better on enjoyment as worse overall. The old term is
now a backstop at 25% rather than a gradient from 8%.

**And the pool now never empties**, which relocates the problem rather than
solving it: 6.6 fields are still unclaimed at round twelve, and Develop still
falls to 1% by round nine. Building is no longer gated by *land*. It is gated by
*gold*, which is the tax doing its job to a fault.

### Do the houses pull apart?

Rather more than they did — the leader's share of all land went from 37% to
**45%** once there was land left to take, which is the bigger pool doing
something the raw mix does not show. But on standing, no. `tools/order-diary.js`
prints the leader's margin over the median, round by round. At four players the
leader finishes **1.5 land and 0.5 fealty** ahead, and the top house holds 37%
of all land against a 25% baseline. The fealty gap *peaks* around round 5 at 1.0
and then shrinks — everybody catches up, everybody arrives at the top of the
track together, and the throne comes down to a tie-break nobody can move.

That is why the late game was a stalemate, and it is why war had to be made to
pay: a raid is the only thing on the board that can break a tie, and it was
paying less than it cost.

### Why there are not more battles

`tools/order-diary.js` prints the order mix round by round against the unclaimed
land remaining. Rounds 1–7, while there is still land to settle: develop 21%,
appeal 38%, attack 17%, **support 7%**. From round 8, when the pool is dry:
develop 0%, appeal 21%, attack 13%, **support 56%**. And from round 9 on, most
attack orders point at the **Crown** rather than at a neighbour.

So the turns freed up when the building stops do not go into currying favour —
appeals actually fall. They go into **Support**, which is the one order that
costs nothing but coin, never costs standing, and cannot lose. The late game is
a coup standoff with everybody's gold pledged behind the throne or behind a
claimant, and no raiding at all.

Three things it is *not*, each ruled out by a sweep rather than by argument:

- **Not the cost of striking a favorite.** Taking `attackFealty.favorite` from
  −2 to 0 moves battles from 5.1 to 5.2. Nobody is being deterred by it.
- **Not the bots' fear of exposure.** Cutting their walls-down penalty by five
  moves battles from 5.1 to 5.7.
- **It is the price of the alternative.** An appeal is 2 gold for a guaranteed
  step toward the win condition; a raid is 3+ gold, a real chance of nothing,
  and a field worth about a gold a round. Raise the appeal and the swords come
  straight out: at 3 gold battles go to 5.9, at 4 with a 5-gold pardon they go to
  **8.1**, sword-taken coronets go from 0.03 a game to 0.54, the two roads to the
  throne split 43/57, and mean end gold lands on 11.

That last configuration hits every number one could ask for and is **not** in
play, because it also puts 19% of turns on Hold and 26% out of reach of any
order but attack-or-support. Making the swords come out by pricing people out of
everything else is not the same as making the game want a fight. The honest fix
is a sink that stays open in the back half — the land runs out at round 8 and
nothing replaces it — rather than a tax squeeze.


### Defence, the token, and the throne (this pass)

Three interlocking changes made defence a real decision and the throne winnable
by a house that earned it.

**A pledge of fealty shields you, and striking a pledger is dishonourable.** The
midgame problem was that a neutral or an outlaw was free money for anyone on the
loyalist track: you took as much land as by developing, and hunting an outlaw
*paid* standing. Now an appeal or pardon adds its gold to your walls that round,
and cutting down a house in the act of pledging docks the attacker a fealty
whatever the band. The counter that makes it sing: an outlaw who spies the blow
coming (§2) can pledge at the last moment — so beating one up is no longer safe.

**The turncoat token is a battering ram.** Held in an attacker's hand at
resolution it cracks the base wall. That gives the sole token-holder real
leverage and makes a table thick with outlaws a table where walls, and the risk
of being an outlaw, both matter less — the same mechanic diluting itself.

**Gold is uncapped.** The commit cap let a lone dominant house lose its own coup
to arithmetic — capped at 9 against three defenders piling on support. Uncapped,
a house that has crushed the table can buy the throne, and a coalition still wins
by rallying uncapped support behind one champion. The crown floor sat at 15 to
keep that from being a whim, but it also kept the throne out of reach until the
last card; it has since come down to 11, with a steeper per-player term, so the
coup window opens around round seven (§2) — near 21 early at four players, 7 at
the death.

The honest cost, measured: raiding the weak got expensive, so the raider lane
fell and the climber lane rose, widening the doctrine spread; and coups land far
more often now that gold decides them. Both are the intended tensions doing their
work, and both are dials — `pledgeStrikePenalty`, `turncoatWallBreak`,
`crownBase` — if the balance wants a nudge.
