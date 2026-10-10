# TODO

## Next

- Test tap-tap moves on mobile (touch-input-v1.md).
- Design the game search tools (lichess-games-v1.md, "Finding games").
- More context for Explain (side played, clocks, move history): needs
  design (lichess-games-v1.md).
- Move finished docs from `claude/active/` to `claude/done/`.

## Public repository

Public since 2026-10-09 (v0.1.0), started from a fresh commit: the old
history, which held the ngrok domain, stays in a private archive
repository and must never be pushed here.

- License check, still to do: confirm the license of the Stockfish 19
  lite NNUE net (sscg13) embedded in the `.wasm`, and point the README to
  Stockfish.js's source at the version used (corresponding source of the
  `.wasm`). Checked 2026-10-09, all GPLv3-compatible: stockfish
  (Stockfish.js, GPL-3.0), chessground and chessops (GPL-3.0-or-later),
  chess.js (BSD-2-Clause), MCP sdk, ext-apps, zod, @echecs/zobrist (MIT).
  Recheck after any dependency is added.
- License (AGPLv3 only, done): optionally add two-line headers to the
  source files (`Copyright (C) 2026 Calogero Zarba` and
  `SPDX-License-Identifier: AGPL-3.0-only`); consider a short legal
  consultation (the license choice was not legal advice).
- OAuth instead of the static `x-api-key` header: not needed while each
  user runs their own server with their own `AIO64_TOKEN`.

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
