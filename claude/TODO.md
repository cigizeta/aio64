# TODO

## Where we are (2026-11-08, paused)

- **Done and committed:** the engine loads from unpkg (cdn-engine-v1.md),
  cached across chats; docs anonymized; `.claude/settings.json`.
- **Committed, tests 1-11 passed on desktop web (2026-11-12):** trees
  (trees-v1.md, trees-plan-v1.md): up to 10 trees in one widget, a tree
  selector, games never merged, `report_trees`; status line removed;
  new layout. The "(1)" count is explained: a page reload rebuilds the
  widget from its original tool result, so trees added in the widget are
  lost (and its report replaces the server's copy). Decided
  (2026-11-12): a reload starts fresh, by design; no change.
- **Next design:** local-games-v1.md (one SQLite file per Lichess and
  Chess.com account, manual sync, no Lichess token, no Games tab,
  Explorer sources). Open points listed there; the read-only rule is
  already softened in CLAUDE.md (2026-11-12).
- **Project split:** Aio64 analyzes the developer's games with Claude;
  Mentes becomes a database app; a master database with W/D/L is
  planned in a separate project.

## Next

- More context for Explain (side played, clocks, move history): needs
  design (lichess-games-v1.md).
- Move finished docs from `claude/active/` to `claude/done/`
  (cdn-engine-spike-v1.md and cdn-engine-v1.md: tested on desktop;
  gemini-cdn-engine.md and gemini-parallel-depth-calls.md go to
  `archived/`; main-game-v1.md gets a "superseded in part, see
  trees-v1.md" note).

## Public repository

Public since 2026-10-09 (v0.1.0), started from a fresh commit: the old
history, which held the ngrok domain, stays in a private archive
repository and must never be pushed here.

- License check, still to do: confirm the license of the Stockfish 19
  lite NNUE net (sscg13) embedded in the `.wasm`. The README now points
  to Stockfish.js's repository; still to confirm the exact tag or commit
  matching npm 19.0.0 and link it. Checked 2026-10-09, all GPLv3-compatible: stockfish
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

- Arbitrary users, one day: the developer does not want the widget's
  tab state kept on the server. Today `report_trees` keeps the newest
  widget's trees in server memory, one copy for everyone, so a board
  Claude opens carries them over. Rethink this before supporting other
  users.

- Change the layout of the Games tab (to be designed).

- The Explorer's dot before a move (`• e4`) means "already in the current
  tree"; confusing. Decide: remove it, make it explicit ("in tree"), or
  keep it.

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

Development and testing happen on desktop; the phone gets one final
check at the end.

- Trees on the phone (test 12 in trees-plan-v1.md): the selector opens
  the phone's picker; labels readable.

- Check the board widget in the Claude mobile app (server and ngrok must
  be left running). When it passes, move hello-board-spike-v1.md to
  `done/`.
- Engine from unpkg on mobile (cdn-engine-v1.md): open a board in two
  chats and compare how fast the engine starts.
