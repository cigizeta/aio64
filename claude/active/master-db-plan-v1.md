# Master Database -- Implementation Plan v1

*Status: plan (2026-11-12), not started. Implements master-db-v1.md
(decisions 1-9). Comes after local-games-plan-v1.md phase 3, so that
the Explorer's sources change once.*

## Hash (`src/hash.ts`, new; `src/book.ts` removed)

- `polyglotKey(fen)` and its four reference keys move from `book.ts` to
  `hash.ts`: the positions' hash in every database. The reference-key
  self-test now runs at every startup (today only when a book is
  configured) and in the build command: a wrong hash would make every
  lookup silently miss.
- `record.ts` and `games.ts` import from `hash.ts`.
- The rest of `book.ts` (the Polyglot reader, `loadBook`) goes.

## PGN reading (`src/pgn.ts`, new)

- `pgnTags` and `pgnMoves` move here from `sync-chesscom.ts`, which
  imports them.
- `readGames(path)`: an async generator over a PGN file of any size,
  read as a stream line by line (collections can be gigabytes), yielding
  each game's text. A game starts at a tag line after movetext;
  encoding UTF-8, a leading BOM tolerated.

## The build (`src/build-master.ts`, new; `npm run build-master`)

- `package.json`: `"build-master": "tsx src/build-master.ts"`. Usage
  `npm run build-master -- <file.pgn> [<file.pgn> ...]`; without files,
  prints the usage and exits.
- Hash self-test; every file checked readable before anything starts.
- If `games/master.sqlite` exists: `Replace games/master.sqlite? [Y/n]`
  (`node:readline`); Enter or `y` goes on, anything else exits.
- Builds `games/master.sqlite.tmp` (deleted first if left over):
  `PRAGMA journal_mode = OFF`, `synchronous = OFF` (a temporary file:
  a crash only loses the build). Tables: `meta (key, value)` and
  `moves (hash, next, white, draws, black)`, primary key
  `(hash, next)`, `WITHOUT ROWID`.
- Per game: tags; `[Variant]` other than standard, or a result other
  than `1-0`/`0-1`/`1/2-1/2`: skipped. Initial FEN from
  `[SetUp "1"]`/`[FEN]`. Only the first 40 plies are replayed
  (`replay` from `record.ts`); an illegal move among them: rejected.
  Each (position hash, next move) pair adds 1 to `white`, `draws` or
  `black`.
- Totals are added up in a `Map` in memory and written with
  `INSERT ... ON CONFLICT (hash, next) DO UPDATE SET white = white +
  excluded.white, ...` in one transaction whenever the map reaches
  1,000,000 pairs, and at the end. This keeps memory bounded on large
  collections.
- Progress every 10,000 games: `120000 games, 2.1 min`. At the end:
  kept, skipped, rejected, distinct pairs, file size; `meta` gets
  `schema_version`, the PGN file names, the counts and the build date.
- Then `master.sqlite.tmp` is renamed to `master.sqlite` (replacing
  it), and the command prints "Restart the server to use it." On
  Windows the rename fails while the server holds the old file open:
  the message then says to stop the server and run the command again
  (the temporary file is kept, so nothing is lost but the rename;
  stated in the message).
- To check while implementing: the build's speed on a large collection
  (target: a few minutes per million games). If too slow, larger
  batches or prepared-statement reuse; the plan is revised with the
  measurement.

## Server

- `src/master.ts` (new): opens `games/master.sqlite` read-only at
  startup if it exists (logging its game count from `meta`), and
  `masterMoves(fen)`: `SELECT next, white, draws, black FROM moves
  WHERE hash = ?`, with UCI added as in `explore` (games.ts), sorted by
  game count. Same `ExplorerMove` shape as personal games.
- Tool `master_moves` (widget-only, read-only, `{ fen }`), registered
  only when the file exists; replaces `book_moves`.
- `book_moves`, `loadBook` and `POLYGLOT_PATH` removed; the board
  payload's `book` becomes `master` (whether the file exists).

## Widget

- Explorer sources: two buttons, **Master** (hidden without the file)
  and **Personal**; a new widget starts on Personal.
- Master: the moves with count and results bar, as Personal, but no
  game list (no games stored); status "N games from here" from the
  totals, or "Not in the master database" when the position has none.
- The book's percentages, its cache and its rows go.

## Docs and config

- README: the master database (what it is, where to get a PGN, the
  command, the restart); `POLYGLOT_PATH` and books removed.
- `.env.example`: `POLYGLOT_PATH` removed. `.gitignore`: `books/` and
  `*.bin` lines removed (the developer deletes any local `books/`).

## Tests (developer, desktop)

1. `npm run typecheck`.
2. `npm run build-master -- <small.pgn>` (a few hundred games): counts
   printed; `games/master.sqlite` created.
3. Again: the `[Y/n]` prompt; `n` leaves the file untouched; Enter
   rebuilds.
4. A large collection (the developer's choice): time and file size
   recorded here.
5. Restart; **disconnect and reconnect** (tools and widget changed).
   Master at the start position: moves, counts and bars plausible
   (1. e4 and 1. d4 on top); deep in a line beyond ply 40: "Not in the
   master database".
6. Without `games/master.sqlite`: no Master button; Personal works.
7. A position where a transposition joins two move orders: the counts
   include both (one hash).

## Files

```
src/hash.ts            new: polyglotKey and its self-test
src/book.ts            removed
src/pgn.ts             new: PGN tags, moves, streaming reader
src/build-master.ts    new: the command
src/master.ts          new: read-only master queries
src/record.ts          imports hash.ts
src/games.ts           imports hash.ts
src/sync-chesscom.ts   imports pgn.ts
src/server.ts          master_moves; book_moves and POLYGLOT_PATH removed
widget/board.html      sources Master / Personal
widget/board.ts        master rows; book code removed
package.json           build-master script
README.md, .env.example, .gitignore
```

## Afterwards

- Record results here; master-db-v1.md and this plan to `done/`.
- TODO.md: the master database item ("planned in a separate project")
  is closed by this; the Fattorini project may keep producing the
  `.bin` for lichess-bot, independently.
