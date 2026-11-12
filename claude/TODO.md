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
  Explorer sources): phases 1-2 implemented (2026-11-12), phase 3 (the
  widget's tabs) next. Then the master database (master-db-v1.md,
  master-db-plan-v1.md): built by Aio64 from PGN, replacing the Polyglot
  book in the Explorer.
- **Project split:** Aio64 analyzes the developer's games with Claude;
  Mentes becomes a database app; a master database with W/D/L is
  planned in a separate project.

## Next

- More context for Explain (side played, move history): needs
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

- Explain no longer reopens the board below the answer (2026-11-12).
  claude.ai now sends the widget's message itself, as a turn "started by
  a message from the app", and draws no widget in it: `open_board` ran
  ("Board reopened.") with nothing shown, with Zod 3 and Zod 4 alike, so
  not our regression. Until 2026-11-12 morning the message filled the
  developer's message box and the reply drew the board below. Recheck
  after upgrading `@modelcontextprotocol/ext-apps` (a way to fill the
  message box without sending, or widgets drawn in app-started turns).
  `save_board`, `open_board`'s `state` and the saved-state cache were
  removed (2026-11-12); bring them back only if that recheck succeeds.


- Master database with games (developer to rethink, 2026-11-12). Today
  totals only: 864k games, 331 MB, 8 min. Estimates for 864k games:
  (A) games + index every ply, 3-4 GB, about an hour; (B) games + index
  up to ply 40, about 1.5 GB, 20-30 min; (C) totals + the top games per
  position (e.g. 8 by average rating, as master explorers do), about
  twice today's size, 15-20 min. Claude recommended C.

- Explorer: show the current position's opening name, looked up by
  position in Lichess's openings list (CC0). Nothing stored; a game
  column can be added later from the stored moves, without a re-sync.

- Arbitrary users, one day: the developer does not want the widget's
  tab state kept on the server. Today `report_trees` keeps the newest
  widget's trees in server memory, one copy for everyone, so a board
  Claude opens carries them over. Rethink this before supporting other
  users.


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

- Board beside the chat automatically: today the user clicks claude.ai's
  fullscreen arrows once per chat (explain-command-v1.md). After each
  ext-apps upgrade, check for a way to start a board in fullscreen.

- claude.ai first calls `server/discover` (a newer MCP discovery method);
  our SDK answers 400 and claude.ai falls back to `initialize`. Harmless;
  recheck after upgrading `@modelcontextprotocol/sdk`.

## When away from the PC

Development and testing happen on desktop; the phone gets one final
check at the end.

- Trees on the phone (test 12 in trees-plan-v1.md): the selector opens
  the phone's picker; labels readable.
- claude.ai's fullscreen control: desktop only (the side pane); the
  README's tip says so. On the phone, check what the board looks like
  during an explanation.

- Check the board widget in the Claude mobile app (server and ngrok must
  be left running). When it passes, move hello-board-spike-v1.md to
  `done/`.
- Engine from unpkg on mobile (cdn-engine-v1.md): open a board in two
  chats and compare how fast the engine starts.
