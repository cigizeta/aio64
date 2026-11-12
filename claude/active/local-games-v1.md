# Local Games -- Design Discussion v1

*Status: discussion (2026-11-08), nothing decided beyond the list below,
nothing implemented.*

## Goal

After finishing a game, on Lichess or Chess.com, the developer analyzes
it with Aio64 instead of the sites' own interfaces. The server keeps a
local database of the configured players' finished games from both
sites, filled by a manual sync. Games tab and Explorer read from it.

## Decided (developer, 2026-11-08)

1. **No Lichess token.** Both sites serve public finished games by
   username. `.env` holds usernames only (e.g. `LICHESS_USERS`,
   `CHESSCOM_USERS`, comma-separated); `LICHESS_TOKEN` and the startup
   scope check go away. Whoever runs a copy of Aio64 writes its `.env`
   and sees only public data: no identity check is needed.
2. **Manual sync, always.** A sync button in the widget, backed by a
   widget-only tool (hidden from Claude). No automatic sync, neither at
   startup nor when a tab opens: only the developer knows when a game
   has ended. The first sync is manual too.
3. **Incremental fetching** under the button, so each press stays light:
   Lichess `since=<last synced game>`; Chess.com only the months not yet
   complete locally, with `If-Modified-Since` / ETag.
4. **Not a Mentes database.** Only the configured players' own online
   games; no imports, no PGN collections, no editing. Game storage in
   general stays Mentes's job.
5. **One SQLite database per account** (2026-11-08): one file for each
   Lichess username and each Chess.com username in `.env`. Adding or
   removing an account adds or deletes one file; a sync of one account
   touches only its file.
6. **No Games tab** (2026-11-08). Its list is the Explorer's game list at
   the start position; the tab and `recent_games` go away.
7. **Explorer sources:** the local book, or one account's database
   (one at a time). An account source shows games of both colors.
8. **No statistics for account sources:** the next moves from the
   position are listed with a plain count (`Nf3 · 12`), no W/D/L, no
   performance. Results over one player's games are too few and too
   biased to mean much, and without them mixing colors is harmless.
9. **No master statistics for now.** The book (Polyglot) holds only
   moves and weights, never results, so its percentages are preferences.
   A master database with W/D/L is to be built in a separate project;
   Aio64 accepts the limitation until then.

10. **Read-only rule softened** (2026-11-12, now in CLAUDE.md): the
    server may hold one database for each Lichess and Chess.com username
    in `.env`; only the sync tool writes, and only there, annotated
    `readOnlyHint: false`, `destructiveHint: false`,
    `idempotentHint: true`. Every other tool stays `readOnlyHint: true`.

11. **Database format** (2026-11-12): see "Format" below.

## Format (decided 2026-11-12)

SQLite through `node:sqlite`, one file per account (decision 5). The
tables are general: a file could hold any set of games, from either site.

**`meta`** (`key`, `value`): `schema_version` (a format change rebuilds
from `source`, without re-fetching); the account the file syncs from
(`site`, `username`); the Lichess sync cursor (`ended_at` of the newest
stored game).

**`archives`** (Chess.com only): `month` (`2026-11`), `etag`,
`last_modified`, `complete` (set once the month is over and fully
fetched; never fetched again).

**`games`**:

| Column | Content |
|---|---|
| `id` | Aio64's own key, `INTEGER PRIMARY KEY` |
| `site`, `site_id` | `lichess` / `chesscom` and the site's game ID; `UNIQUE (site, site_id)` |
| `white`, `black` | names as the site gives them, `COLLATE NOCASE` (usernames are ASCII and case-insensitive on both sites); `Anonymous` for a Lichess player without an account |
| `white_rating`, `black_rating` | as each site gives them, no adjustment (Chess.com's may be after the game); NULL if absent |
| `result` | `1-0`, `0-1`, `1/2-1/2` |
| `termination` | normalized, see below |
| `time_control` | `180+2` (seconds), `3d` (days per move), `-` (unlimited); no category stored |
| `rated` | 1 rated, 0 casual |
| `started_at`, `ended_at` | Unix milliseconds; the widget shows them in UTC. A PGN export writes `Date`/`UTCTime` from the start and custom `EndDate`/`EndTime` from the end, as Chess.com does |
| `initial_fen` | NULL for the standard start; set for games from a position |
| `moves` | SAN, space-separated, rewritten by chessops while replaying (disambiguation only when needed, standard `+`, `#`, `=Q`, `O-O`); a game with an illegal move is rejected |
| `source` | the site's original reply (PGN or JSON), verbatim |

No `color` (derived by matching names to `.env` usernames, ignoring
case), no `clocks` (not wanted), no `eco`/`opening` (to be computed
from positions, later).

**`positions`** (the Explorer's index, every ply): `hash` (64-bit
Zobrist), `game_id` (refers to `games.id`), `ply`, `next` (SAN, NULL
at the game's end); primary key `(hash, game_id, ply)`, `WITHOUT ROWID`.
About 80 rows per game, roughly 30 MB per 10,000 games. The Explorer
groups by `next`.

**Which games:** any finished game (status checked per game, never
assumed), any time control including daily and correspondence. Standard
chess only, including games from a position (Lichess `standard` and
`fromPosition`; Chess.com `rules: chess`, with or without
`initial_setup`). Chess960 and other variants are skipped; aborted games
are not stored.

**Termination values:**

| Value | Lichess `status` | Chess.com result |
|---|---|---|
| `checkmate` | `mate` | `checkmated` |
| `resignation` | `resign` | `resigned` |
| `time` | `outoftime` | `timeout` |
| `abandonment` | `timeout` (opponent left, win claimed) | `abandoned` |
| `stalemate` | `stalemate` | `stalemate` |
| `agreement` | inferred, see below | `agreed` |
| `repetition` | inferred | `repetition` |
| `fifty-move` | inferred | `50move` |
| `insufficient` | inferred | `insufficient` |
| `time-insufficient` | `outoftime` with a draw | `timevsinsufficient` |
| `other` | `cheat`, `unknownFinish` | anything else |

Lichess reports most draws as `draw`; the sync infers the kind from the
final position, in order: insufficient material; the final position
occurred three times (pieces, side to move, castling, en passant);
100 plies without a capture or pawn move; otherwise `agreement`.

## Open

1. **Sync confirmation.** claude.ai may ask for confirmation when a
   non-read-only tool runs, even one called from the widget: to check.
2. (Settled: finished games only, see "Format".)
3. **Storage details.** `node:sqlite`: check its stability flag in the
   pinned Node 24. Location: an ignored directory in the repository,
   like `books/`. File naming (site and username, e.g.
   `lichess-<user>.sqlite`). Queries across accounts open each file, or
   `ATTACH` them to one connection.
4. (Settled: every ply, Zobrist hash via `@echecs/zobrist`, already a
   dependency; replaces the Lichess player explorer.)
5. (Settled: see "Format".)
6. **Chess.com details to verify** against its current API documentation:
   delay between a game's end and its appearance in the monthly archive;
   rate limits (sequential requests); required headers. Any `User-Agent`
   names Aio64 generically, never a personal address.
7. **Lichess details to verify:** anonymous export rate limit; whether
   `/api/games/user` without a token returns everything needed (clocks,
   opening, status).
8. **Re-sync and errors.** A partial sync (network failure) must leave the
   database consistent and resume on the next press. A full rebuild
   option (delete and re-fetch)?
9. **Widget.** Where the sync button lives (next to the account
   selector?), what it shows during and after a sync (`12 new games`),
   and how the game list shows each game (color, opponent, result, how it
   ended, date).
10. **Existing tools.** `recent_games` goes (decision 6);
    `explore_position` and `load_game` change source to the database;
    `load_game` from a pasted Lichess link could still fetch directly, or
    only from the database.
11. **Back to all games.** After reviewing a game, the board is inside
    its tree and the Explorer shows only that game. A way to the full
    list (newest first) is needed: an "all games" toggle in the game list
    that ignores the board, or another solution.

## Afterwards

Once the open points are settled: an implementation plan
(local-games-plan-v1.md), the CLAUDE.md rule change, README and
`.env.example` updates, and a reconnect (tools change).
