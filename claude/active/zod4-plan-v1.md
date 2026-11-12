# Zod 4 -- Implementation Plan v1

*Status: implemented (2026-11-12); tests 1-2 passed (`npm audit`: 0
vulnerabilities; typecheck clean, the `z.record` line the only break).
Side effect: the widget grew from 371 kB to 559 kB (gzip 97 to 145 kB),
since ext-apps imports `zod/v4`, now the full Zod 4.6.7 instead of Zod
3.25's early copy; the vite build also prints two harmless Rollup
warnings about `@__PURE__` comments in Zod's code. Accepted if the
widget still loads (test 3); worth rechecking on the phone. Tests 3-5
to do.

Test 3 found a regression: after Explain, the board reopened with
`open_board` and `state` ran ("Board reopened.") but claude.ai drew no
widget for it, and the live board collapsed to "Continued below" over
nothing. It worked on 2026-11-12 morning with Zod 3 (trees-plan-v1.md,
test 10). Reordering the prompt (reopen first, explain last) made the
explanation visible but still drew no board. Experiment: original
Explain restored, Zod 3.25.76 reinstalled temporarily: still no board.
So Zod is not the cause: claude.ai now runs the Explain message as a
turn "started by a message from the app" and draws no widget in it.
Explain no longer reopens the board (TODO.md); Zod 4 reinstalled.*

## Why

`npm audit` (2026-11-12): GHSA-mrhx-c7xc-m3w5, high: Zod before 4.6.6
can exhaust memory while validating oversized constrained collections.
Fixed only in Zod 4, a major version. Exposure was low (only claude.ai
calls the tools, after the `AIO64_TOKEN` check; the largest input, a
tree state, is capped at 1 MB as a string before Zod sees it), but the
fix is small.

## Compatibility (checked in node_modules)

- `@modelcontextprotocol/sdk` 1.32.1: peer `zod ^3.25 || ^4.0`.
- `@modelcontextprotocol/ext-apps` 1.7.5: peer `zod ^3.25.0 || ^4.0.0`;
  it already depends on Zod 4 itself.
- So no other upgrade is needed. But `package.json` still allowed
  `sdk ^1.20.0` and `ext-apps ^1.1.2`, and a fresh install could pick
  versions older than those checked (early SDK 1.x accepted Zod 3
  only). The ranges are raised to the installed, checked versions:
  `^1.32.1` and `^1.7.5`.

## Changes

- `package.json`: `"zod": "^4.6.7"` (via `npm install zod@^4.6.7`).
- `src/server.ts`, the only file using Zod:
  - `z.record(gameInfoSchema)` becomes
    `z.record(z.string(), gameInfoSchema)` (Zod 4 requires the key
    schema).
  - Everything else (`object`, `array`, `enum`, `lazy` with a
    `z.ZodType<TreeNode>` annotation, `refine` with a message string,
    `default`, `describe`, `min`/`max`/`int`) is expected to work
    unchanged; the typecheck confirms, and any other break is fixed
    the same way and recorded here.

## Tests (developer, desktop)

1. `npm install zod@^4.6.7`; `npm audit`: 0 vulnerabilities.
2. `npm run typecheck`.
3. `npm run dev`; **disconnect and reconnect** (the tool schemas are
   regenerated from Zod and may change in detail).
4. Every tool once:
   - open a board ("Show the Aio64 board"): `open_board`;
   - a FEN board with Explain: `explain_position`, then `save_board`
     and the board reopened below the answer (`open_board` with
     `state`);
   - Explorer, Personal and Master: `explore_position`,
     `master_moves`;
   - All Games with a few filters and More: `list_games`;
   - open a game: `load_game`;
   - Sync: `sync_games`, `sync_status`;
   - a second widget collapses the first: `viewer_status`;
   - tree reporting carries trees to the next board: `report_trees`.
5. An invalid input still fails cleanly: ask Claude for a board from an
   invalid FEN (the error text comes back, the server keeps running).

## Afterwards

Record results here; this plan to `done/`; TODO.md's Zod item removed.
