# Polyglot Book in the Explorer -- Plan v1

*Status: implemented (2026-10-09), awaiting test. Plan approved
2026-10-09. Change: `@echecs/polyglot` is not used. It only does the
lookup, which is a few lines; the key table comes from `@echecs/zobrist`
(MIT, no dependencies, the standard Polyglot Random64), and `src/book.ts`
does the hashing and the lookup. The startup self-test checks four
reference keys from the specification, two of them with an en passant
square.*

*Original status: plan, awaiting approval (2026-10-09). Implements "Local
Polyglot book" from lichess-games-v1.md.*

## Goal

The Explorer tab gets a source switch, **Games | Book**. Games is today's
player database; Book lists the moves of a local Polyglot book for the
current position, with their share of the book's weight. Clicking a move
plays it on the board, as in the Games source.

## The book file

- Lives in `books/` at the repository root, ignored by Git together with
  every `*.bin`. The developer copies it there from wherever it is kept,
  so the server never reads from a synced or network drive.
- `POLYGLOT_PATH` in `.env` is optional. A relative path is resolved from
  the repository root, not from the current directory.
- Missing variable: the server starts, logs that the book is disabled,
  and the widget hides the switch. Variable set but file missing or not a
  valid book (size not a multiple of 16 bytes): fatal at startup, like a
  wrong STOCKFISH_PATH.
- The file is read once at startup into memory and never written.
  Read-only rule: reading a local file is fine; Aio64 still writes nothing.

## Server

### `src/book.ts`

- Library: `@echecs/polyglot` (Zobrist keys and entry decoding). Its
  license is checked at install time; it must be GPL-3 compatible. If it
  is not, or turns out unsuitable, Aio64 implements the format itself:
  16-byte big-endian entries (key, move, weight, learn) sorted by key,
  plus the 781 standard random numbers.
- Key test at startup (fatal on mismatch), from the Polyglot
  specification:
  - start position: `463b96181691fc9c`
  - after 1.e4: `823c9b50fd114196`
- `bookMoves(fen)`: binary search for the key, collect the entries,
  convert each move to SAN with chess.js (Polyglot writes castling as
  king takes rook, e.g. e1h1, which becomes O-O), merge duplicates,
  drop moves chess.js rejects, sort by weight. Returns
  `{ moves: [{ san, uci, percent }] }`, where `percent` is the move's
  weight over the position's total, rounded to an integer.

### App-only tool `book_moves(fen)`

Read-only, hidden from Claude. Invalid FEN gives the usual error. Not
registered when no book is configured.

### Board state

`boardResult` adds `book: boolean` (a book is configured), so the
widget knows whether to show the switch. No change to saved states.

## Widget

- Above the Explorer content: a two-button switch **Games | Book**,
  styled like the White/Black toggles. Hidden when there is no book.
- Book selected: the player field and the White/Black toggles are hidden
  (they apply to the player database only); the list shows rows such as
  `Nf3   45%`, marked with "•" when the move is already in the tree, as
  in the Games source. No game list.
- Empty answer: "Out of book".
- The same 300 ms debounce as the Games source; no refresh loop (the
  book is local and instant). Answers are cached in the widget by
  position key.
- The selected source stays for the widget's lifetime; a new widget
  starts on Games.

## Files

```
.gitignore          books/ and *.bin (done)
.env.example        POLYGLOT_PATH placeholder, commented out
package.json        @echecs/polyglot
src/book.ts         loading, key test, bookMoves
src/server.ts       startup check, book_moves (app-only), book flag
widget/board.html   source switch
widget/board.ts     Book source rendering and clicks
```

## Tests (developer, web)

1. Restart; reconnect (new tool, widget changed).
2. Startup log says the book is loaded, with its number of entries.
3. Explorer > Book at the start position: e4, d4, Nf3, c4 and others,
   percentages summing to about 100.
4. Click a move: it is played; the list follows the new position.
5. A position far out of theory: "Out of book".
6. Comment out POLYGLOT_PATH, restart: no switch, Explorer as before.

## Decisions

- Rows show percentages only, never raw weights: weights are relative
  within one position and mean nothing to the user (developer,
  2026-10-09).
