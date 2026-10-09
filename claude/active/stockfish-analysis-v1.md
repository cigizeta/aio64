# Stockfish Analysis -- Plan v1

*Status: plan, choices settled with the developer (2026-10-09), awaiting
approval. Step 2 of aio64-design-v1.md; builds on hello-board-spike-v1.md.*

## Goal

A second tool, `analyze_position(fen)`, that runs Stockfish on the
position and gives Claude a compact, reproducible summary of the best
lines, while the chat shows the board with arrows for those lines. Claude
then explains the position in human language.

Also: fix the board coordinates defect from Step 1.

## Decisions (developer, 2026-10-09)

- **Search limit:** fixed depth.
- **Threads:** 1, so that the same position always gives the same lines
  and evaluation.
- **Tool parameters:** none besides `fen`. Everything else fixed
  server-side.
- **Depth 20, 3 lines**, both configurable in `.env`
  (`ANALYSIS_DEPTH=20`, `ANALYSIS_LINES=3`).
- **Result text:** compact, evaluation from White's point of view, SAN
  with move numbers, each line cut to 8 plies.
- **Widget:** the same board, with an arrow for each line's first move.

## Result format

```
Stockfish 19, depth 20
1) +0.31  3...a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3
2) +0.35  3...Nf6 4.O-O Nxe4 5.Re1 Nd6 6.Nxe5 Be7 7.Bf1
3) +0.52  3...Bc5 4.c3 Nf6 5.d4 exd4 6.e5 Ne4 7.O-O
```

- Evaluation: centipawns / 100, two decimals, explicit sign, from White's
  view (UCI reports the side to move's view; negate when Black is to
  move). Mates as `#3` (White mates in 3) or `#-3` (Black mates in 3).
- Moves: UCI PV converted to SAN with chess.js, numbered from the FEN's
  fullmove number; a line starting with Black's move begins `N...`.
- The engine name and version come from the UCI `id name` line.
- Fewer lines than requested when the position has fewer legal moves.
- Game already over: no engine call; the text says "Checkmate: White
  wins." / "Checkmate: Black wins." / "Stalemate." and the board is shown
  without arrows.

## Engine wrapper (`src/engine.ts`)

- Spawn `STOCKFISH_PATH` directly with `child_process.spawn` (no shell),
  lazily on the first analysis. Exit at startup if `STOCKFISH_PATH` is
  missing or does not exist.
- Handshake: `uci` -> read `id name`, wait `uciok`; `setoption name
  Threads value 1`; `setoption name Hash value 64`; `setoption name
  MultiPV value <ANALYSIS_LINES>`; `isready` -> `readyok`.
- Per analysis, for reproducibility: `ucinewgame` (clears the hash),
  `isready`/`readyok`, `position fen <fen>`, `go depth <ANALYSIS_DEPTH>`.
- Parse `info` lines: keep, per `multipv` index, the last line with
  `depth == ANALYSIS_DEPTH` (skip `lowerbound`/`upperbound` lines); finish
  on `bestmove`.
- One search at a time: a promise queue serializes calls (Claude may
  call twice in parallel).
- Safety timeout: if no `bestmove` after 60 s, send `stop`, and use what
  was collected.
- If the process exits or errors, the current call fails with a short
  tool error and the next call respawns the engine.
- Kill the engine on server shutdown (SIGINT).

## Formatting (`src/analysis.ts`)

Pure functions, no I/O: UCI score + side to move -> White-view string;
UCI PV + FEN -> numbered SAN string cut to 8 plies; lines -> result text;
lines -> arrow list.

## Tool

`analyze_position`:

- description: "Analyze a chess position with Stockfish and show it on a
  board.";
- input `{ fen: string }`; validated with chess.js as in `show_position`;
- `_meta.ui.resourceUri: "ui://aio64/board.html"` (same widget);
- result: the text above, plus `structuredContent: { fen, arrows }`, with
  `arrows: [{ from, to }]` in line order.

`show_position` is unchanged.

## Widget changes

- If `structuredContent.arrows` is present, set them as chessground
  `drawable.autoShapes`: first line brush `green`, the others
  `paleGreen`. Otherwise clear shapes.
- **Coordinates: none** (developer, 2026-10-09). Aio64 is for the
  developer alone, who does not need them; this also removes the Step 1
  defect (chessground's base CSS places them for Lichess's own layout).

## Files

```
src/engine.ts        new: UCI process wrapper
src/analysis.ts      new: formatting
src/server.ts        register analyze_position; config for depth/lines
widget/board.ts      arrows
widget/board.html    coordinates CSS
.env.example         ANALYSIS_DEPTH, ANALYSIS_LINES
```

## Test (developer, web)

1. `npm run typecheck`, then restart `npm run dev`.
2. "Analyze the position after 1.e4 e5 2.Nf3 Nc6 3.Bb5." -> board with
   three arrows, Claude explains in plain language.
3. Ask again in a new chat -> identical lines and evaluations.
4. A mate-in-N position and a finished game (checkmate) -> `#N` and the
   "Checkmate" text.
5. Coordinates readable and inside the board.
6. Note the time per analysis in the server log (one line per analysis:
   depth, ms).

## Results (2026-10-09)

- First try: Claude called `show_position` only and quoted "+0.2 to
  +0.3" from its own knowledge; no analysis in the server log. claude.ai
  had cached the tool list from when the connector was added (only
  `show_position` existed). **Whenever a tool is added or renamed, refresh
  the connector** (reconnect, or remove and re-add) before testing.
- Verified not to refresh the cached list: a new chat; a page reload plus
  a new chat (no request reached the server at all). The server now logs
  each JSON-RPC method to observe this.
- **Works: disconnect and reconnect** the connector in Settings >
  Connectors (no need to remove and re-add). This is the standard refresh
  after adding or changing a tool.
- **Analysis works:** Claude called `analyze_position`; depth 20 gave
  3...Nf6 +0.26, 3...a6 +0.36, 3...Be7 +0.39, and Claude quoted them.
- **Stale widget:** the board still showed coordinates although the
  server served the new build (`resources/read` contained
  `coordinates:!1`). claude.ai caches widget HTML by URI. Fix: the URI now
  carries a hash of the built HTML (`ui://aio64/board-<hash>.html`).
- **After the hash fix (reconnect + new chat): success.** Arrows shown,
  no coordinates.
- Still to check: reproducibility (same lines in another new chat), mate
  and checkmate positions, time per analysis.

## Open questions

- Is depth 20 single-threaded fast enough in sharp middlegames? Tune
  `ANALYSIS_DEPTH` if needed.
- Does Claude choose `analyze_position` over `show_position` when asked
  to "explain" a position, without extra description text?
