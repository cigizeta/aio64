# Games Tab and Main Line -- Plan v1

*Status: implemented (2026-10-09), awaiting test. Plan approved
2026-10-09. Small addition: the controls wrap onto two lines if seven
buttons do not fit the widget width.*

*Change (developer, 2026-10-09): Lichess's export is ordered by start
date only (verified: a 13-day correspondence game that ended last came
third of three). Aio64 fetches the last 50 games by start, without moves,
sorts them by `lastMoveAt`, and shows the 10 that ended most recently. A
game started before those 50 is missed; accepted.*

*Change (developer, 2026-10-09): the player field is gone; it was
confusing. Explorer and Games always show LICHESS_USER, the token's owner,
enforced on the server. Later the same day: `LICHESS_USER` is removed
from `.env`; the user is taken from the token itself (token test, then
`/api/account` for the name as written). In the Explorer one line of
buttons: Local | <user> as white | <user> as black. Also: `explore_position` and `recent_games` take no
player, `open_board` lost its `player` parameter, and `BoardState` lost
`player`. The White/Black switch shows on the Explorer's Games source
only.*

*Original status: plan, awaiting approval (2026-10-09). Implements "Third tab:
recent games" from lichess-games-v1.md, including the main-line design.*

## Goal

Review games right after finishing them on Lichess: a **Games** tab lists
the player's last 10 finished games; clicking one adds it to the tree as
the **main line** and shows its final position. A **Make main line**
button promotes any line through the current move.

## Server

### `recentGames(player, token)` in `src/lichess.ts`

- `GET https://lichess.org/api/games/user/<player>?max=10&moves=false&ongoing=false&finished=true`
  with `Accept: application/x-ndjson` and the scopeless token. Read-only.
  Asking for finished games only keeps games in progress out of the list
  (anti-cheating rule), and `load_game` still checks each game's status.
- Keep standard and from-position games only (the tree is standard chess).
- Per game: `id`, the player's `color` (by matching the name), `opponent`,
  `opponentRating`, `result` from the player's view (`win`, `draw`,
  `loss`), `speed`, `endedAt` (`lastMoveAt`, milliseconds).
- 404 -> "No Lichess player ..."; 429 -> rate limit message.
- Cache per player for 60 s, so a just-finished game appears within a
  minute.

### App-only tool `recent_games(player)`

Returns `{ games: [...] }`; read-only; hidden from Claude.

`load_game`, `open_board` and the other tools are unchanged.

## Widget

### Tree operations (`widget/tree.ts`)

- `joinGame` returns both the path to the searched position (Explorer)
  and the path to the game's **last move** (Games tab).
- New `makeMainLine(root, path)`: at every node along `path`, move the
  chosen child to the front; `visited` indexes are remapped (the moved
  child becomes 0, the ones before it shift by one). Returns the path,
  which is now all zeros.
- Adding a game already in the tree follows its existing moves (no
  duplicates); from the Games tab it is promoted and shown at its end.

### Games tab

- Tabs become **Moves | Explorer | Games**. The player field and the
  White/Black switch move above the tabs' content area so that Explorer
  and Games share the player (the switch only affects the Explorer).
- Opening the tab calls `recent_games` for the player; rows:
  `won  W  vs FosTerRon (1987)  corr  2 h ago` (time since `endedAt`:
  minutes, hours, "yesterday", days, then the date).
- Clicking a row: `load_game`, `joinGame` (the joining rule as in the
  Explorer), then `makeMainLine` on the path to the game's last move, then
  go there and switch to the Moves tab.
- A game that reaches no position of the tree is refused with the same
  message as in the Explorer.

### Make main line button

- In the controls after Explain: "Main line". Enabled only when the
  current path contains a non-zero index (the current move is in a
  variation).
- Promotes the current path extended by the last visited branches below
  it (the path End would reach), then keeps the current move selected
  (its path becomes zeros of the same length).

Explorer additions stay variations, as today.

## Files

```
src/lichess.ts      recentGames, 60 s cache
src/server.ts       recent_games (app-only)
widget/tree.ts      joinGame end path, makeMainLine
widget/board.ts     Games tab, Main line button, shared player field
widget/board.html   third tab, button, player field above the tabs' area
```

## Tests (developer, web)

1. Restart; reconnect (new tool, widget changed).
2. Finish a game on Lichess (or use the latest one); open the Games tab:
   it is at the top within a minute.
3. Click it: the Moves tab shows it as the main line, the board shows its
   final position; any earlier line now appears as a variation.
4. Click a variation's move, press Main line: it becomes the main text.
5. Add a game from the Explorer: it stays a variation.
6. Click the same game again in Games: no duplicate, it is promoted.

## Open questions

- Whether 10 games and a 60 s cache suit the developer's rhythm of play.
