# Lichess Games -- Design v1

*Status: design discussion in progress (2026-10-09). No plan yet.*

## Goal

Let Claude review the developer's own past Lichess games, with Stockfish
through Aio64, and explain them in human language.

## Settled (developer, 2026-10-09)

- **Never a tool for cheating.** Lichess games are analyzed only once
  finished; the server checks the game status from the Lichess API and
  refuses games in progress. Enforced in code, not left to Claude.
- `analyze_position` stays unrestricted: copying a FEN by hand is too slow
  to help in a live game, and correspondence games cannot be policed by
  Aio64 anyway.
- **Token:** `LICHESS_TOKEN` in the ignored `.env`, created with **no
  scopes** (least privilege: exporting public games needs none; the token
  only raises rate limits and identifies the developer).

- **Token rights enforced at startup.** The server calls
  `POST https://lichess.org/api/token/test` with the token (public
  endpoint, token in the body) and refuses to start unless the token is
  valid, has an empty `scopes` string, and belongs to the expected user
  (`LICHESS_USER` in `.env`). The developer can run the same check by
  hand with curl.
- **Aio64 is read-only.** No tool changes anything anywhere: no writes to
  Lichess (only GET requests, plus the token test), no files written, no
  moves played. Every tool is declared with the MCP annotation
  `readOnlyHint: true`.

## User experience (in discussion)

- **The widget is a game viewer.** The developer navigates the game in the
  widget (move by move) and asks for analysis of the current position.
- **Controls** (developer, 2026-10-09), in this order:
  Beginning of game | Back | Forward | End of game | Explain.
- **Viewer content** (developer, 2026-10-09):
  - header line: players, ratings, result;
  - the board, last move highlighted;
  - a status line: current move (e.g. `23...Nf6`) and, once Explain has
    run on this position, Stockfish's evaluation (e.g. `+0.42`, White's
    view). Evaluations are remembered per move for the open game, so
    going back to an explained move shows it again without re-running;
    arrows likewise.
  - the five controls.
- **One Explain button does both** (developer, 2026-10-09: seeing engine
  output without Claude makes no sense, that exists elsewhere):
  1. the widget calls Aio64 (`callServerTool`) for Stockfish's lines and
     draws arrows and the evaluation at once;
  2. the widget sends the result into the chat (`sendMessage`): position,
     the move actually played, the engine lines; Claude explains it in
     human language. Stockfish runs once per click; Claude does not
     re-run it.
- **Explain analyzes the position shown on the board** (developer,
  2026-10-09), i.e. after the current move, with the side to move next.
- **What Claude receives on Explain, for now:** only the FEN and
  Stockfish's result (the same compact text as `analyze_position`). No
  move history, side played, or clock times yet; those need more design.
- MCP Apps capabilities confirmed in the installed `ext-apps` types:
  `callServerTool`, `sendMessage`, `updateModelContext`,
  `requestDisplayMode` (e.g. fullscreen), and app-only tools
  (`visibility: ["app"]`), which stay out of Claude's tool list.

- **Opening a game, first version** (developer, 2026-10-09): the developer
  pastes a Lichess game ID (8 characters, e.g. `PAPOR123`) in the chat;
  Claude calls `open_game(id)`, which also accepts a full game URL and
  extracts the ID. Unfinished games are refused.
- **Any player's games** (developer, 2026-10-09): `open_game` accepts any
  finished Lichess game, not only the developer's (e.g. a Carlsen game).
  One scopeless token reads public games of every player, so several
  accounts need no switching.
- **One token only** (developer, 2026-10-09): `cigizeta`'s scopeless
  token, used to read finished public games of any user (allowed by
  Lichess). No token for `rotor-bot` or any other account.
- **The developer's accounts:** `cigizeta` now, `rotor-bot` later.
  `LICHESS_USER` is only the token's owner, for the startup check.
- **Finding games, later:** search tools work on any player's games; the
  player is always named in the request (no list of accounts in `.env`,
  developer, 2026-10-09). To be designed: criteria, result format, how a
  found game opens in the viewer.

## Game search (discussion started 2026-10-09, to continue)

Lichess API facts (`GET /api/games/user/{username}`, NDJSON stream,
newest first):

- Server-side filters: `since`/`until`, `max`, `vs` (opponent), `color`,
  `perfType` (bullet, blitz, rapid, classical, correspondence...),
  `rated`, `analysed`; finished games only by default (Aio64 asks for
  finished games explicitly).
- No server-side filter by result or opening; both are in each game, so
  Aio64 can filter them itself, scanning a capped number of games.

Proposed shape (not yet agreed): one model-visible `search_games` tool
returning one compact line per game (~20 tokens), e.g.
`abcd1234  2026-10-08  blitz  White vs Rossi (1872)  0-1  Sicilian
Najdorf`; Claude then calls `open_game` on the chosen ID.

**Superseded after lunch (developer, 2026-10-09): search by position, not
by form.** Forms were never useful to the developer.

- Source: the Lichess opening explorer's **player database**
  (`GET https://explorer.lichess.ovh/player?player=&color=&fen=&recentGames=`):
  for a player, color and position it returns the moves played from it
  (W/D/L, performance, opening name) and the recent games reaching it
  (ID, opponent, ratings, result, speed, month).
- **Never the Masters or Lichess databases** (developer). The code only
  ever builds `/player` URLs; no generic explorer function exists.
- Verified 2026-10-09: the explorer requires authentication since March
  2026, and the **scopeless token is accepted**. The response is NDJSON;
  Lichess indexes the player's games on demand and streams progressive
  updates; the last line is the complete answer (`queuePosition: 0`).
- Searching your own past games in an opening database is allowed by
  Lichess even in correspondence; engine use in unfinished games is not,
  and `open_game` keeps refusing unfinished games.
- A search widget, displayable on demand, is wanted.

## Unified widget (developer, 2026-10-09)

The viewer and the search widget are **one widget** (a Search button on
the viewer would have made them the same thing anyway):

- **Board:** the current position. Reached by stepping through a loaded
  game (Beginning | Back | Forward | End), by dragging any legal move, or
  by clicking a move in the explorer panel.
- **Explorer panel:** the chosen player's moves from the current position
  (games, W/D/L, performance) and their recent games reaching it, from the
  player database only. **Player and color are editable in the widget**,
  prefilled by Claude.
- **Clicking a recent game loads it in place**, at the searched position;
  no Claude turn.
- **Explain** works on any position on the board, from a game or explored.
- Ways in: `open_game`, a search request ("search my games", from the
  start position), `show_position`, `analyze_position`.
- Moving off a loaded game (confirmed: start simple; the widget may
  become a full PGN navigator with variations later): the widget keeps
  one current line of moves from the start; a loaded game sets it; a
  dragged or clicked move at ply n keeps the line up to n and continues
  with the new move, so the game is left and the header says
  "exploring". Forward/End follow the current line.
- **Re-show state** (developer, 2026-10-09): on Explain the widget stores
  its state (line, ply, player, color, loaded game) in server memory via
  an app-only tool and gets a short ID; the Explain message asks Claude
  to reopen with that ID only. Lost on server restart (the widget then
  opens at the start position). Memory only: no files written, so Aio64
  stays read-only.
- **One model-visible tool for the widget: `open_board`** (developer,
  2026-10-09, name chosen deliberately), with optional `game`, `player`,
  `color`, `state`, `fen`. Replaces `open_game` and, tentatively
  (developer: "might go away"), `show_position`. Claude's list becomes
  `open_board` and `analyze_position`; the latter also opens the unified
  widget, with arrows.

## One mode: a PGN tree (developer, 2026-10-09, after stage 2)

Clicking a game means "analyze it", which a single line handles badly.
Separate search and game modes were proposed and **rejected in favor of
one, more general mode: the widget becomes a PGN tree viewer.**

- One tree rooted at the start position. A dragged move adds or follows a
  branch; nothing is dropped.
- **Clicking a game in the explorer adds its line to the current tree**
  (sharing existing moves, branching where it diverges); the board goes to
  the searched position in that game.
- The explorer panel follows the current node. Explain works on any node;
  the re-show loop saves the whole tree.
- Implementation candidate: **chessops** (Lichess, GPL-3.0) for the tree,
  PGN, positions and SAN in the widget.
- **Layout:** below the board and controls, one area with two tabs,
  **Moves | Explorer** (developer, 2026-10-09).
- **Forward at a branch:** the last visited child, else the main line
  (developer, 2026-10-09).
- **Joining the tree** (developer, 2026-10-09, replacing "refuse set
  positions"): a game's line joins the tree at the highest node whose
  position it passes through (for a normal tree and game: the root, so
  the whole game). Otherwise it joins at the current node (the searched
  position, which the clicked game reaches by definition), discarding its
  earlier moves. This covers boards opened from a FEN and games from a
  set position. Refused only if the game passes through no position of
  the tree.
- Transpositions are not merged: a game reaching the searched position by
  another move order gets its own branch.
- **Labels** (developer, 2026-10-09: "use your scheme", may be revised
  later): the header describes the current node -- one game's players
  and result, "N games through here", or "Your analysis". **Revised after
  testing (developer, 2026-10-09): no game tags in the Moves text** (they
  piled up at the first move, where every game enters the tree); the
  header alone names the game of the current move.

## Third tab: recent games (developer, 2026-10-09, design only)

**Need:** review games right after finishing them on Lichess. The
Explorer is position-first (only games through the current position, 8 at
most); this tab is game-first.

- Tab name: **Games** (Moves | Explorer | Games).
- Lists the **player field's** last **10 finished games**, newest first,
  **both colors** (the White/Black switch does not filter it). Games in
  progress never appear: the server asks Lichess for finished games only.
- Compact rows: result from the player's view, the player's color,
  opponent and rating, speed, time since the game ended, e.g.
  `won  W  vs FosTerRon (1987)  corr  2 h ago`.
- Clicking a game **joins it to the current tree** (same joining rule as
  the Explorer) and shows the **end of the game**.
- **Main line** (developer, 2026-10-09, option 4 of the brainstorm): a
  game added from the **Games** tab becomes the main line of the whole
  tree (along its path, its move becomes the first child at every node;
  the previous main line becomes a variation where they diverge). Games
  added from the **Explorer** join as variations, as today.
- **Make main line** button in the controls (no "promote variation",
  no context menu), enabled only when the current move is in a
  variation. It promotes the line through the current move up to the
  root, and below the current move follows the branches last visited
  (what End would show), so pressing it anywhere on a game promotes the
  whole game. Only the order changes; nothing is dropped.
- Source: Lichess's user games export
  (`GET /api/games/user/{username}?max=10`, finished games, NDJSON),
  queried when the tab is opened; a short cache (about a minute) so that
  a just-finished game shows up quickly.

## Local Polyglot book (developer, 2026-10-09, design in progress)

- **Scope: only the Explorer tab** gets the option to show moves from a
  local Polyglot book. Nothing else (no review markers, no Explain
  context).
- The developer supplies the `.bin` file; **never committed**. Its path
  goes in the ignored `.env` (like `STOCKFISH_PATH`). Aio64 only reads it.
- Library candidate: `@echecs/polyglot` (with `@echecs/zobrist`, the 781
  standard keys); license to check on install (must be GPL-compatible).
  Verified at startup against the test keys of the Polyglot format
  specification (start position `463b96181691fc9c`, after 1.e4
  `823c9b50fd114196`), so a wrong key table fails loudly.
- **UI:** a source switch in the Explorer, **Games | Book**, one list at
  a time (developer, 2026-10-09).
- **Rows:** move and percentage of the total weight at this position,
  sorted by weight, e.g. `Nf3  45%`; clicking plays the move.
- **The file lives outside the repository** (e.g. a books folder
  elsewhere on the disk), with `POLYGLOT_PATH` in `.env`.

## Chess.com (developer, 2026-10-09)

Not through its API: the public Published-Data API has no lookup by game
ID and serves games only as whole monthly archives, which the developer
rules out. **Postponed.** Candidate alternative, not yet decided: an `open_pgn` tool for
a pasted PGN (any site), refusing results of `*`.

## Open topics

To discuss one at a time:

1. What a "review" of a game should give the developer (all moves, only
   mistakes, critical moments, opening phase, endgame...).
2. How games are chosen (recent list, by ID or URL, filters).
3. Engine cost per game (depth, number of positions, time) and how it
   fits a tool call.
4. Token economy: how much of a game reaches Claude's context.
5. Widget: one board per moment, or a game viewer to step through.
6. Lichess's own server analysis: reuse it when it exists?
