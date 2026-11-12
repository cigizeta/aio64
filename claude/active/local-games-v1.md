# Local Games -- Design Discussion v1

*Status: design complete (2026-11-12); implementation plan in
local-games-plan-v1.md; nothing implemented.*

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
6. **Tabs: PGN, Explorer, All Games** (revised 2026-11-12; the
   2026-11-08 decision removed the Games tab). Moves is renamed PGN.
   All Games replaces the Games tab: the games of every account,
   newest first, with a column naming each game's account, read from
   the databases (`recent_games` goes). It is
   needed because thematic games never pass through the start position,
   so the Explorer at the start cannot list every game. Filters, each
   narrowing the list: account, opponent (part of a name, ignoring case), color
   played, result for the account (won, drawn, lost), termination,
   speed (bullet, blitz, rapid, classical, daily, derived from
   `time_control`), rated or casual, date range (`ended_at`), standard
   or thematic (`initial_fen` set).
7. **Explorer sources** (revised 2026-11-12): two, the master book (the
   local Polyglot book) and personal games (every account combined,
   counts added up). Personal games shows games of both colors.
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
(`site`, `username`); the Lichess sync cursor (see open point 7).

**`pending`** (Lichess only): IDs of games in progress at the last sync,
see open point 7.

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

1. **Sync confirmation.** Settled (2026-11-12): a sync is expensive, so
   the widget asks the developer to confirm before starting it. Still
   to check when testing: whether claude.ai adds its own confirmation
   for a non-read-only tool called from the widget.
2. (Settled: finished games only, see "Format".)
3. **Storage details.** Settled (2026-11-12): files in `games/`,
   ignored by git like `books/`, named `<site>-<username>.sqlite` with
   the username lowercased (e.g. `games/lichess-<user>.sqlite`). Still
   open: `node:sqlite`'s stability flag in the pinned Node 24 (to check
   when implementing). All Games spans every account (decision 6): the
   server `ATTACH`es the files or queries each and merges; chosen when
   implementing. So does the Explorer's personal games (decision 7).
4. (Settled: every ply, Zobrist hash via `@echecs/zobrist`, already a
   dependency; replaces the Lichess player explorer.)
5. (Settled: see "Format".)
6. **Chess.com** (checked 2026-11-12 against its published-data API
   doc): serial requests are effectively unlimited; parallel ones may
   get `429`, and abnormal activity may block the client. So the sync
   requests one at a time. Responses carry `ETag` and `Last-Modified`
   (send `If-None-Match` / `If-Modified-Since`, get `304`); send
   `Accept-Encoding: gzip`. A recognizable `User-Agent` is recommended
   (generic Aio64 name, never a personal address). Endpoints refresh
   "at most once every 24 hours" unless noted, so a just-finished game
   may appear late. The doc's game object lists `start_time` for daily
   games only and omits `rated` and `initial_setup`: to verify on a real
   archive response (else read them from the PGN tags).
7. **Lichess** (checked 2026-11-12 against its OpenAPI spec): one
   request at a time; on `429` wait at least a minute. The game export
   streams 20 games per second without a token (enough: 5,000 games in
   about 4 minutes). Parameters: `since`/`until` (ms), `finished`
   (default true), `sort` (`dateAsc` for resuming), `pgnInJson`,
   `perfType`. `since` filters on the game's creation time, not its
   end, so a game created before the last sync but finished after it
   would be missed by a plain cursor. Settled (2026-11-12, design left
   to Claude):
   - **Cursor:** `meta.lichess_cursor`, the newest creation time seen
     in any game fetched, finished or not. Invariant: every game created
     up to the cursor is either in `games` or in `pending`.
   - **`pending`** (`site_id`, `started_at`): IDs only, of games that
     were still in progress when fetched. Never moves or players: an
     ongoing game is never stored.
   - **Each sync:** (1) export since the cursor with `ongoing=true`,
     `sort=dateAsc`; a finished game is stored, an unfinished one only
     has its ID put in `pending`; the cursor advances with each batch,
     in the same transaction. (2) Check `pending` through the export by
     IDs (up to 300 per request): finished games are stored and leave
     `pending`; aborted ones just leave it; the rest stay.
   - The export in step (1) returns ongoing games with their (delayed)
     moves too; the sync discards everything of them but the ID, and
     nothing of an ongoing game reaches Claude or the widget.
   - Checked 2026-11-12: a request for another account's ongoing games
     (not the requester's own) lists them, so they are visible to
     non-owners. To confirm with the server's anonymous requests when
     implementing. (A time window was rejected: it can miss long games.)
8. Settled (2026-11-12): each batch (a Lichess page, a Chess.com month)
   is written in one transaction together with its cursor, so a failure
   loses at most that batch and the next press resumes. No rebuild
   button: deleting the account's file by hand starts over; a format
   change rebuilds from `source` via `schema_version`.
9. **Widget.** Settled (2026-11-12): one sync button, in the All Games
   tab next to the filters, syncs every account one after another; the
   tab's status line shows progress, then a summary; a failing account
   is reported and the others still sync. Each row, for now: date
   (`ended_at`, UTC), site, color played, opponent, result, time
   control. Clicking a row opens the game as a tree at its final
   position.
10. Settled (2026-11-12): `recent_games` goes (All Games reads the
    database, decision 6);
    `explore_position` reads every account's `positions` (decision 7);
    `load_game` reads only the databases, by game key
    (`<site>:<site_id>`, see local-games-plan-v1.md), never a site.
    The server contacts Lichess and Chess.com only during a sync.
11. Settled (2026-11-12): the All Games tab (decision 6), not a toggle
    in the Explorer; the Explorer follows the position only.

## Afterwards

Once the open points are settled: an implementation plan
(local-games-plan-v1.md), the CLAUDE.md rule change, README and
`.env.example` updates, and a reconnect (tools change).
