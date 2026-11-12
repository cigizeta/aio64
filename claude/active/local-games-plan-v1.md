# Local Games -- Implementation Plan v1

*Status: plan (2026-11-12), not started. Implements local-games-v1.md
(decisions 1-11 and the settled open points).*

Three phases, each ending in a working server and its own commit:
(1) databases and sync, (2) the tools read the databases, (3) the
widget's tabs. The Lichess token goes in phase 2, once nothing needs it.

## Game identity

A game is named everywhere outside a database file by a **game key**,
the string `<site>:<site_id>` (`lichess:q7ZvsdUF`, `chesscom:1234567`).
`games.id` is local to one file, so it never leaves the server: tools,
the widget, trees (`Tree.mainGame`, `Tree.games`, `TreeNode.games`) and
saved states all use game keys. Trees saved before this change hold bare
Lichess IDs; they live in memory only, so a server restart clears them
and no migration is needed.

## Phase 1: databases and sync

### Configuration (`.env`, `.env.example`, README)

- New `LICHESS_USERS` and `CHESSCOM_USERS`, comma-separated, either may
  be empty; at least one account overall, else the server refuses to
  start. Placeholders only in `.env.example` and the README
  (`<lichess-user>`).
- `LICHESS_TOKEN` stays until phase 2.

### Startup checks

- `node:sqlite` in the pinned Node (24.21.0): check its stability level;
  if it still prints an ExperimentalWarning, silence that one warning at
  startup with a comment saying why. No new dependency.
- `games/` added to `.gitignore`, created at startup if missing.

### `src/db.ts` (new): one account's file

- `openAccount(site, username)`: opens or creates
  `games/<site>-<username lowercased>.sqlite`; creates the tables of
  local-games-v1.md "Format" (`meta`, `games`, `positions`, plus
  `pending` for Lichess or `archives` for Chess.com); `PRAGMA
  journal_mode = WAL`.
- `schema_version` in `meta`: on a mismatch, rebuild `games`'
  derived columns and `positions` from `source` (one transaction). In
  v1 this path only needs to exist; it is tested by bumping the version
  by hand.
- `storeGame(db, record)`: inserts into `games` and its `positions`
  rows; ignores a duplicate `(site, site_id)`.
- Indexes: `positions` by its primary key (`hash` first) serves the
  Explorer; `games (ended_at)` serves All Games.

### `src/record.ts` (new): from a site's game to a record

Shared by both syncs, pure functions, no I/O:

- `replay(initialFen, sans)`: replays with chessops; returns the
  normalized SAN (chessops' `makeSan`), each position's Zobrist hash
  (`@echecs/zobrist`) and the final position; throws on an illegal move
  (the game is then skipped and counted as rejected).
- `inferDraw(replayed)`: insufficient material, threefold repetition
  of the final position, 100 plies without capture or pawn move, else
  `agreement` (Lichess draws only).
- `timeControl(...)`: `180+2`, `3d`, `-`.
- Standard chess check: Lichess `standard` / `fromPosition`; Chess.com
  `rules: chess`. Anything else is skipped and counted.

### `src/sync-lichess.ts` (new)

- Requests one at a time; `Accept: application/x-ndjson`; a generic
  `User-Agent` naming Aio64; on `429`, stop this account's sync and
  report "rate limited, try again in a minute" (the next press resumes).
- Step 1: `GET /api/games/user/<user>?since=<cursor>&ongoing=true&
  sort=dateAsc&pgnInJson=true`, read as a stream. Every 100 games, one
  transaction: finished games stored, ongoing games' IDs put in
  `pending` (nothing else of them kept), cursor set to the newest
  `createdAt` seen. `aborted` and `noStart` games are dropped.
- Step 2: `POST /api/games/export/_ids` with the `pending` IDs, up to
  300 per request: finished games stored and removed from `pending`,
  aborted ones removed, the rest kept.
- First request: confirm in the log that ongoing games come back
  without a token (local-games-v1.md, open point 7).

### `src/sync-chesscom.ts` (new)

- Requests one at a time; `Accept-Encoding: gzip`; the same generic
  `User-Agent`.
- `GET /pub/player/<user>/games/archives` for the month list; for each
  month not marked `complete` in `archives`, `GET` the month with
  `If-None-Match` / `If-Modified-Since`; `304` means nothing new. One
  transaction per month: its games stored, its `etag` and
  `last_modified` saved, `complete` set if the month is over.
- First request: check whether a real game object has `rated`,
  `initial_setup` and `start_time`; for any that is missing, read the
  PGN tags instead (`[SetUp]`/`[FEN]`, `[UTCDate]`/`[UTCTime]`; for
  `rated`, to be decided from what the response holds).

### `src/sync.ts` (new): all accounts

- `syncAll(onProgress)`: every account from `.env`, one after another;
  per account: new games, rejected games, error if any. One account's
  failure never stops the others.
- Only one sync at a time: a second call while one runs is refused
  ("sync already running").

### Tools `sync_games` and `sync_status` (server)

The sync is always asynchronous: a first sync can take minutes, and no
tool call waits for it.

- **`sync_games`**: widget-only (`visibility: ["app"]`), annotations
  `readOnlyHint: false`, `destructiveHint: false`,
  `idempotentHint: true`, `openWorldHint: true`. Starts `syncAll` in the
  background and returns at once: "started", or "already running".
- **`sync_status`**: widget-only, `readOnlyHint: true`. Returns
  `{ running, progress, summary }`: `progress` is a line such as
  `lichess/<user>: 120 games`, `summary` the last finished sync's
  result per account (new games, rejected games, error). Kept in server
  memory only.

### Phase 1 tests

1. `npm run typecheck`; `npm run dev` with one Lichess and one
   Chess.com account in `.env`.
2. Until the widget has its button (phase 3), the sync is triggered by
   a temporary startup flag `SYNC_ON_START=1`, removed in phase 3
   (decision 2 forbids automatic sync in the finished product).
3. Files appear in `games/`; counts in the log are plausible against
   the sites' profile pages.
4. A second sync fetches nothing new (Lichess: only `pending`;
   Chess.com: `304`s).
5. Interrupt a first sync (Ctrl+C), restart: it resumes, no duplicates.
6. Spot checks with any SQLite viewer: a disambiguated move (`Ngf3`),
   a Lichess draw's inferred termination, a thematic game's
   `initial_fen`, a daily game.

## Phase 2: tools read the databases

### Server

- **`explore_position`** `{ fen }` (the `color` input goes: both
  colors, decision 7): the hash of `fen`; over every account file, the
  next moves with counts (`GROUP BY next`, summed across files) and the
  games that reached the position, newest first, at most 50. Returns
  game keys.
- **`load_game`** `{ game }` (a game key): reads `games` from the right
  file; never contacts a site. Returns the same structure as today
  (`GameInfo`, `startFen`, `moves`), `GameInfo.id` being the game key.
- **`list_games`** (new, widget-only, read-only) `{ filters, offset }`:
  All Games' rows, newest first, 100 per page, across every file.
  Filters: account, opponent, color, result for the account,
  termination, speed, rated, date range, standard or thematic. Speed
  from `time_control` with Lichess's formula (estimated seconds =
  base + 40 * increment; daily for `3d`-style values).
- **Removed:** `recent_games`, `explorePlayer` (`src/explorer.ts` keeps
  only what the new `explore_position` needs, or goes), `fetchGame`,
  `recentGames`, `checkLichessToken`, `parseGameId`, the `games` map in
  `src/cache.ts`, `LICHESS_TOKEN` (`.env.example`, README, startup).
- **`open_board`**: `color` only sets the orientation of the new
  analysis tree; its description loses "the explorer shows the user's
  games with it".
- **The player** (`user` in the widget payload): becomes the list of
  `.env` usernames; the widget puts Black at the bottom when Black's
  name is one of them (ignoring case).
- **Cross-file queries:** one `node:sqlite` connection per file, opened
  at startup and kept; queries run per file and are merged in memory
  (at most a handful of files; simpler than `ATTACH`, which is limited
  to 10 by default).

### Phase 2 tests

1. Typecheck; restart; **disconnect and reconnect** (tool list
   changed).
2. Explorer at the start position: moves with counts from both sites
   together; both colors' games.
3. Explorer deep in a game: only the games through that position.
4. Click a game in the Explorer: it opens as a tree; its moves match
   the site.
5. Server log: no request to Lichess or Chess.com outside a sync.

## Phase 3: widget

### Tabs (`widget/board.html`, `widget/board.ts`)

- **PGN:** today's Moves tab renamed (label, IDs, comments).
- **Explorer:** source toggle with two values, "Master book" (shown
  only when a book is configured) and "Personal games"; plain counts
  (`Nf3 · 12`); the game list below the moves, as today. The `as-side`
  toggle goes.
- **All Games:** replaces Games.
  - Filter row: account (select), opponent (text, applied after a
    short pause in typing), color, result, termination, speed, rated,
    date from/to, standard/thematic. Each defaults to "any".
  - The sync button (⟳) at the end of the row. A click asks "Sync all
    accounts? It may take a few minutes." (an in-widget confirmation,
    not a browser dialog, which sandboxed iframes may block); on
    confirm, `sync_games`, then `sync_status` every 2 s: the status
    line shows the progress, then the summary, and the list reloads.
    The button is disabled while a sync runs. A widget opened during a
    sync finds it running through `sync_status` and follows it too.
  - Rows: date (`ended_at`, UTC, `2026-11-12`), site, color played
    (● Black, ○ White), opponent, result, time control. Click: the
    game opens as a tree at its final position (today's `addGame`
    with `from: "games"`).
  - "More" at the bottom loads the next 100.
- `SYNC_ON_START` from phase 1 is removed.

### Phase 3 tests

1. Typecheck; restart; **disconnect and reconnect** (widget changed,
   so its `ui://` URI changed).
2. Tabs read PGN, Explorer, All Games; the PGN tab behaves as Moves
   did.
3. Sync: the confirmation appears; cancel does nothing; confirm runs,
   shows progress and a summary; a second sync reports nothing new.
4. Check whether claude.ai adds its own confirmation for `sync_games`
   (local-games-v1.md, open point 1); record it.
5. Each filter alone narrows the list as expected; filters combine.
6. A thematic game is found with the standard/thematic filter and
   opens at its own start position.
7. Explorer sources switch; Master book hidden without a book.
8. Trees from earlier (trees-plan-v1.md tests 3-5) still work with game
   keys.

## Files

```
.env.example, README.md   accounts; token removed (phase 2)
.gitignore                games/
src/db.ts                 new: one account's file
src/record.ts             new: replay, termination, time control
src/sync-lichess.ts       new
src/sync-chesscom.ts      new
src/sync.ts               new: all accounts, one at a time
src/server.ts             sync_games, sync_status, list_games, explore_position,
                          load_game, open_board, token removed
src/explorer.ts           reduced or removed
src/lichess.ts            removed (its parsing moves to sync-lichess.ts)
src/cache.ts              games map removed; game keys
widget/board.html         three tabs, filters, sync button
widget/board.ts           tabs, sources, All Games, sync, game keys
```

## Afterwards

- Record test results here; this plan and local-games-v1.md to `done/`.
- CLAUDE.md: remove the Lichess token bullet ("must have no scopes").
- TODO.md: remove what this closes.
