# Master Database -- Design Discussion v1

*Status: design complete (2026-11-12), nothing implemented.*

## Goal

The Explorer's master source shows each move with its game count and a
won / drawn / lost bar, like personal games (local-games-v1.md,
decision 8). No standard open book format holds per-move results:
Polyglot (`.bin`) has only a weight, Arena's `.abk` is niche and
unspecified, ChessBase's `.ctg` is proprietary. So Aio64 builds its own
database from a PGN file, and anyone using the code can build one from
any PGN collection, with no other tool.

## Decided (developer, 2026-11-12)

1. **SQLite generated from a PGN file**, with the same hashes and SAN as
   the account databases (local-games-v1.md, "Format"). Revised by
   decision 8: totals only, not the account format.
2. **Built by a command in this repository**, run by hand from the
   command line, never by an MCP tool. The server only reads the file.
   CLAUDE.md's read-only rule and local-games-v1.md decision 4 carry
   this exception.
3. **Polyglot is dropped from the Explorer** (revised 2026-11-12; first
   decided to stay). The `book_moves` tool, the Polyglot reader and
   `POLYGLOT_PATH` go. The Polyglot Zobrist hash (`polyglotKey`, Random64
   table) stays: it is the positions' hash in every database.

4. **Results always from White's side** (White won, drawn, Black won),
   here and in personal games alike, as on Lichess and Chess.com.

5. **The command** (2026-11-12): `npm run build-master -- <file.pgn>
   [<file.pgn> ...]`, one or more PGN files, output `games/master.sqlite`
   (ignored by Git). No `.env` setting: the server opens the file if it
   exists, else offers no master source.
6. **Always a full rebuild, never an append** (2026-11-12): PGN games
   have no reliable ID, so appending could count games twice; the file
   always matches exactly the PGN files given. If `master.sqlite`
   exists, the command asks `Replace games/master.sqlite? [Y/n]` (Enter
   means yes). It builds into `games/master.sqlite.tmp` and replaces the
   file only on success, so a failed or interrupted build leaves the old
   one intact. The server reads the new file after a restart; the
   command says so.

7. **Which games** (2026-11-12): as the sync. Kept: standard chess,
   including games from a position (`[SetUp "1"]` with `[FEN]`), with a
   result `1-0`, `0-1` or `1/2-1/2`. Skipped and counted: unfinished
   (`*`), variants (`[Variant]` other than standard), illegal moves. No
   rating or date limits: the PGN chosen is the filter. The command ends
   with the counts kept, skipped and rejected.

8. **Totals only, opening only** (2026-11-12): a collection of millions
   of games in the account format would be several gigabytes. Instead,
   one table `moves` (`hash`, `next`, `white`, `draws`, `black`), one
   row per position and move, primary key `(hash, next)`, `WITHOUT
   ROWID`, filled up to ply 40; repeated positions add up into one row.
   Plus `meta` (`schema_version`, the PGN files and counts of the
   build). No games stored, so the master source shows moves with
   counts and the results bar but no game list, as Polyglot today.

9. **Explorer sources** (2026-11-12): two buttons, labelled **Master**
   (shown only when `games/master.sqlite` exists) and **Personal**; one
   at a time; a new widget starts on Personal. Supersedes
   local-games-v1.md decision 7's "master book".

## Open

1. (Settled: decision 4.)
2. (Settled: decision 5.)
3. (Settled: decision 7.)
4. (Settled: decision 8.)
5. (Settled: decision 6.)
6. (Settled: decision 9.)

All points settled (2026-11-12). Next: the implementation plan
(master-db-plan-v1.md).
