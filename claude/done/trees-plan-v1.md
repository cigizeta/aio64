# Trees -- Implementation Plan v1

*Status: implemented and committed; tests 1-11 passed on desktop web
(2026-11-12); test 12 (phone) postponed to the final phone check.

*Changes after implementation (developer, 2026-11-08): the status line
(move and evaluation) is removed, since the evaluation repeated the first
engine line and the last move is highlighted; messages show at the top of
the analysis panel. Layout, top to bottom: analysis, board, tree
selector, navigation buttons, tabs. A count of (1) seen during the test
is explained: a page reload (or a server restart) rebuilds the widget
from its original tool result, losing trees added in the widget.
Decided (2026-11-12): a reload starts fresh, by design.* Implements trees-v1.md
(decisions 1-12). Supersedes main-game-v1.md's Explorer rule.*

## State

`src/cache.ts` (the widget mirrors it):

- `BoardState` is renamed **`Tree`**, fields unchanged: `rootFen`,
  `root`, `path`, `games`, `mainGame?`, `flipped`. A played-game tree has
  `mainGame`; an analysis tree has none.
- New **`Trees`**: `{ trees: Tree[]; current: number }`, 1 to 10 trees.
  This is what `save_board` stores and what a widget receives.
- New `latest: { viewerId: string; trees?: Trees }`: the newest widget's
  trees, kept in memory only (decision 12). Replaced, never merged.

## Server (`src/server.ts`)

- **Schemas:** `treeSchema` (today's `boardStateSchema`) and
  `treesSchema` (`trees`: 1 to 10, `current` within range). `MAX_NODES`
  (5000) applies to the total of all trees.
- **`boardResult(text, trees, propose, notice?)`:** payload
  `{ trees, viewerId, propose, book, user, notice }`.
- **New app-only tool `report_trees`** `{ viewerId, state }`: stores the
  trees in `latest` if `viewerId` is the newest widget, else ignores them.
  Hidden from Claude, `readOnlyHint: true` like `save_board` (server
  memory only, nothing outside Aio64 changes). Developer's rule
  (2026-11-08): the only write tool will be the sync of
  local-games-v1.md; memory-only tools stay read-only.
- **`open_board` with `state`:** reopens the saved trees, as today.
- **`open_board` from a FEN or the start, and `explain_position`:** start
  from `latest.trees` (if any), add a new analysis tree as current
  (`color: "black"` flips it). At 10 trees: the old trees, unchanged, with
  `notice: "10 trees open: close one to open another."`
- `save_board` validates `Trees` instead of one board.
- Comments and the cache's header updated (trees, not one board).

## Widget

### Structure (`widget/board.ts`)

- `state` becomes `trees: Trees | undefined`; a `tree()` helper returns
  the current one. Every `state.` use goes through `tree()`.
- `openBoard(payload)` takes `payload.trees`; shows `payload.notice` in
  the status line if present.
- **Reporting:** after any change of trees (open, close, switch, move,
  Raise, flip), a debounced (1 s) `report_trees` call, skipped once the
  widget is stale.

### Tree selector (`widget/board.html`, `board.ts`)

- `#header` becomes `<select id="tree-select">`, the count
  `<span id="tree-count">(3)</span>`, and `<button id="close-tree">✕</button>`,
  same row, same reserved height.
- Option labels: played-game trees as today's header
  (`white (rating) vs black (rating), result`); analysis trees
  `Analysis 1`, `Analysis 2`, ... numbered by their order among analysis
  trees.
- `change` switches the current tree: `setPath(tree().path)`, which
  re-renders, re-explores and restarts the engine on that position
  (decision 2; the per-position analysis cache is unchanged).
- ✕ closes the current tree; disabled with one tree (decision 9). The
  next current tree is the one at the same index, else the last.

### Opening games (`addGame` rewritten)

- **Already open** (a tree whose `mainGame` is the clicked ID): it
  becomes current. Games tab: at its final position. Explorer: at the
  searched position (the first ply of its main line with the same
  position key), else its final position.
- **Not open, 10 trees:** the status line of the tab clicked shows
  "10 trees open: close one to open another."; nothing changes.
- **Not open:** a new tree with the game as its only line (as the Games
  tab builds it today), `mainGame` set, `flipped: false`, appended and
  made current. Games tab: at its final position. Explorer: at the
  searched position (found as above).
- Both switch to the Moves tab, as today.

### Removed

- `joinGame` in `widget/tree.ts`, and helpers only it uses (checked when
  implementing). `makeMainLine` stays (Raise).
- The Moves tab's empty-tree text: "No moves yet: drag a piece, or open a
  game from the Games tab or the Explorer."

### Unchanged

Orientation and flip (per tree), Raise, Explain (current tree only: the
saved `Trees` reopen below the answer, and the message names the current
tree's game as today), collapse of older widgets, engine and analysis
cache, book.

## Files

```
src/cache.ts        Tree, Trees, latest
src/server.ts       schemas, boardResult, report_trees, open_board,
                    explain_position, save_board
widget/board.html   tree selector, count, close button
widget/board.ts     trees state, selector, addGame, reporting
widget/tree.ts      joinGame removed
```

## Tests (developer, web, then phone)

1. `npm run typecheck`, `npm run dev`; **disconnect and reconnect** the
   connector (new tool, widget changed).
2. "Show the Aio64 board": one analysis tree, `Analysis 1`, ✕ disabled.
3. Games tab, a game: a second tree at its final position, count `(2)`,
   header label is the game, ✕ enabled.
4. Same game again from the Games tab: no new tree, it becomes current.
5. Explorer, a game: a new tree at the searched position; the earlier
   trees are untouched (switch back and check their moves).
6. Play a move in a played-game tree: a variation in that tree, no new
   tree (decision 3).
7. Switch trees: the board, moves and analysis follow; returning shows
   the earlier lines at once.
8. Open trees until 10, then an 11th: refused with the message.
9. Close trees down to one: ✕ disabled again.
10. Explain on a played-game tree: the board below Claude's answer has all
    trees, the same one current.
11. Ask Claude for a board from a FEN: the new widget has the earlier
    trees plus a new analysis tree, current.
12. Phone: the selector opens the phone's picker; labels readable.

## Afterwards

- Record results here; trees-v1.md and this plan to `done/`;
  main-game-v1.md gets a "superseded in part, see trees-v1.md" note.
- TODO.md: remove anything this closes.
