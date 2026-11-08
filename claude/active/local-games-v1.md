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

## Open

1. **Read-only rule (CLAUDE.md).** Proposed wording: "No tool changes
   anything outside Aio64's local game database; only the sync tool
   writes there." The sync tool is annotated honestly
   (`readOnlyHint: false`, `destructiveHint: false`,
   `idempotentHint: true`); every other tool stays `readOnlyHint: true`.
   claude.ai may ask for confirmation when it runs: to check.
2. **Finished games only.** Both sites' archives hold finished games;
   the sync still checks each game's status before storing it.
3. **Storage details.** SQLite, one file per account (decided 5), through
   `node:sqlite` (built into Node, no dependency; check its stability
   flag in the pinned Node 24). Location: an ignored directory in the
   repository, like `books/`. File naming (site and username, e.g.
   `lichess-<user>.sqlite`). Queries across accounts (Games list,
   Explorer) open each file, or `ATTACH` them to one connection.
4. **Explorer index.** Positions indexed by Zobrist hash
   (`@echecs/zobrist`, already a dependency), per account, both colors
   (decision 7). Replaces the Lichess player explorer (whose access
   without login is uncertain anyway). Index all plies or only the
   opening (first N)?
5. **What a game record keeps.** Site, ID, players, ratings, color of the
   configured player, result and how it ended (resignation, time, mate:
   the postponed TODO item), time control, date, opening, moves, clocks
   (for the Explain context and a future game review).
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
