# The King's Graces

A playable web implementation of *The King's Graces*, prototype rules v0.1 — a
four-player game of medieval noble politics. Serve the crown, grow fat, or
vanish into outlawry, then take the throne before someone else inherits it.

The full rules are in [RULES.md](RULES.md), including an appendix listing every
edge case v0.1 left open and how this build resolves it.

## Running it

No dependencies, no build step. The app is plain ES modules, so it needs to be
served over http rather than opened from the filesystem.

```sh
npm start           # http://localhost:5173
npm test            # 49 engine + bot tests, node's built-in runner
```

Any static server works: `python3 -m http.server` from the repo root will do.

## Playing

Pick who sits in each of the four seats — any mix of humans and bots. One human
against three bots is the default; four humans is hot seat, with a "pass the
table" screen between private decisions; four bots lets you watch a game play
itself.

Each round you seal one order, outlaws whisper, and everything resolves at once.
Two things are worth knowing before your first game:

- **Attacking drops your own walls to zero.** An army in the field cannot hold a
  gate, and a defender with no walls can have a *title* taken, not just a land.
- **Gold given away is really gone; everything else is words.** The table talk
  panel under the order form lets you send gold to anyone and put a proposal to
  a bot — join my coup, hit that one, reinforce me, leave me alone. Bots accept
  when the bribe genuinely makes that their best line, and they may still walk
  away from the promise when orders are actually sealed. The treacherous
  personalities discount a promise hardest once the gold is already banked.

Variants on the setup screen: the **Ransom** module (§9), the **Favor seeding**
knob (§6), and the **crown strength constant** (§10) — see below for why that
last one is worth touching.

## Playtest findings

The engine is faithful to v0.1; these are observations from running the bots
against each other, not changes to the rules.

**The usurpation window opens far too early.** Across 40 seeded bot games at the
v0.1 constant of 4, *every single game* ended in a coup, on average at round
6.2 — the crown deck never ran out and nobody ever inherited. The cause is
structural rather than a bot artifact: the table earns roughly 20 gold a round
in income, while Tax and Levy together drain about half that, and the only other
sinks (Petition at 2, Develop at 3) are small and the neutral pool is exhausted
by about round three. War chests grow at 3–4 gold per player per round while the
crown decays at 1. They cross around round six and never uncross.

Raising the constant moves the window monotonically, and it takes a lot of
movement to reopen the second road to the throne:

| Crown strength constant | Mean ending round | Usurped | Inherited |
|---|---|---|---|
| 4 (v0.1) | 6.2 | 40 | 0 |
| 8 | 7.4 | 40 | 0 |
| 14 | 9.6 | 40 | 0 |
| 20 | 11.0 | 36 | 4 |
| 30 | 11.8 | 9 | 31 |

Two tests in `test/ai.test.js` pin this down: one asserts the coup is universal
at the v0.1 constant, one asserts the trend is monotonic, one asserts that a
strong enough crown reopens inheritance. They are balance canaries, not rules
checks — if you retune, expect to update them.

If you would rather not inflate the constant, the more interesting knobs are on
the income side: the shortage is a gold *sink*, not crown strength. Worth trying
before the constant — a per-round commitment cap, a rising Tax, or letting the
Crown bank forfeited land back into the neutral pool.

**Supporting the Crown is a real counter and the bots use it.** Once bots learned
to spend seriously on the royal guard, some coups started failing, which is
where the "36 usurped / 4 inherited" row at 20 comes from. A coup attempt that
fails is brutal — −3 fealty and a land — so the bluff has teeth.

**The pardon does not look underpriced.** Bots dive to outlaw, use the peek and
the change right, and buy their way back to 0 when the endgame nears. Three gold
buys back roughly one and a half rounds of income, which reads about right; §10's
worry that outlaws become unpunishable did not show up.

**Nothing can lower a rival's fealty.** Attacking a favorite costs *you* two
standing and leaves theirs untouched, so a runaway heir cannot be dragged down —
only out-petitioned or usurped. That is a real strategic consequence of the
current design rather than a bug, but it means the inheritance race, when the
crown is strong enough for one to happen, is closer to a spending race than a
fight.

## Layout

```
index.html          shell
styles.css
server.js           zero-dependency static server
src/engine/         the rules; knows nothing about the DOM
  constants.js      every number from the rules sheet, in one place
  state.js          setup, deck construction, redacted per-player views
  game.js           the round loop, resolution, combat, victory
  ai.js             bot seat controllers
  diplomacy.js      gifts and bribes
  rng.js            seeded PRNG, so any game can be replayed
src/ui/             the browser client
test/               node:test suites
```

The engine drives the whole game and asks each seat's *controller* for decisions
through one async interface:

```js
controller.decide(request, view) -> Promise<answer>
```

The UI plugs a human controller in that resolves a promise from a form; the bots
plug in a heuristic; tests plug in scripted answers. A controller only ever sees
`view`, a redacted state with other players' sealed orders and the crown deck's
contents removed — bots cannot cheat, because there is nothing to cheat with.

Games are seeded. Entering the same seed with the same seats and settings
replays the same game exactly, which is what makes the balance table above
reproducible.
