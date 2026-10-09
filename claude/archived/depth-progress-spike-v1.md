# Depth Progress -- Spike v1

*Result (2026-10-09): NO. The progress notifications never reach the
widget: the panel showed only the final depth-20 lines. The spike code is
removed. Also learned: depth 20 with MultiPV 3 takes 3 to 4.5 s per
position on this PC. Archived.*

*Why, from the code of `@modelcontextprotocol/ext-apps` 1.1.2:*

- *`App.callServerTool` always attaches `onprogress: () => {}`, so every
  widget call carries a progress token. The log's `token yes` only proves
  that claude.ai copies the request parameters, not that anyone listens.*
- *`AppBridge`, the host side, forwards a widget's tool call as
  `this._client.request({ method: "tools/call", params }, schema,
  { signal })`: no `onprogress`. The host's MCP client has no handler for
  the token, so it ignores the notifications, and nothing relays them to
  the widget.*

*So the chain breaks at the bridge, by design of this library version
(the reference implementation of MCP Apps; claude.ai's own code is not
visible, but the result matches). Recheck when upgrading ext-apps.*

*Former status: implemented (2026-10-09), awaiting the test. Plan approved
2026-10-09. A depth is reported when the first line of the next depth
arrives (Stockfish prints a depth's MultiPV lines in order). A spike: it answers one
question and is removed if the answer is no.*

## Question

Can the live analysis panel show Stockfish's lines as each depth is
reached, through MCP progress notifications, on claude.ai?

MCP allows a server to send `notifications/progress` while it handles a
request, on the request's own response stream (no sessions, no GET
stream: fits Aio64's stateless HTTP). But only for a request carrying
`_meta.progressToken`, and here the request travels widget -> claude.ai
-> Aio64, and the notifications back the same way.

Known: the widget side can ask. `App.callServerTool(params, options)`
takes the SDK's `RequestOptions`, whose `onprogress` adds a progress
token to the request. Unknown: whether claude.ai forwards the token to
Aio64, and the notifications back to the widget.

## Changes (temporary)

- `src/engine.ts`: `analyze(fen, droppable, onDepth?)`. While searching,
  each time every MultiPV line has reached a new depth, `onDepth(depth,
  lines)` is called.
- `src/server.ts`, `engine_lines`: read `extra._meta?.progressToken`.
  The log line gets `token yes` or `token no`. With a token and a fresh
  search (not cached), each new depth sends `notifications/progress` with
  `progress: depth`, `total: ANALYSIS_DEPTH`, and `message`: the
  formatted panel lines as JSON.
- `widget/board.ts`: `engine_lines` is called with `onprogress`; each
  notification for the position on screen redraws the panel with its
  lines and `depth N` in front. The final result replaces them as today.

Nothing is cached from progress; only the final depth-20 result is, so
Explain is unchanged.

## Test (developer, web)

1. Restart; reconnect (widget changed).
2. Open a board on a new position (not cached).
3. Read the log line for `engine_lines`:
   - `token no`: claude.ai does not forward the token. Answer: no.
   - `token yes`: look at the panel during the search.
4. The panel climbs through depths before the final lines: answer yes,
   design the feature. Only the final lines appear: claude.ai drops the
   notifications. Answer: no.

## If the answer is no

Remove the spike changes and record the result in this document, which
moves to `archived/`.
