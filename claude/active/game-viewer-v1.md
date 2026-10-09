# Game Viewer -- Plan v1

*Status: implemented (2026-10-09), awaiting test. Implements the first
version designed in lichess-games-v1.md.*

## Goal

The developer pastes a Lichess game ID in the chat; Claude opens the game
in a viewer widget; the developer steps through it and presses Explain on
any position; Stockfish's result appears on the board and goes to Claude,
who explains it.

## Prerequisites (done, 2026-10-09)

`.env` has `LICHESS_USER` and `LICHESS_TOKEN`; the token was verified by
hand with `POST /api/token/test`: right user, `scopes` empty, no expiry.

## Server

### Lichess token check at startup (`src/lichess.ts`)

- `POST https://lichess.org/api/token/test`, body the token.
- **Panic on any scope** (developer, 2026-10-09): if `scopes` is not
  empty, the server aborts immediately, before listening, with a loud
  fatal message naming the scopes found and telling the developer to
  revoke that token on Lichess and create one with no scopes; exit code
  non-zero. There is no override and no way to start anyway.
- Also fatal: token unknown to Lichess, `userId` different from
  `LICHESS_USER` (case-insensitive), or Lichess unreachable (fail
  closed). No message ever prints the token.

### Fetching a game (`src/lichess.ts`)

- `GET https://lichess.org/game/export/<id>?moves=true&clocks=false&evals=false&opening=true`
  with `Accept: application/json` and `Authorization: Bearer <token>`.
- Read: `status`, `variant`, `initialFen` (if present), `moves` (SAN,
  space-separated), `players.white|black.user.name` and `.rating`,
  `winner`, `opening.name`.
- **Refuse unfinished games:** `status` `created` or `started` -> tool
  error "This game is not finished; Aio64 analyzes finished games only."
- Refuse non-standard variants (chess960, crazyhouse, ...) for now:
  "Only standard chess is supported." `fromPosition` is accepted (it has
  an `initialFen`).
- 404 -> "No Lichess game with ID <id>." 429 -> "Lichess rate limit;
  try again in a minute."
- Only GET requests (plus the token test). Nothing is ever written.

### Tools

All tools get `annotations: { readOnlyHint: true }` (also the existing
`show_position` and `analyze_position`).

- **`open_game(game)`** (model-visible)
  - description: "Open a finished Lichess game in a board viewer.";
  - input `game`: an 8-character game ID or a Lichess game URL (the ID is
    extracted: the first 8 characters of the path);
  - result text for Claude, short: "Opened: <white> (<rating>) vs
    <black> (<rating>), <result>, <N> moves, <opening>.";
  - `structuredContent: { game: { white, black, whiteRating,
    blackRating, result, initialFen, moves } }` for the widget.
- **`engine_lines(fen)`** (app-only: `_meta.ui.visibility: ["app"]`, not
  in Claude's tool list)
  - same engine call and formatting as `analyze_position`;
  - returns the compact text plus `structuredContent: { fen, eval,
    arrows }`, where `eval` is the first line's White-view score string.
- `show_position` and `analyze_position`: unchanged apart from the
  read-only annotation.

## Widget (same `board.html`, one resource)

The widget becomes a viewer when the tool result carries `game`;
otherwise it behaves as today (single position, optional arrows).

Layout, top to bottom:

1. **Header:** `cigizeta (1850) vs opponent (1872), 0-1`.
2. **Board:** view-only chessground, no coordinates, last move
   highlighted (`lastMove`).
3. **Status line:** current move (`23...Nf6`, or `Start` before move 1)
   and, if Explain has run here, the evaluation (`+0.42`).
4. **Controls:** Beginning of game | Back | Forward | End of game |
   Explain.

Behavior:

- Positions are computed in the widget with chess.js from `initialFen`
  and the SAN moves (chess.js is bundled into the widget).
- The viewer opens at the start of the game.
- Back/Forward/Beginning/End move the current ply; buttons are disabled
  at the ends.
- **Explain:**
  1. disable the button, status line shows "analyzing...";
  2. `app.callServerTool({ name: "engine_lines", arguments: { fen } })`;
  3. draw arrows, show the evaluation, remember both for this ply (shown
     again when the developer comes back to it);
  4. `app.sendMessage` with a user message: "Explain this position.\n
     FEN: <fen>\n<engine text>". Claude answers in the chat.
  5. On error, the status line shows it briefly; nothing is sent.
- Navigating away clears the arrows unless the new ply was explained.

## Files

```
src/lichess.ts       new: token check, game export
src/server.ts        open_game, engine_lines, read-only annotations,
                     token check before listening
widget/board.ts      viewer mode, controls, Explain flow
widget/board.html    header, status line, controls markup and CSS
```

## Test (developer, web)

1. `npm run typecheck`; restart `npm run dev`: the log shows the token
   check passed.
2. Disconnect and reconnect the connector (new tools).
3. In a new chat: "Open Lichess game <id>" with one of cigizeta's
   finished games. The viewer opens at the start.
4. Step through; Explain on a middlegame position: arrows and evaluation
   appear, a message is posted, Claude explains.
5. Go back and forth to the explained move: evaluation and arrows come
   back without a new analysis (no `engine_lines` call in the log).
6. A game in progress (if available) or a wrong ID: clear refusal.
7. Put a token with a scope in `.env` temporarily (or a wrong
   `LICHESS_USER`): the server refuses to start.

## Results (2026-10-09)

- Startup: `Lichess token verified: cigizeta, no scopes`. Reconnect read
  `tools/list`, `resources/list`, `resources/read` (new widget URI).
- A game opened in the viewer; Explain worked end to end.
- **`sendMessage` on claude.ai fills the message box; the developer
  presses Enter to send it.** The host never sends in the user's name by
  itself. Not changeable by Aio64, and consistent with its principles.

- **Scrolling problem** (developer): after each explanation the viewer is
  above, out of sight; scrolling back up each time is not acceptable.
  First attempt: picture-in-picture. The widget declares `inline`, `pip`,
  `fullscreen`; a temporary probe shows the host's
  `availableDisplayModes` in the header; a pin button (shown only if the
  host offers `pip`) toggles pip/inline. If claude.ai has no pip, the
  fallback (to be discussed) is to show the viewer again inline after
  each answer.
- **Probe result (web, 2026-10-09):** claude.ai reports
  `availableDisplayModes: inline, fullscreen`. No pip. Next test: the pin
  button became a fullscreen toggle, to see whether claude.ai's
  fullscreen keeps the chat usable next to the viewer.

- **Fullscreen test:** bad user experience (developer). Dropped, as is
  pip (not offered). The probe and the fullscreen button will be removed.

## Re-show design (developer, 2026-10-09), for game-viewer-v2.md

- **A fresh viewer after every Explain answer.** A widget can only appear
  as the result of a tool call by Claude, so the Explain message also asks
  Claude to reopen the viewer: `open_game(game, ply)` at the same move.
  The new viewer appears below the answer.
- **Old viewers collapse to one line** ("Continued below"). The server
  knows the newest viewer per game (it creates them, each with an ID);
  an old viewer asks the server, via an app-only tool, when it scrolls
  into view or is clicked, and collapses if it is no longer the newest.
- **Server caches** (in memory, lost on restart, which is harmless):
  - games by ID: finished games never change, so reopening does not call
    Lichess again;
  - analyses by FEN: fixed depth and one thread make results
    deterministic, so a new viewer shows the arrows and evaluations of
    already explained positions without re-running Stockfish.

## Open questions

- Is the viewer's height fine inline, or is fullscreen needed?
