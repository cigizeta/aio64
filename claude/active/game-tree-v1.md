# Game Tree -- Plan v1

*Status: stages 1 and 2 implemented together (2026-10-09), awaiting
test. Implementation notes: own plain-JSON tree (chessops' PGN nodes are
classes and do not survive the JSON round trips); chessops for all chess
logic in the widget; `save_board` takes the state as a JSON string,
validated on the server (recursive schema); cached analyses matched by
pieces, side to move and castling (chess.js and chessops may write the en
passant field differently); the explorer queries Lichess only while its
tab is visible; joining a game switches to the Moves tab.*

*Original status: plan, awaiting approval (2026-10-09). Implements "One mode: a PGN
tree" from lichess-games-v1.md; replaces the single-line model of
game-board-v1.md.*

## Goal

The board widget holds one PGN tree that grows as the developer works:
dragged moves add branches, games clicked in the explorer join the tree,
nothing is dropped. Below the board, two tabs: **Moves | Explorer**.

## Decisions (developer, 2026-10-09)

- One mode only; the widget is a PGN tree viewer.
- Tabs Moves | Explorer below the board and controls.
- Forward at a branch: the last visited child, else the main line.
- Joining: a game joins at the highest tree node whose position it passes
  through (normally the root: the whole game); otherwise at the current
  node, discarding its earlier moves; refused only if it passes through
  no tree position.
- Labels (revisable): header per current node -- one game's players and
  result / "N games through here" / "Your analysis"; `[vs X]` where a
  game's branch starts in the Moves tab.
- Transpositions are not merged.

## Library

**chessops** (Lichess, GPL-3.0) in the widget for positions, legal moves,
SAN and FEN. Its PGN `Node`/`ChildNode` types are a candidate for the
tree; if their API does not fit navigation (last visited child, game
tags), a small own tree type is used with chessops for the chess logic.
Decided after reading the installed type definitions, as with the other
libraries. chess.js stays on the server.

## Tree model

```
TreeNode  { san?, children: TreeNode[], games?: string[], visited?: number }
BoardState { rootFen, root: TreeNode, path: number[], games: Record<id, GameInfo>,
             player, color }
```

- `path`: child indexes from the root to the current node.
- `games` on a node: IDs of the games whose line passes through this move.
- `visited`: index of the last visited child (for Forward).
- FENs are computed in the widget, never stored.
- Limits: 5000 nodes per tree; `save_board` rejects larger states.

## Navigation

- Beginning: root. End: follow Forward until a leaf.
- Back: parent. Forward: `visited` child, else child 0.
- Clicking a move in the Moves tab jumps there (and updates `visited`
  along the path).
- Dragging a move: if a child with that SAN exists, go there; else add a
  new child (no games, i.e. "Your analysis") and go there.

## Stage 1: tree and Moves tab

- `open_board(game)`: the server builds the tree with the game's line
  (every node tagged with the game ID) and the game in `games`.
  `open_board(fen)` / start: a tree with only a root. `ply` -> `path`
  along the main line.
- Widget: tree model, navigation above, Moves tab rendering the tree as
  PGN text (move numbers, variations in parentheses, current move
  highlighted, `[vs X]` tags), clickable; fixed height, scrollable.
- Header labels per node.
- Explain: unchanged flow; `save_board` stores the whole state (tree,
  path); the reopened widget restores it. Message context: the header
  label of the current node.
- `save_board` schema: recursive (`z.lazy`), with the node limit.
- The Explorer tab exists but still uses stage 2 of game-board-v1.md
  behavior minus loading in place (disabled until stage 2 here).

## Stage 2: games join the tree

- Explorer tab as today (player, color, moves, recent games); a move in
  the explorer list that already exists in the tree is marked.
- Clicking a recent game: `load_game` (finished check, as today) returns
  its start FEN and moves; the widget applies the joining rule, tags the
  joined nodes with the game ID, adds the game to `games`, and moves to
  the searched position in that game's branch.
- `load_game` no longer refuses set-position games; refusal ("This game
  never reaches a position of the current tree") happens in the widget.

## Files

```
widget/tree.ts       new: tree model, navigation, joining rule
widget/board.ts      tabs, Moves rendering, header labels, explorer join
widget/board.html    tabs, Moves panel
src/server.ts        open_board builds trees; save_board recursive schema
src/cache.ts         BoardState type
src/lichess.ts       accept set-position games (fromPosition)
package.json         chessops
```

## Tests (developer, web)

Stage 1:
1. Reconnect. Open a game: Moves tab shows it; click moves; step.
2. Drag a different move mid-game: a variation appears in parentheses;
   Back then Forward returns along the variation (last visited).
3. Explain inside a variation: the reopened widget has the same tree and
   current move.

Stage 2:
4. Explorer tab, click a recent game: its line joins the tree, tagged
   `[vs X]`; header shows its players.
5. Open a board from a FEN, explore, click a game: it joins at the
   current node.

## Results (2026-10-09)

- Bug found in testing: dragged moves always carried a queen promotion,
  which chessops rejects on non-promotion moves; fixed (promotion only for
  a pawn reaching the last rank).
- **Accepted as is for a solo project** (developer): the user experience
  could be polished by a team, but this version is fine. Open problem:
  explorer search is too slow.
- **Explorer speed, found and fixed:** Lichess's player explorer sends a
  first answer in 0.2 to 1 s, then keeps the connection open while the
  player waits in its global indexing queue (`queuePosition`, moving about
  5 places in 20 s), sending updated lines if new games turn up. Aio64
  waited for the stream to end (15 s timeout). Now it answers with the
  first line, keeps up to 3 streams open for up to 2 minutes in the
  background to update the cache, and the widget refreshes silently from
  the cache while a stream is open. No status label (developer: any
  "indexing" / "checking" label makes one wait for changes that almost
  never come).

## Open questions

- Moves tab height vs board size inline.
- Whether claude.ai limits structured content size for large trees.
