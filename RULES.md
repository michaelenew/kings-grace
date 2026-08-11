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
| Starting gold per player | 6 |
| Starting fealty per player | 0 |
| Neutral land pool | 2 per player |
| Crown deck | 12 cards (composition in §6) |
| Fealty track | −3 to +3 per player |
| Titles | 6 unique (list in §7) |

Land income: **each land you hold pays 1 gold** in the income step.

**Crown strength** at any moment = **6 + cards remaining in the crown deck**,
running 18 down to 6.

The per-player term is a knob and it defaults to zero. Growing the crown with
the table was tried and it shuts the coup down: a bigger table already supplies
more houses who might rally to the throne, and adding strength on top of that
took usurpation to 1% at five and six players. What it must never do is *shrink*
as the table grows.

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
- **Peek:** after all orders are committed but before reveal — at −2, look at *either* one player's committed order *or* the top card of the crown deck; at −3, look at **both**.
- **Turncoat token:** after peeking you take a **turncoat token** (hold at most two). Anyone holding one may spend it in the whispers step to change their own sealed order. Tokens are goods, not rights — sell one at the deal table and the buyer can spend it themselves.
- The crown taxes you at the highest rate (§6).

---

## 3. Round Structure

One loop, five steps:

1. **The royal card.** Reveal the top crown card and resolve it immediately (§6). Outlaws take their turncoat token now.
2. **Sealed orders.** Every player secretly chooses one order (§4) and, where relevant, a hidden gold commitment and target.
3. **Whispers.** Outlaws peek (§2). Anyone holding a turncoat token may spend it to change their own sealed order — including one they bought earlier in the round.
4. **Reveal & resolve.** All orders flip at once and settle in a fixed order:
   1. **Appeals and pardons** — standing moves now, so every band effect is already updated when the swords land,
   2. **Develops** — land is settled,
   3. **Support** — counted toward whoever it was aimed at,
   4. **Attacks and spoils.**
5. **Income.** Each land pays 1 gold; neutrals gain +1.

**Deals are not a step.** The table is open from the moment the royal card turns
until the orders begin resolving. Each house sets what it is **offering** and
what it is **taking**; when everything offered matches everything taken across
all houses, and every house involved has accepted, it all changes hands at once.
Touching any term withdraws every acceptance, so nobody is ever holding an
accept on terms they have not seen.

Gold, land, titles and turncoat tokens move. Nothing anybody says they will
*do* is part of a deal, and words bind nobody. Gold already committed to an
order this round is spent and cannot be traded.

---

## 4. Orders

Each player picks exactly one per round:

- **Attack [target]** — commit **1 to 7 gold** as troops. Target may be a player or the Crown. Committed gold is spent win or lose.
- **Support [target]** — commit **1 to 7 gold**. Adds that gold to the target's attack *or* defense this round (whichever situation arises). Supporting the Crown's defense adds gold only — no fealty bonus applies.
- **Appeal** — pay 2 gold, gain +1 fealty. **Band read for outlaws:** an outlaw's Appeal is a **pardon** — pay 3 gold, jump directly to fealty 0. Because appeals resolve before attacks, a pardoned outlaw is no longer an outlaw when the swords land.
- **Develop** — pay 3 gold, take one land from the neutral pool (if any remain).

**No order may carry more than 7 gold.** This is the rule that makes a
usurpation a conspiracy: no purse alone outreaches the crown, so the throne has
to be bought with somebody else's sword.

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

**Defense** = walls + Support gold aimed at the defender + Warden.

- **Walls = 2**, but **walls = 0 if the defender has no army at home**: either they committed an Attack this round, or they answered the Crown's levy (§6). Their host is in the field either way.

Attacker wins on **strictly greater**. Ties favor the defender (Herald breaks ties in its holder's favor, §7).

**Spoils:** the winner takes **one land** of their choice from the loser. If the loser's army was in the field (walls were 0 — they attacked, or they answered the levy), the winner may instead take **one of the loser's titles**.

**Multiple attacks on one target** resolve independently against the same defense, in descending attack-strength order (Herald, then random, breaks ordering ties). Each successful attack takes its own spoils.

### Attacking the Crown (usurpation)
- All players who attacked the Crown this round pool their strength (no punching-down bonuses apply). Crown defense = crown strength (§1) + any Support aimed at the Crown.
- **If the coalition wins:** the **largest single contributor** takes the throne and wins the game immediately. Contribution tie = **civil war**: no one wins the round, and all conspirators are set to −3.
- **If the coalition loses:** every attacker is set to −3 and forfeits one land to the Crown.

Support aimed at someone attacking the Crown counts toward **that attacker's**
strength. A bought sword crowns the buyer, not the seller — which is why funding
somebody else's coup is a way of losing.

---

## 6. The Crown Deck (12 cards)

Resolved immediately on flip:

| Card | Count | Effect |
|---|---|---|
| **Tax** | 4 | Favorites pay 1, neutrals pay 2, outlaws pay 3 (Chancellor pays 1 less, min 0). Unpayable amounts: pay what you have. |
| **Levy** | 4 | The Crown calls up your host. **Serve** — your army marches, so you have **no walls and no Attack order this round** — or **refuse** and drop **2 fealty**. |
| **Favor** | 4 | Every favorite is paid 2 gold. Those at +3 take a land from the neutral pool as well, if any remains. |

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
- **A deal is private** to the two houses that struck it. Third parties see that a bargain happened, not what was in it.
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

**The levy change cost the game its main gold sink.** Levies used to pull 4 gold
per house out of play on a third of the deck. They now pull none, and mean gold
at the end of a four-handed game rose from 17.6 to 26.9. Nothing measured is
obviously broken by it — nobody is priced out of their turn, and coups did not
run away — but gold is a looser constraint than it was, and if it wants
tightening, Tax is the lever.
