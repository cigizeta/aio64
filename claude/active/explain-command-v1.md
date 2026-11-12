# Explain Command -- Design and Plan v1

*Status: step 1 (the experiment) implemented (2026-11-12). `open_board`'s
reopen input is named `reopen` (boolean). Test: (a) the prompt was
used; (b) passed (Claude named the position exactly, via a "Check the
app on screen" step); (c) failed. Then no board was drawn at all after
the first one following a reconnect, in any chat, even after reloading
the page (server log: one board, then `open_board` calls with no widget
activity). Cause found: claude.ai now keeps one board per chat and
sends each later `open_board` result to it; our widget collapsed itself
(its viewer ID was no longer the newest) and never expanded again. Fixed:
a board receiving a result expands and takes the new ID.
`updateModelContext` was briefly switched off as a suspect, then back on.

Outcome (2026-11-12): the reopened board below the answer cannot exist
any more (one board per chat), so the `explain` prompt and `reopen` lose
their purpose. claude.ai offers the display modes `inline` and
`fullscreen` (no `pip`); requesting `fullscreen` moves the board into a
side pane beside the chat, where it stays in view while explanations
scroll by. claude.ai honors the request only from a button click: an
automatic request got "kept inline", and a click elsewhere on the board
did not count, and ext-apps 1.7.5 has no tool or resource option to start
a board in fullscreen. A Pane button worked but only duplicated claude.ai's
own fullscreen control (the diagonal arrows), so it was removed: the
developer clicks the arrows once per chat. The Explain button stays as the
way to explain, and the README tells users to click the arrows. The
`explain` prompt (the + menu) and `reopen` were removed (2026-11-12).
Cleanup still to do: `save_board` and `state`.*

## Problem

Since 2026-11-12, claude.ai runs the Explain button's message
(`app.sendMessage`) as a turn "started by a message from the app" and
draws no widget in it: Claude's `open_board` reopens the board on the
server, but nothing is shown (tested with Zod 3 and 4, and with the
v0.1.1 tag: a claude.ai change, not ours). So the button now explains
below the live board, which stays above (TODO.md). The reopened board
below the answer is lost.

## Idea

The developer starts the explanation themselves, so the reply is their
own turn, the kind claude.ai draws widgets in:

1. **The widget keeps Claude informed** with `app.updateModelContext`,
   which starts no reply: claude.ai keeps the latest update and attaches
   it to the next user message (ext-apps documentation). On every new
   position or deeper analysis: the game, the move, the FEN, the engine
   lines and their depth.
2. **An MCP prompt `explain`** offered by the server, reachable from
   claude.ai's **+** menu in the message box: a ready-made message
   asking Claude to explain the position the board shows, from the
   attached context, then to reopen the board below the answer. An
   optional argument for a question ("focus on the rook ending").
3. **Reopening without a saved-state ID:** the server already holds the
   newest board's trees (`report_trees`). `open_board` gets an input to
   reopen them as they are (name to decide), which the prompt asks for.

## Open

1. The Explain button: keep it as today (explanation below the live
   board), or turn it into a hint pointing to the + menu.
2. Analysis depth: the button waits for depth 20; the prompt arrives at
   any depth. The context carries the depth; the prompt asks Claude to
   say when it is shallow (or the widget could hold the update until
   depth 20).
3. Phone: whether the + menu offers connector prompts there too.

## Step 1: experiment (no change to the button)

- Server: register the `explain` prompt (`server.registerPrompt`), and
  `open_board`'s new reopen input.
- Widget: `updateModelContext` on each position and analysis update
  (debounced, about 1 s).
- Test (desktop, after a reconnect): (a) does `explain` appear in the
  + menu? (b) does Claude receive the position (it names the right move
  and FEN)? (c) does the reopened board appear below the answer?
- If all three pass: settle the open points, then the rest. If (a) or
  (b) fails: the idea is dropped and recorded here.
