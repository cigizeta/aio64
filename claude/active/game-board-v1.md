# Game Board -- Plan v1

*Status: stage 1 done; stage 2 implemented (2026-10-09), awaiting test. Plan approved 2026-10-09.

**Change after testing (developer, 2026-10-09): only the newest widget is
enabled, whatever it shows.** Sessions are dropped; the server remembers
one newest viewer ID, and every older widget collapses, also when the new
widget shows something unrelated. `viewer_status(viewerId)` only.* Implements the unified
widget designed in lichess-games-v1.md; replaces the viewer of
game-viewer-v2.md.*

## Goal

One board widget for everything: step through a game, play any legal
move, see the chosen player's own games from the current position (player
database only), load one of them in place, and Explain any position.

Two stages, each tested on its own.

## Tools after both stages

| Tool | Visible to | Purpose |
|---|---|---|
| `open_board` | Claude | open the widget (game, position, search, or saved state) |
| `analyze_position` | Claude | Stockfish on a FEN, widget with arrows |
| `engine_lines` | widget | Stockfish for Explain (unchanged) |
| `save_board` | widget | store the widget state, return a short ID |
| `viewer_status` | widget | is this widget still the newest of its session? |
| `explore_position` | widget | player database: moves and recent games (stage 2) |
| `load_game` | widget | a finished game's data, to load in place (stage 2) |

All read-only (`readOnlyHint: true`). `show_position` and `open_game` are
removed. **Disconnect and reconnect** after each stage.

## Stage 1: unified board, no explorer

### Board state

```
{ startFen, line: SAN[], ply, game?: { id, white, black, ratings, result },
  player, color, session }
```

- `line` is the single current line from `startFen`; `ply` the position
  shown (0 = `startFen`).
- `game` is set while the line is a loaded game; cleared when the line
  leaves it. The header then reads "Exploring".
- `player` and `color` belong to the explorer (stage 2) but are carried
  from stage 1 so the state format does not change. Default player:
  `LICHESS_USER`; default color: White, or the player's color in a loaded
  game.
- `session` groups a widget and its re-shows; only the newest widget of a
  session stays usable.

### `open_board(game?, ply?, fen?, player?, color?, state?)`

- description: "Open an interactive chess board: a Lichess game (ID or
  URL), a position (FEN), or a player's own games to explore." Parameter
  descriptions kept to a few words each.
- Precedence: `state` > `game` (+ `ply`) > `fen` > start position.
- `state`: look up the saved state; unknown ID (e.g. after a restart) ->
  start position, text "Saved board not found; opened at the start."
- `game`: as `open_game` today (cache, finished check, standard only).
- Creates a viewer ID, records it as the newest of its session (new
  session unless reopening a state).
- Result text for Claude: one line ("Opened: X vs Y, 0-1, 42 moves,
  Sicilian." / "Board opened." / "Board reopened."), plus
  `structuredContent` with the state, viewer ID, and cached evaluations
  for the line's positions.

### `save_board(state)` (app-only)

Stores the state in memory under an 8-character random ID; returns it.
Bounded to 1000 states (oldest dropped). Memory only.

### `viewer_status(session, viewerId)` (app-only)

Replaces the per-game check: newest per session.

### Widget

- Built from the state: positions computed with chess.js from `startFen`
  and `line`.
- **Moves on the board:** chessground `movable` with legal destinations
  from chess.js, both colors. A move equal to the line's next move just
  steps forward (the game stays loaded). Any other move keeps the line up
  to the current ply, appends the move, clears `game`. Promotion: queen
  (an underpromotion picker can come later).
- Controls unchanged: Beginning | Back | Forward | End | Explain.
- **Explain:** engine_lines as today; then `save_board` with the current
  state; message:
  ```
  Explain this position (<game context or "exploring">, after <move>).
  FEN: <fen>
  <engine text>
  After explaining, call open_board with state "<id>".
  ```
- Staleness: as in game-viewer-v2.md, per session.
- `analyze_position` opens the same widget with `startFen` = the FEN,
  empty line, arrows shown.

## Stage 2: explorer panel

### `src/explorer.ts`

- The only function builds
  `https://explorer.lichess.ovh/player?player=&color=&fen=&recentGames=8`
  and nothing else: **no code path can reach `/masters` or `/lichess`.**
- Bearer token (scopeless, already verified at startup).
- The response is NDJSON with progressive updates while Lichess indexes
  the player's games; read until the stream ends or 15 s pass, keep the
  last complete line; flag `indexing: true` if it was cut short.
- Cache by (player, color, FEN) for 10 minutes (new finished games appear
  later).

### `explore_position(player, color, fen)` (app-only)

Returns compactly: `moves: [{ uci, san, games, white, draws, black,
performance }]` and `recentGames: [{ id, opponent, opponentRating,
result, speed, month }]`, plus `indexing`.

### `load_game(game, fen)` (app-only)

The game data (same checks as `open_board`: finished, standard) and the
first ply whose position matches `fen` (board, side to move, castling,
en passant; move counters ignored).

### Widget panel (below the controls)

- Player field (prefilled) and a White/Black switch.
- Moves list: `e4  45  +22 =7 -16  1876`; clicking plays the move.
- Recent games: `JXGbrtW4  2026-10  vs PAPOR123 (1964)  1-0  corr.`;
  clicking loads it in place at the searched position.
- Refreshes when the position, player or color changes, debounced
  (300 ms) to spare Lichess while stepping quickly; "indexing..." while
  Lichess builds the player's index.
- Nothing from the panel goes to Claude.

## Files

```
src/server.ts      open_board, save_board, viewer_status; remove
                   show_position, open_game; explore_position, load_game
src/cache.ts       saved states, sessions, explorer cache
src/explorer.ts    new (stage 2): player database only
src/analysis.ts    FEN matching helper (stage 2)
widget/board.ts    state model, movable board, Explain with state, panel
widget/board.html  panel markup and CSS
```

## Tests (developer, web)

Stage 1:
1. Reconnect. "Open Lichess game <id>": game loads; step through.
2. Drag a different move: header "Exploring", line continues from there.
3. Explain while exploring: answer, then a new widget below with the same
   line and position; the old one collapses.
4. "Show me this position: <FEN>" -> Claude uses `open_board`.

Stage 2:
5. Reconnect. "Search my games": panel shows cigizeta's moves as White.
6. Click moves down a line; switch to Black; change the player.
7. Click a recent game: it loads in place at that position.
8. Server log: only `/player` explorer URLs.

## Results

- **Stage 1 works on web (2026-10-09):** game loading and stepping,
  dragging moves into "Exploring", Explain with re-show from a saved
  state, `open_board` for a FEN, and only the newest widget enabled.

- **Stage 2 works on web (2026-10-09)** as a first version; needs
  refinement. `explore_position` feels slow: the server now logs the
  Lichess time per request (`explore lichess <ms>` / `explore cached`) to
  split it from the claude.ai round trip and the 300 ms debounce.

## Open questions

- Is the panel too tall inline with the board? (Possibly collapsible.)
- Does Claude reliably prefer `open_board` for "show me this position"?
