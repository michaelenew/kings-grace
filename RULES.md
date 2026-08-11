# The King's Graces — Prototype Rules v0.1

*Working title. A competitive game of medieval noble politics for 4 players. Serve the crown, grow fat, or vanish into outlawry — then take the throne before someone else inherits it.*

---

## 1. Components & Setup

| Item | Quantity / Value |
|---|---|
| Players | 4 |
| Starting lands per player | 3 |
| Starting gold per player | 5 |
| Starting fealty per player | 0 |
| Neutral land pool | 8 |
| Crown deck | 12 cards (composition in §6) |
| Fealty track | −3 to +3 per player |
| Titles | 6 unique (list in §7) |

Land income: **each land you hold pays 1 gold** in the income step.

Crown strength at any moment = **4 + cards remaining in the crown deck** (starts at 16, decays toward 4).

---

## 2. Fealty Bands (the archetype system)

Fealty is a single track per player. Where you stand grants a passive. All band effects and fealty consequences are evaluated **at resolution time**, not at commitment time.

### Favorite (+2, +3) — the crown's sword
- Your attacks gain **+fealty** as bonus strength, but **only against targets whose fealty is below yours**. Punching up or sideways gets nothing. The crown is above everyone, so this bonus can never touch the crown, and it cannot be added to the crown's defense (the crown's strength already *is* its loyal armies).
- **Titles:** the first time you reach +2, choose one title. The first time you reach +3, choose a second. Two maximum. Titles are kept forever — including after treason — unless stolen (§5).

### Neutral (−1, 0, +1) — the granary
- **+1 gold** in every income step. Nobody's watching your fields.

### Outlaw (−2, −3) — the shadow
- **Peek:** after all orders are committed but before reveal — at −2, look at *either* one player's committed order *or* the top card of the crown deck; at −3, look at **both**.
- **Turncoat:** after peeking, you hold one **change right**: before reveal, either **change your own committed order**, or **give the right to another player**, who may then change *their* own committed order (your order stays as committed). One change total, either way. You are free to negotiate a price for how you use it — or for not using it at all. Deals are table talk — never binding.
- The crown taxes you at the highest rate (§6).

---

## 3. Round Structure

One loop, four steps:

1. **Crown flip.** Reveal the top crown card and resolve it immediately (§6).
2. **Commit.** Every player secretly chooses one order (§4) and, where relevant, a hidden gold commitment and target. Then outlaws peek and may swap their own order (§2).
3. **Reveal & resolve.** All orders flip simultaneously. Resolution order:
   1. **Petitions / pardons** (fealty moves now — bands recalculate),
   2. **Attacks** (with all Supports applied),
   3. **Spoils** (land / title transfers).
4. **Income.** Each land pays 1 gold; neutrals gain +1.

**Standing rule — gold is a table-talk currency.** Any player may give any amount of gold to any other player at any time, for any reason (bribes, tribute, war chests, apologies). Payments are real; promises never are. Gold already committed to an order this round is spent and cannot be gifted or reclaimed.

---

## 4. Orders

Each player picks exactly one per round:

- **Attack [target]** — commit any amount of gold (at least 1) as troops. Target may be a player or the Crown. Committed gold is spent win or lose.
- **Support [target]** — commit any amount of gold (at least 1). Adds that gold to the target's attack *or* defense this round (whichever situation arises). Supporting the Crown's defense adds gold only — no fealty bonus applies.
- **Petition** — pay 2 gold, gain +1 fealty. **Band read for outlaws:** an outlaw's Petition is a **pardon** — pay 3 gold, jump directly to fealty 0. Because petitions resolve before attacks, a pardoned outlaw is no longer an outlaw when the swords land.
- **Develop** — pay 3 gold, take one land from the neutral pool (if any remain).

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

- **Walls = 2**, but **walls = 0 if the defender also committed an Attack this round** — their army is in the field.

Attacker wins on **strictly greater**. Ties favor the defender (Herald breaks ties in its holder's favor, §7).

**Spoils:** the winner takes **one land** of their choice from the loser. If the loser's army was in the field (walls were 0), the winner may instead take **one of the loser's titles**.

**Multiple attacks on one target** resolve independently against the same defense, in descending attack-strength order (Herald, then random, breaks ordering ties). Each successful attack takes its own spoils.

### Attacking the Crown (usurpation)
- All players who attacked the Crown this round pool their strength (no punching-down bonuses apply). Crown defense = crown strength (4 + cards remaining) + any Support aimed at the Crown.
- **If the coalition wins:** the **largest single contributor** takes the throne and wins the game immediately. Contribution tie = **civil war**: no one wins the round, and all conspirators are set to −3.
- **If the coalition loses:** every attacker is set to −3 and forfeits one land to the Crown.

---

## 6. The Crown Deck (12 cards)

Resolved immediately on flip:

| Card | Count | Effect |
|---|---|---|
| **Tax** | 4 | Favorites pay 1, neutrals pay 2, outlaws pay 3 (Chancellor pays 1 less, min 0). Unpayable amounts: pay what you have. |
| **Levy** | 4 | Each player pays 2 gold to the Crown or drops 1 fealty. |
| **Favor** | 3 | The single highest-fealty player takes one land from the neutral pool. Tie: no effect. |
| **Purge** | 1 | The single lowest-fealty player forfeits one land to the Crown. Tie: no effect. |

Suggested tuning knob: seed one **Favor** into the first three flips so loyalty pays early and the table diverges fast.

---

## 7. Titles (6)

Granted at fealty thresholds (§2), kept forever, stealable only per §5.

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
2. **Inherit** — the crown deck runs out with no usurper. The highest-fealty player is crowned. Ties: most lands, then most gold.

---

## 9. Optional Module: Ransom

*Cut from the core four orders for simplicity; restore if the loyalist→outlaw dive feels missing.*

- **Ransom [target]** (a fifth order, usable **once per game** per player) — Petition's mirror: trade standing down into gold. Steal 2 gold from the target. If the target is a favorite, drop 2 fealty (the crown protects its own). If the target is an outlaw, gain +1 fealty (bounty hunting). **Ransom the Crown:** gain 5 gold, set to −3.

---

## 10. First-Playtest Watchlist

- **Pardon pricing** — is 3 gold too cheap an escape hatch, making outlaws unpunishable? Tune price before removing the mechanic.
- **Petition timing** — if pre-combat petitions make every round too swingy for everyone, scope the early timing to outlaw pardons only.
- **Outlaw power** — if the shadow dominates, tune their tax rate or the pardon price, not the toolkit. If the shadow starves, drop outlaw tax to 2.
- **Turtling** — once players learn attackers are exposed (walls 0), watch whether everyone stalls. The heir clock and Support-as-proxy-war should prevent it; confirm.
- **Crown strength curve** — with uncapped commitments, the usurpation window is set by the table's total gold, not per-order limits. 4 + cards remaining targets a mid-game window around strength 8–10; adjust the constant if hoarded war chests open it too early or the tax drain keeps it shut too long.
- **Uncapped gold + free transfers** — watch for a degenerate line where the table pools everything into one player's single overwhelming attack. The largest-contributor throne rule (gifted gold counts toward the *attacker's* contribution, not the donors') is the intended deterrent: funding someone's coup crowns *them*. Confirm that deters it in practice.

---

## Appendix A: the tuned constants

v0.1's own §10 asks a first playtest to watch the crown-strength curve, the
pardon price, the outlaw tax and whether hoarded war chests open the usurpation
window too early. They do. This build ships two presets: **v0.1**, the sheet
exactly as written, and **Tuned**, the default. The tuned changes:

| Constant | v0.1 | Tuned |
|---|---|---|
| Crown strength | 4 + cards remaining | **6** + cards remaining |
| Gold per order | uncapped (§10) / 1–3 (§3) | **at most 6** |
| Tax by band | 1 / 2 / 3 | **2 / 3 / 4** |
| Levy | 2 gold or 1 fealty | **4 gold** or 1 fealty |
| Petition | 2 gold | **3 gold** |
| Pardon | 3 gold | **4 gold** |
| Crown deck | 4 Tax, 4 Levy, 3 Favor, 1 Purge | **5 Tax, 4 Levy, 2 Favor, 1 Purge** |

Everything else is unchanged: walls of 2, the punching-down bonus, the standing
cost of attacking each band, all six titles, land income, the neutral granary,
and the starting position of 3 lands and 5 gold.

The commitment cap is the biggest change and the one worth arguing about. §3
says "a hidden gold commitment (1–3)" and §10 says commitments are uncapped;
they cannot both be right. A cap of 6 sits between them, and it is what turns a
usurpation into a conspiracy: crown strength never falls below 6, and the most
one house can put behind a single attack is 6 (7 with the Marshal), so taking
the throne means buying somebody else's support first. Support aimed at an
attacker counts toward that attacker's strength, so the bought sword crowns the
buyer — §10's own deterrent, now load-bearing.

See the README for how these were chosen and what the numbers look like.

---

## Appendix B: rulings this implementation makes

v0.1 leaves a few edges undefined. The code resolves them as follows; each is a
one-line change if you want it the other way.

- **Support aimed at a player who both attacks and is attacked** joins their **attack** (their army is in the field). Otherwise it joins their defense.
- **Develop** resolves **after spoils**, so a land settled this round cannot be looted the same round. If the neutral pool empties first (two players Develop for one remaining land), the player who misses out gets their 3 gold back.
- **Ransom (§9)** resolves alongside petitions in step 3.1, and reads the target's band from the start of resolution.
- **Commitment size** is uncapped (at least 1, at most your gold), following §10's "uncapped commitments" rather than the parenthetical "(1–3)" in §3.
- **A player who can afford no order may Hold**, doing nothing. It is not one of the four orders and is unavailable to anyone who can afford anything else.
- **Table talk gets an explicit step** at the top of each round, before orders are sealed. §3 already allows gold to move at any time and deals to be struck at any time; the step exists so a bot has a moment to make and answer proposals, and so a human is asked. It changes no rule: gold moves for real, promises still bind nobody.
- **A deal is private** to the two houses that struck it. Third parties see that a bargain happened, not what was in it.
- **The size of a sealed commitment is hidden**, not just the order. Escrowed gold does not show on the board until the reveal, or players asked later in the round could read everyone else's war chest.
- **Simultaneous claims on something scarce are shuffled**, not resolved in seat order: two players crossing +2 in the same round, or two Develops for one remaining land. The Herald still goes first.
- **A civil war** (contribution tie among winning conspirators) voids only the coup. Attacks between houses in the same round still resolve.
- **A failed coup** does not shelter the conspirator: their walls are still down for everyone else's attacks that round, and land lost to another house can leave nothing to forfeit to the Crown.
- **Title exhaustion:** if all six titles are held when a player crosses +2 or +3, the grant stays pending rather than being burned.
- **The change right** granted to another player is exercised immediately, before the reveal.
