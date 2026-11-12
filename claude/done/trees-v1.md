# Trees -- Design Discussion v1

*Status: decided (2026-11-08), nothing implemented. Independent of
local-games-v1.md, though both change the Games tab and the Explorer.
First written as game-tabs-v1.md, then open-games-v1.md; renamed as the
terms changed (tabs became a dropdown, slots became trees).*

## Terms

- **Tree:** one of the slots the widget holds (at most 10). A tree holds
  one game and the developer's variations in it. Two kinds:
  - **played-game tree:** from Lichess or Chess.com, the game's moves as
    the main line, with players and a result;
  - **analysis tree:** from a FEN or the start position, with no players.
- **Current tree:** the one shown on the board.
- **Tree selector:** the dropdown that switches the current tree.

The widget's existing **Games tab** (the list of recent played games)
keeps its name.

## Problem

An Explorer click joins the clicked game into the current tree, as the
main line and main game (main-game-v1.md, notes at the top). One tree
then mixes the reviewed game, the developer's analysis, and other games:
the move list is no longer one game, the header names only one of them,
and Explain has no clear game to talk about. A post-game review should
stay about one game.

## Idea

Several trees in one widget, each with its own game, variations, main
game, flip, and current move. Games are never merged: opening a game
opens a new tree.

## Decided (developer, 2026-11-08)

1. **Trees, not merging.** No game is ever joined into another tree.
2. **One engine worker** for all trees, analyzing only the current
   tree's position. Switching trees is like moving to another position
   today: the search stops and restarts there. The shared 16 MB hash and
   the widget's per-position best results carry over, so returning to a
   tree shows its earlier lines at once. Other trees cost nothing.
3. **Variations stay in their tree.** In a played-game tree the game's
   moves are the main line; the developer's variations branch off it, as
   in the Moves tab today. Playing a move on the board never opens a tree
   or uses a slot: it adds to the current tree. Only the Games tab, the
   Explorer, and boards opened by Claude open trees. Variations are
   expected to be small, so the tree limits (and the saved-state size
   with several trees) stay modest.
4. **Games tab click:** opens the game in a new tree at its final
   position (the start of a post-game review); if its tree is already
   open, that tree becomes current.
5. **Explorer click:** opens the game in a new tree at the searched
   position; if its tree is already open, that tree becomes current and
   moves there.
6. **Analysis trees:** a board from a FEN or the start position
   (`explain_position`, `open_board`) opens an analysis tree; several are
   allowed, under the same cap and closing rules.
7. **Tree selector, not a tab row** (tabs would be too small on a phone).
   The header above the board becomes the selector: the current tree's
   full label (`<you> (1850) vs <opponent> (1987), 1-0`, or `Analysis 2`)
   with the number of trees, `▾ (3)`. A native `<select>`, so a phone
   shows its own large picker. A close button (✕) next to it closes the
   current tree. Switching takes two taps, acceptable since a review
   mostly stays on one game.
8. **Cap: 10 trees.** Opening an 11th is refused with a message
   ("10 trees open: close one to open another."); nothing is ever closed
   automatically.
9. **The last tree cannot be closed:** there is always at least one tree,
   and ✕ is disabled while only one is open. (Revised by the developer the
   same day; first decided: closing the last tree leaves a fresh analysis
   tree.)
10. **No "Analyze from here" for now.** No control copies the current
    position into a new analysis tree. Can be added later if missed.
11. **Before local-games-v1.md.** Widget only, testable with today's
    Lichess Games tab and Explorer; it settles how games open before the
    database changes where they come from.
12. **A board opened by Claude keeps the trees.** Each Claude-opened board
    is a new widget (the old one collapses). The widget keeps the server
    informed of its trees (memory only, as `save_board`), and a board
    opened by Claude from a FEN or the start position carries over the
    newest widget's trees, adding the new analysis tree as current. At 10
    trees, the new board opens with the old trees and a message instead.

## For the implementation plan

Technical points, settled there unless the developer objects:

- **Saved state.** `save_board` stores every tree plus the current one;
  the existing limits (1 MB, MAX_NODES) apply to the total.
- **Explain.** Applies to the current tree only; the message names its
  game.
- **Removed code.** `joinGame` and its joining rules in
  `widget/tree.ts`; main-game-v1.md's Explorer rule is superseded.

## Afterwards

The implementation plan (trees-plan-v1.md), then a reconnect
(widget changes).
