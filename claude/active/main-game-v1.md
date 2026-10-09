# Main Game, Header and Flip -- Plan v1

*Status: implemented (2026-10-09), awaiting test. Plan approved
2026-10-09. Original status: plan, awaiting approval (2026-10-09). Designed with the
developer one question at a time; a first version, to be judged by eye.*

*Changes after implementation (developer, 2026-10-09): Flip is the first
button of the controls; the controls take two rows (board actions, then
Explain on its own row). The Explorer has two buttons only: Local and
"<user> as <side>", the side being the one at the bottom of the board;
the stored Explorer color is gone, and `open_board`'s `color` now sets
the initial flip. Later: decision 1 is revised. A game clicked in the
Explorer or the Games tab alike becomes the main line and the main game,
and the board stays on the current position (where the game joins the
tree, if it does not pass through it); only the header changes. The
Explorer searches with the side at the bottom, so the clicked game never
turns the board. Later still: the controls are one row again,
`⇅ ⏮ ◀ ▶ ⏭ Raise Explain`; "Main line" is renamed "Raise" to fit
("Promote" was rejected: it suggests pawn promotion). Simplified again:
a Games-tab click replaces the whole tree with that game alone, shown at
its final position, as the main game; an Explorer click joins the game
as the main line and main game and stays on the searched position.*

## Problem

Clicking one of the developer's games gives no sign of which color they
played: the board never turns, and the header names the game of the
current move, which changes while browsing. There is no way to flip the
board.

## Decisions

1. **Main game.** A tree may have one main game: the last game added
   with the Games tab. Only the Games tab sets it (it lists the
   developer's games only). Explorer additions never change it. The Main
   line button never changes it. Without a Games-tab click, there is no
   main game.
2. **Header.** The line above the board shows the main game's players,
   whatever move is current: `cigizeta (1850) vs FosTerRon (1987), 1-0`
   (White first). No main game: the header is empty. The per-move labels
   ("N games through here", "Your analysis") go away.
3. **Orientation.** Black at the bottom when the developer played Black
   in the main game; White at the bottom otherwise, including when there
   is no main game.
4. **Manual flip.** A Flip button turns the board over. The flip lasts
   until the main game changes; then the board goes back to the rule.
5. **Explorer colors.** "<user> as white" and "<user> as black" no
   longer turn the board; they only choose which games the Explorer
   searches.
6. **No game IDs from Claude.** `open_board` loses its `game` and `ply`
   parameters: too obscure. Claude opens boards from a FEN, the start
   position, or a saved state. Games come in through the Games tab and
   the Explorer only.
7. **Saved boards.** A board reopened after Explain keeps its main game
   and its flip.

## Server

- `BoardState` gains `mainGame?: string` (a game ID present in `games`)
  and `flipped: boolean` (default false); the zod schema follows.
- `open_board`: remove `game` and `ply`, and with them `lineTree` and
  `colorOf` if nothing else uses them. `load_game` (app-only) stays: the
  widget needs it for the Games tab and the Explorer.
- The user's name is already sent with every board (`user`).

## Widget

- Orientation is computed, never stored apart from `flipped`:
  `base = mainGame && games[mainGame].black equals user (ignoring case)
  ? black : white`, then reversed when `flipped`.
- Games-tab click: as today (joined, promoted, shown at its end), plus
  `mainGame = id`, `flipped = false`.
- Explorer click: unchanged.
- Header: the main game's players and result, or empty. Its height is
  kept when empty so that the board does not jump when a game arrives.
- Controls: a Flip button after Main line, an icon (&#x21C5;) with the
  tooltip "Flip board". It toggles `flipped`.
- The Explain message names the main game when there is one, else only
  the move: "Explain this position (after 12...Nf6)."

## Files

```
src/cache.ts        BoardState: mainGame, flipped
src/server.ts       schema; open_board without game and ply
widget/board.html   Flip button; header height
widget/board.ts     main game, header, orientation, flip
```

## Tests (developer, web)

1. Restart; reconnect (tool parameters and widget changed).
2. Games tab, a game played as Black: header shows its players, Black at
   the bottom.
3. Flip: White at the bottom; browse moves: stays flipped.
4. Games tab, a game played as White: flip is reset, White at the bottom,
   header shows the new game.
5. Explorer, add a game: header and orientation unchanged.
6. "as black" in the Explorer: board does not turn.
7. Explain, then the reopened board: same header, same orientation.
8. A FEN from the chat: empty header, White at the bottom.
