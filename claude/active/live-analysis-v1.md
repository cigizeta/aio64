# Live Analysis -- Plan v1

*Status: implemented (2026-10-09), awaiting test. Plan approved
2026-10-09. Additions: requests are debounced by 150 ms while stepping;
Claude's own `analyze_position` is never dropped, only the widget's
`engine_lines`; the panel keeps a three-line height so the tabs do not
jump.*

## Goal

Users expect Stockfish analysis wherever they are on the board. Every
position the widget shows is analyzed automatically: evaluation and the
three best lines, below the board. Explain no longer runs the engine; it
takes the analysis already shown and asks Claude to put it in English.

The load is fine for one user on a home PC: one Stockfish process, one
search at a time, every result cached.

## Decisions (developer, 2026-10-09)

- Live analysis of the current position (a whole-game review is a
  separate, later design).
- One search per position at the fixed depth (ANALYSIS_DEPTH, 20) with
  MultiPV 3, as today: deterministic, so Explain gives Claude exactly what
  is on screen. No shallow first pass: Stockfish reaches depth 20 in about
  a second, and depth 12 is unreliable.
- No progress updates: over the HTTP transport, the widget's calls go
  through claude.ai, so each poll would be a full round trip. The panel
  shows "analyzing..." until the answer.
- Placement: below the board, between the controls and the tabs (above
  the board, changing line lengths would move the board).

## Server

- `engine_lines` (app-only) is unchanged in shape: FEN in, cached or
  fresh analysis out. Its structured result gains the lines themselves:
  `lines: [{ eval, san }]`, the eval from White's point of view as today,
  the moves in SAN cut to 8 plies.
- The engine queue: only the latest request matters. When a new search
  is queued while others wait, the waiting ones are dropped (answered
  "superseded", nothing cached); the running search finishes and is
  cached. Stepping quickly through moves never builds a backlog.

## Widget

- On every position change (navigation, a move played, a game added,
  opening the board): if the position is in the widget's analyses, show
  it at once; otherwise show "analyzing..." and call `engine_lines`.
  Answers for a position no longer current are kept but not shown.
- Panel: three lines, `+0.32  e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6`; mate as
  `#3` / `#-3`; game over shows the result text instead. The status line
  keeps the move label and the best line's eval; the arrows stay.
- Lines are text only for now (clicking a line to play it: later).
- Explain: no engine call. It waits for the current position's analysis
  if still running, then saves the board and fills the message as today,
  with the same analysis text.
- Collapsed (stale) widgets never analyze.

## Files

```
src/engine.ts      drop waiting searches when a newer one is queued
src/server.ts      engine_lines: lines in the structured result
widget/board.html  analysis panel
widget/board.ts    analyze on every position; Explain uses it
```

## Tests (developer, web)

1. Restart; reconnect (widget changed).
2. Open a board: the start position's lines appear within about a second.
3. Step through a game: each move shows "analyzing..." then lines; going
   back shows them at once (cached).
4. Hold the forward button down: no backlog, the final position's lines
   arrive soon after stopping (server log: few searches, not one per move).
5. Explain: the message is filled at once, with the lines on screen.
6. A checkmate position: the result text, no lines.
