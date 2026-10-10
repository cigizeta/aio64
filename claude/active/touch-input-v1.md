# Touch input v1

## Problem

On mobile (the Claude app), pieces can be dragged on the board widget.
Dragging is awkward on a phone; only tap-tap moves (tap the piece, then
the target square) should be supported there.

## Design

- Disable Chessground's dragging when the device's primary pointer is a
  finger: `draggable: { enabled: !touchFirst }`, where
  `touchFirst = matchMedia("(pointer: coarse)").matches`.
- Detection uses `(pointer: coarse)`, the primary pointer, not
  Chessground's own `'ontouchstart' in window`, which would also catch
  touchscreen laptops used with a mouse, where dragging is still useful.
- Decided once at widget load. A device whose primary pointer changes
  while a board is open (a tablet getting a mouse) keeps its first choice.
- No CSS change: dragging worked, so `touch-action` is not involved.

## Effects

- Mobile: a tap selects a piece and shows its legal destinations; a
  second tap moves it. A swipe cannot pick up a piece.
- Desktop: unchanged, drag and click-click both work.

## Implementation

1. `widget/board.ts`: compute `touchFirst` before creating the board and
   pass `draggable: { enabled: !touchFirst }` to `Chessground`.

## Test (needs the server running)

1. `npm run typecheck`.
2. `npm run dev`, then disconnect and reconnect the Aio64 connector
   (the widget URI changes).
3. Mobile app: a piece cannot be dragged; tap-tap moves work, including
   a promotion and castling.
4. Desktop browser: dragging and click-click both still work.
