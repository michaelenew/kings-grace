# The peer-to-peer harness

A real host and a real guest, each a whole browser in a worker of its own, each
running the actual `src/ui/app.js`. Only the wire is faked: the parent process
is the signalling broker and the relay, standing in for PeerJS's data channel —
including its 16300-byte ceiling, which silently discards anything bigger.

The isolation is the point. `src/ui/app.js` grabs its root element and its whole
`app` object at import time, off the globals; two instances in one process would
share them and prove nothing.

    npm run test:p2p                      # host + 1 guest, default table
    npm run test:p2p -- --guests 3        # a fuller table
    npm run test:p2p -- --table 6         # empty seats become bots
    npm run test:p2p -- --animate         # with the transition beats in play
    npm run test:p2p -- --stall 40000     # how long "not moving" has to last

It plays a whole game with every seat driven, and fails if anybody stops making
progress — which is the bug it exists for, a seat left on a spinner forever.
On failure it prints what each browser was doing: its seat, screen, round,
phase, what it was waiting on, and the last thing on its turn panel.

It can be pointed at an older commit to ask whether a bug was there then: check
the commit out in a worktree, copy this directory in, and run it. `--guests` and
the screen detection work against any build.

Needs jsdom (`npm install`). The main suite (`npm test`) stays dependency-free.
