# TODO

## Next

- Design the game search tools (lichess-games-v1.md, "Finding games").
- More context for Explain (side played, clocks, move history): needs
  design (lichess-games-v1.md).

## Before going public

- License: done 2026-10-09, Aio64 is AGPLv3 only (`LICENSE`,
  `package.json`, CLAUDE.md, README). Why: the developer's goal is that
  nobody makes money by forking or using the code; no standard license
  forbids commercial use, and non-commercial ones (PolyForm Noncommercial,
  CC BY-NC) are incompatible with the GPL code Aio64 uses. Left: add the
  AGPL notice to the source files' headers if wanted, and consider a short
  legal consultation (this was not legal advice).
- License check of every bundled or installed component. Checked
  2026-10-09, all GPLv3-compatible: stockfish (Stockfish.js, GPL-3.0),
  chessground and chessops (GPL-3.0-or-later), chess.js (BSD-2-Clause),
  MCP sdk, ext-apps, zod, @echecs/zobrist (MIT). Still to do: confirm the
  license of the Stockfish 19 lite NNUE net (sscg13) embedded in the
  `.wasm`; keep Stockfish.js's notice ("Stockfish.js (c) 2026, Chess.com,
  LLC, GPLv3"), credit it in the README, and point to its source at the
  version used (corresponding source of the `.wasm`). Recheck after any
  dependency is added.
- OAuth instead of the static `x-api-key` header.
- Git history: check for the ngrok domain (`git log -S`); rewrite or start
  the public repository from a fresh commit.
- README for other users: requirements (Volta, ngrok, scopeless Lichess
  token; no Stockfish install, the widget runs Stockfish.js), setup,
  connector configuration.
- Move finished docs from `claude/active/` to `claude/done/`.

## Later

- Note: progress notifications cannot reach a widget through claude.ai
  (depth-progress-spike-v1.md). Solved differently: the engine runs in the
  widget (browser-analysis-v1.md). Worth knowing if a server-side long
  task ever needs to report progress; recheck after upgrading
  `@modelcontextprotocol/ext-apps`.

- Game-end comments in the Moves text (e.g. `{vs X: 0-1, resignation}`).
  Postponed: unsolved when a game ends where other games or analysis
  continue (comment mid-line, mark, status line, or nothing). How a game
  ended (Lichess `status`) is not kept by the server today.

- claude.ai first calls `server/discover` (a newer MCP discovery method);
  our SDK answers 400 and claude.ai falls back to `initialize`. Harmless;
  recheck after upgrading `@modelcontextprotocol/sdk`.

## When away from the PC

- Check the board widget in the Claude mobile app (server and ngrok must
  be left running). When it passes, move hello-board-spike-v1.md to
  `done/`.
