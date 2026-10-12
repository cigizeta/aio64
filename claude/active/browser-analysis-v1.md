# Browser Analysis -- Plan v1

*Status: implemented (2026-10-09), awaiting test. Plan approved
2026-10-09. A depth counts as complete when all expected lines (3, or
fewer legal moves) have reached it. Original status: plan, awaiting
approval (2026-10-09). Follows
browser-engine-spike-v1.md (answer: yes, Stockfish.js runs in the widget
on claude.ai) and replaces the server analysis of live-analysis-v1.md.*

*Addition (developer, 2026-10-09): the engine (loader and `.wasm`, the
lite NNUE compiled in) is kept in IndexedDB (database `aio64`, store
`engine`, one entry), as Lichess keeps its networks; the manifest carries
a version (hash of the `.wasm`) and a mismatch downloads again. Storage
failures fall back to downloading. While testing whether claude.ai's
sandbox keeps IndexedDB between widgets, the depth label shows `· cache`
or `· download`.*

*Verdict (developer, 2026-10-10, engine-cache-test-v1.md): claude.ai
resets the widget's IndexedDB at each new chat. Within a chat it lasts,
even across a page reload, so only the first board of each chat
downloads the engine.*

## Goal

All analysis runs in the widget, in the browser: Stockfish.js 19 lite
single-threaded (WebAssembly), infinite analysis, MultiPV 3, depths shown
live. The server's Stockfish goes away. Claude explains from the browser
engine's analysis, sent by the widget.

Why: progress notifications cannot reach a widget through claude.ai
(depth-progress-spike-v1.md), and the browser engine is much faster than
a tool call: no round trip through claude.ai and ngrok, no server queue.

## Decisions (developer, 2026-10-09)

1. `engine_lines` is removed, and with it every server-side analysis.
2. Engine: Threads 1, Hash 16 MB, MultiPV 3, `go infinite` on every
   position shown.
3. Explain (button) sends the current analysis, whatever its depth, but at
   least depth 20: pressed earlier, it waits for depth 20.
4. `explain_position` (called by Claude with a FEN) opens the board and,
   when the analysis reaches depth 20, fills the user's message box with
   the Explain prompt by itself (the deepest analysis available at that
   moment, at least 20). The user presses Enter; Claude explains.
   `open_board` opens a board and proposes nothing.
5. `explain_position` returns no analysis to Claude (it has none): "Board
   opened at the position; the analysis runs in the widget, which will
   propose the explanation prompt."

## Server

- Remove: `src/engine.ts`, the analysis cache, `engine_lines`,
  `analyzeFen`, `explained` in board results, `STOCKFISH_PATH` (startup
  check, `.env.example`), `ANALYSIS_DEPTH`, `ANALYSIS_LINES`, and the
  analysis helpers no longer used in `src/analysis.ts` (`treeFens` etc.;
  `gameOverText` may stay if useful).
- Keep, no longer marked as a spike: the engine resources (manifest,
  loader, `.wasm` in base64 pieces of 400 kB), read by the widget through
  claude.ai. They are loaded from `node_modules/stockfish` at startup, so
  `stockfish` moves from devDependencies to dependencies.
- `explain_position`: validates the FEN, opens the board, and marks the
  result `propose: true` so the widget proposes the prompt.

## Widget

- `widget/engine.ts` (replaces `engine-spike.ts`): downloads the engine
  (manifest, loader, pieces), starts the worker, sets the options, and
  analyzes the position on screen: `stop`, `position fen`, `go infinite`.
  Parses `info` lines (MultiPV 1 to 3, skipping bound scores), keeps the
  deepest complete depth, reports it.
- Hash kept between positions (no `ucinewgame`): stepping through a game
  reuses earlier work.
- Per position (position key), the deepest analysis seen is kept in the
  widget, so returning to a position shows it at once while the search
  resumes.
- Panel: `depth N` in the panel's first row, then three lines in SAN
  (converted with chessops), eval from White's point of view, 8 plies.
  While the engine loads: "loading engine..."; a failure shows its reason.
  Game over (mate, stalemate): the result text, no search.
- Explain: waits for depth 20 if needed, then sends the current analysis:
  "Stockfish 19 lite (browser), depth N" and the three lines, as the
  server text did, plus the FEN, the main game and the saved-state
  instruction as today.
- `propose` (from `explain_position`): only for the newest widget, once,
  when depth 20 is reached: the same Explain message is sent.
- A collapsed (superseded) widget terminates its worker.
- The temporary `browser:` line goes away.

## Docs

- CLAUDE.md: "runs Stockfish behind the hood" and the Licensing section
  (the widget embeds Stockfish.js, GPLv3; no engine install needed).
- README: requirements without Stockfish.
- TODO.md: drop the polling entries (superseded); keep the ext-apps
  recheck as a note.

## Tests (developer, web)

1. Restart (no STOCKFISH_PATH needed); reconnect (tools changed).
2. Open a board: "loading engine...", then depths climb with three lines.
3. Step through a game: each position analyzes at once; going back shows
   the previous depth immediately.
4. Explain right away: waits until depth 20, then fills the message with
   the depth reached.
5. Paste a FEN and ask Claude to explain it: the board opens and, at depth
   20, the prompt appears by itself.
6. A checkmate position: result text, no lines.
7. An older widget collapses: its analysis stops.
