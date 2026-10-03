# Grid Pursuit — Police vs Thief

A turn-based chase on an 10×10 grid, built to showcase **shortest-distance
pathfinding (BFS)**: the AI opponent — whichever side you don't play —
always plans its moves using shortest-path search across the board.

No build step, no dependencies. Open `index.html` and play.

## How to play

Open `index.html` in any modern browser and pick a mode from the main menu:

**Play vs AI** — pick a side, **Police** (hunter) or **Thief** (evader),
and a difficulty (Easy / Intermediate / Hard). The AI takes the other
side and plans its moves with the same shortest-path search described
below.

**Offline · 2 Player** — enter two names, choose who's Police for round 1
(Player 2 gets the opposite role), then hand the device back and forth.
Round 2 swaps roles. Between every turn, the screen blurs for 3 seconds
with a "pass the device" prompt so the incoming player doesn't see the
outgoing player's position. See **Scoring** below for how the winner is
decided.

**Online · 2 Player** — play a friend on their own device. One player picks
**Host room**, enters a name and gets a 5-character room code; the other picks
**Join room**, enters a name plus that code. Same two-round format and scoring
as offline mode, but there is no pass-the-device blur since each player has
their own screen. See **Online play** below for how it works.

Click a highlighted tile on your turn to move there. Each turn you also
have **8 seconds to act** — if the clock runs out, a random legal move is
made for you automatically, so no one can stall the whole match out.

The overall match clock is **5 minutes**: the Thief wins a round by
surviving it, the Police win by making the capture first.

### Difficulty (Play vs AI)

| | Easy | Intermediate | Hard |
|---|---|---|---|
| Reaction speed | slow | moderate | fast |
| Move quality | often random | mostly optimal | always shortest-path optimal |
| Power usage | rare / mistimed | fairly reliable | used at the ideal moment |

### Scoring (Offline · 2 Player)

Both players play Police exactly once — round 1 with the roles you
picked, round 2 with them swapped. Whichever player, **as Police**, makes
their capture in less time wins the match. If only one of the two rounds
ends in a capture, that catcher wins outright. If neither round ends in a
capture, the match is a draw.

## Rules

| | Police | Thief |
|---|---|---|
| Movement per turn | 2 tiles | 1 tile |
| Vision radius | 3 tiles | 5 tiles |
| Win condition | Step onto the Thief's tile | Survive the 5-minute timer |

Movement is 4-directional (up/down/left/right) and distances are computed
with a real breadth-first search over the grid, not just straight-line
math — so the logic is ready to extend with walls or obstacles later
without changing how movement or vision is calculated.

### Character select

Before every match (AI, offline, and online) you pick one of 5 characters —
Cat, Fox, Penguin, Bear, or Panda — as your avatar, and enter a name, then
join/start. Swipe left or right on the character, or tap the ‹ › arrows.
The same 5 characters work whichever side you end up playing; in offline
mode each of the two players picks their own and keeps it even after roles
swap for round 2. The AI opponent always shows as 🤖, not a pickable
character.

### Powers (rechargeable)

Every power comes back **5 moves after you use it** — five of your own moves,
counted after the turn you used it on. The dashboard shows each item as
`ready` or `recharging · N`. This applies in all three modes.

**Stopper** (Thief) no longer freezes the Police — it lets the Thief **take
their turn twice in a row**: use it, then move, then move again immediately
before it becomes the Police's turn.

### Sound

Every sound is synthesized on the fly with the Web Audio API — there are no
audio files to load. A speaker icon in the top bar mutes/unmutes (saved in
`localStorage`). Sounds play for: a piece moving, the 8s turn clock's last 3
seconds, the match clock crossing 30 seconds left, each item having its own
distinct sound when used (Indicator, Jump, Stopper, Teleport), Police
catching the Thief, and the Thief winning on time. All of this works the
same across AI, offline, and online — including on the online guest, which
never runs its own game logic, by watching for the matching changes in the
snapshots the host sends every second.

**Thief**
- **Stopper** — freezes the Police for their next turn. Costs your turn to use.
- **Teleport** — jump instantly to a tile far from the Police. Costs your turn to use.

**Police**
- **Indicator** — reveals the Thief's rough compass direction (N/S/E/W or a
  combination), but never the distance. Costs your turn to use.
- **Jump** — move up to 4 tiles in one turn instead of 2. Replaces your normal move.

Each side gets exactly one turn's worth of action: a normal move, **or**
one of their two powers. Two different kinds of pause protect that:

- **Indicator** reveals its reading, then freezes the clock for 5 seconds
  *afterward* so you actually have time to read it before the turn moves on.
- **Stopper**, **Jump**, and **Teleport** freeze the clock the moment you
  click them — *before* anything happens — so you get unhurried thinking
  time to pick a destination tile (Jump/Teleport) or just confirm the play
  (Stopper). Once you act, the turn resolves immediately.

### Fog of war

- The Police only see the Thief's token when the Thief is within 3 tiles.
- The Thief only sees the Police's token when the Police is within 5 tiles.
- Outside those radii, the opposing token is simply not drawn — you're
  playing on partial information, same as the AI is.

## Sign-in & stats

The game sits behind a [Clerk](https://clerk.com/) sign-in gate (added
directly in `index.html`), and every signed-in player gets a stats page
(the 📊 button in the top bar):

- **Online · 2 Player** — total matches, total wins, total losses. These
  count one full two-round match (not each individual round) — whoever
  made the faster capture as Police across both rounds wins; if neither
  of you captures, it's a draw (counted as a match, but not a win or loss).
- **Vs AI** — wins as Police, wins as Thief. Only your own human-side wins
  count; the AI's wins aren't tracked.

**Stats are read client-side but can only ever be *written* by a server.**
They live in the player's Clerk account under `publicMetadata` — readable
from the browser, but writable only by something holding the Clerk *secret*
key. That's `api/record-stat.js`, a small Vercel Function, and it's the only
thing in the whole project allowed to change a stat. A player opening
devtools and calling `Clerk.user.update(...)` directly can't touch
`publicMetadata` at all — Clerk itself rejects it.

The client (`js/stats.js`) never sends a number. It sends an *event name* —
`"ai_win_police"`, `"online_match_win"`, etc. — and the server decides what
that's worth (always exactly +1 to the relevant counter; see the `ACTIONS`
table in `api/record-stat.js`). There's no field anywhere in the request for
an amount, so there's nothing to tamper with into an arbitrary value.

**What this does and doesn't protect against**, worth being honest about:
it stops a player from editing *their own stat number* to whatever they
want. It does **not** verify that a claimed win actually happened — in
online mode, the host's browser is still the sole authority on who won,
so a modified client could claim a false win just by hosting and reporting
one. Closing that would mean running match logic on a server you control,
which is a much bigger change than "secure the write." For a casual/friends
project, that's a reasonable line to draw; see `api/record-stat.js`'s
top comment for more.

### Deploying the server piece (Vercel)

The game was a pure static site before this; the one new requirement is
somewhere that runs `api/` as serverless functions alongside the static
files. [Vercel](https://vercel.com) does this with zero config — drop the
project in, it auto-detects `api/*.js` as Functions and serves everything
else as-is.

1. `npm install` (installs `@clerk/backend`, used only by `api/record-stat.js`).
2. In your Vercel project's **Settings → Environment Variables**, add:
   - `CLERK_SECRET_KEY` — from the Clerk Dashboard → API Keys → **Secret key**
     (never the publishable key, and never put this one in `index.html`).
   - `ALLOWED_ORIGIN` — optional but recommended: your deployed URL(s),
     comma-separated. Stops a session token from being lifted and replayed
     against the endpoint from some other site. See `.env.example` for the
     exact format, and `vercel dev` + `.env.local` if you want to run this
     locally first.
3. Deploy. `/api/record-stat` is live at the same origin as `index.html`,
   which is why `js/stats.js` can just `fetch("/api/record-stat")` with no
   base URL.

If you'd rather use a different host, anything that runs a Node function
on request works the same way — Netlify Functions and Cloudflare Pages
Functions are the usual alternatives, just with a different folder
convention than Vercel's `api/`.

If you swap Clerk for your own auth later, everything stats-related funnels
through `Stats.init()`, `Stats.recordAiWin()`, and `Stats.recordOnlineMatch()`
in `js/stats.js` on the client, and through `api/record-stat.js` on the
server — point those at whatever you use instead and the rest of the game
doesn't need to change.

## Online play

Online mode is peer-to-peer over WebRTC using [PeerJS](https://peerjs.com/)
(loaded from a CDN — still no build step or server of your own). The room code
is the host's PeerJS id.

- The **host's** browser runs the whole game (same engine as offline) and is the
  source of truth; the **guest's** browser sends its clicks and renders what the
  host sends back.
- The host only sends the guest the opponent's position when it is inside the
  guest's vision radius, so fog of war holds up online.
- The 8-second turn clock and 5-minute match clock run on the host and are
  mirrored to the guest. Rounds and scoring work as in offline mode.
- If either player disconnects mid-match, the match ends and the other player
  returns to the menu.

Needs an internet connection (for PeerJS and its free signaling server). Some
strict networks/NATs block direct WebRTC connections; the default setup has no
TURN relay, so in rare cases two players may be unable to connect.

## Project structure

```
police-vs-thief-game/
├── index.html          # page shell, setup / game / result screens, Clerk sign-in gate
├── css/
│   └── style.css        # dark tactical theme, layout, board styling
├── js/
│   ├── pathfinding.js   # BFS shortest-distance / shortest-path / vision helpers
│   ├── sound.js          # Web Audio synth — every in-game sound, no audio files
│   ├── game.js          # game state, rendering, turn loop, AI, timer
│   ├── online.js        # online mode: host/join, PeerJS networking, snapshots
│   └── stats.js          # stats screen + client half of the secure stats write
├── api/
│   └── record-stat.js   # Vercel Function — the only thing allowed to write stats
├── package.json          # one dependency (@clerk/backend) for api/record-stat.js
├── .env.example          # env vars record-stat.js needs (copy into Vercel's settings)
├── LICENSE
└── README.md
```

## The shortest-distance logic

`js/pathfinding.js` is the core reusable piece:

- `shortestDistance(a, b)` — BFS step-count between two tiles.
- `shortestPath(a, b)` — full shortest route between two tiles.
- `reachableWithin(origin, steps)` — every tile reachable within a move
  budget, used to highlight legal moves each turn.
- `sightDistance(a, b)` — Chebyshev distance, used only for the vision
  radii (an 8-directional "can I see you" check, separate from movement).
- `compassDirection(a, b)` — coarse direction label for the Police's
  Indicator power.

The AI uses these same functions: the Police AI chases the Thief's last
known position along the shortest BFS path, and the Thief AI evaluates
its reachable tiles each turn and picks whichever one maximizes shortest
distance from the Police.

## Ideas for extending this

- Add wall/obstacle tiles — `pathfinding.js` is already obstacle-ready,
  you'd only need to make `neighborsOf()` skip blocked cells.
- Persist match results with `localStorage` for a simple win/loss record.

## License

MIT — see [LICENSE](LICENSE).
