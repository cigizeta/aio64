# Game Viewer -- Plan v2

*Status: implemented (2026-10-09), awaiting test. One deviation from the
plan: navigation buttons do not wait for the staleness check (a round
trip through claude.ai would make every step sluggish); they check in the
background and collapse the viewer when the answer arrives. Explain still
waits for the check.*

*Original status: plan, awaiting approval (2026-10-09). Implements the re-show
design recorded in game-viewer-v1.md.*

## Problem

After each Explain, Claude's answer pushes the viewer out of sight and the
developer must scroll up. claude.ai offers no picture-in-picture (only
inline and fullscreen), and fullscreen was a bad experience.

## Design (settled)

- A fresh viewer appears below Claude's answer after every Explain, at
  the same move: the Explain message asks Claude to call
  `open_game(game, ply)`.
- Older viewers of the same game collapse to one line, "Continued below".
- The server caches games by ID and analyses by FEN, so reopening costs
  no Lichess call and no engine run, and the new viewer shows earlier
  explanations at once.

## Server

### Caches (`src/cache.ts`, in memory)

- `games: Map<id, Game>`: finished Lichess games never change.
- `analyses: Map<fen, result>` with the formatted text, `eval` and
  `arrows`. Results are deterministic (fixed depth, one thread), so the
  FEN alone is the key; depth and lines are fixed for the process
  lifetime. Bounded: above 5000 entries the oldest are dropped (Map keeps
  insertion order).
- Lost on restart; harmless.

`analyzeFen` (shared by `analyze_position` and `engine_lines`) checks the
cache before calling Stockfish and logs `analysis cached` on a hit.

### Viewers

- Every `open_game` call creates a viewer ID (random UUID) and records it
  as the newest for that game: `newestViewer: Map<gameId, viewerId>`.
- New app-only tool **`viewer_status(viewerId, gameId)`** returns
  `{ newest: boolean }`. Read-only.
- Note: the map is per game, across all chats. Opening the same game in
  another chat collapses the viewers in the first chat when they are next
  checked. Acceptable for a single user.

### `open_game(game, ply?)`

- New optional input `ply`: half-moves played (0 = start position). The
  description says so in a few words: "ply: half-moves from the start, to
  reopen at a position".
- Uses the game cache; Lichess is called only on a miss.
- Computes every ply's FEN (chess.js) and collects cached analyses:
  `explained: { [ply]: { eval, arrows } }`.
- `structuredContent: { game, gameId, viewerId, ply, explained }`.
- Text for Claude unchanged on first open; on reopen (`ply` given) just
  "Viewer reopened at ply <n>." to keep context small.

## Widget

### Opening

Opens at `ply` (default 0) and fills its per-ply memory from `explained`.

### Explain message

```
Explain this position (Lichess game <gameId>, after <move>, ply <n>).
FEN: <fen>
<engine text>
After explaining, call open_game with game "<gameId>" and ply <n>.
```

### Staleness

- An `IntersectionObserver` on the viewer: when it becomes visible, call
  `viewer_status`. Every button click also checks first and does nothing
  if stale.
- Stale -> hide header, board, status and controls; show one line:
  "Continued below". The host's auto-resize shrinks the iframe.
- If the check fails (network), the viewer stays usable.
- Single-position widgets (`show_position`, `analyze_position`) never
  collapse.

### Cleanup

Remove the `[modes: ...]` probe, the fullscreen button and the
`availableDisplayModes` declaration (inline only).

## Files

```
src/cache.ts         new: game and analysis caches, newest viewer map
src/server.ts        open_game(game, ply?), viewer_status, cached analyzeFen
src/lichess.ts       unchanged
widget/board.ts      open at ply, explained map, Explain message, staleness
widget/board.html    collapsed line, fullscreen button removed
```

## Test (developer, web)

1. Typecheck; restart; **disconnect and reconnect** (tool changes).
2. Open a game; Explain at some move; send the filled message.
3. Claude explains, then a new viewer appears below at the same move,
   showing the evaluation and arrows (log: `analysis cached` if anything
   was re-analyzed, no Lichess fetch).
4. Scroll up: the old viewer shows "Continued below".
5. Explain again in the new viewer: the loop repeats.

## Results (2026-10-09)

**Works on web** (developer): after each Explain answer a new viewer
appears below at the same move with its evaluation and arrows; older
viewers collapse; the loop repeats.

## Open questions

- Does Claude reliably call `open_game` after explaining? If not, the
  wording of the Explain message is the first thing to tune.
- Is the one-line collapsed viewer enough, or should it link to the
  newest one?
