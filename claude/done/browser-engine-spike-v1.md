# Browser Engine -- Spike v1

*Result (2026-10-09): YES. Stockfish.js lite single-threaded runs in the
widget on claude.ai, depths climbing live. Embedded in the widget (2.7 MB)
it was refused by claude.ai ("Unable to reach Aio64"); read from the
server as MCP resources (manifest, loader, .wasm in 400 kB base64 pieces)
it works. Superseded by browser-analysis-v1.md, which made it the only
analysis.*

*Former status: implemented (2026-10-09), awaiting the test. Unknown 3 settled
by reading the loader: inside a worker it takes the `.wasm` address from
the worker URL's fragment, so the widget starts the worker as
`blob:<js>#<blob: of the wasm>`. The package's postinstall (aliases for
the full build) is not needed and not approved. Code: `widget/engine-spike.ts`.*

*Original status: plan, awaiting approval (2026-10-09). A spike: it answers one
question and is removed if the answer is no.*

## Question

Can the board widget run Stockfish itself, inside claude.ai's sandboxed
iframe, and show every depth as it is reached?

Background: progress notifications from Aio64 never reach the widget
(depth-progress-spike-v1.md), and the MCP Apps specification does not
list them among the messages a widget receives. A browser engine needs
no relay: depths are messages inside the page. Claude still gets the
analysis through Explain, which the widget writes itself.

## Engine

Stockfish.js 19.0.0 (npm `stockfish`, GPLv3, maintained by Chess.com),
flavor **lite single-threaded**: `stockfish-19-lite-single.js` + `.wasm`,
about 1.6 MB, small NNUE built in. Chosen because it needs no
cross-origin isolation (a sandboxed iframe cannot have it); the project
itself recommends it. Weaker than Stockfish 19 on the PC.

## Unknowns the spike answers

1. WebAssembly: does claude.ai's content security policy let the widget
   compile WebAssembly?
2. Worker: may the widget start a Web Worker from embedded code (a
   `blob:` URL)?
3. Loading: can the engine find its embedded `.wasm` (normally fetched
   next to the `.js`)? Settled by reading the generated loader after
   installing the package; the plan adapts to what it expects (a
   `locateFile` hook, a URL hash, or passing the bytes).
4. Size: does claude.ai accept a widget of about 2.5 MB (the 1.6 MB engine
   embedded as base64, plus today's 360 KB)?
5. Speed: how deep the lite engine gets in a few seconds.

## Changes (temporary)

- `npm install --save-dev stockfish` (the package unpacks to about 205 MB
  in node_modules; only the lite single-threaded files are embedded).
  `allowScripts` may need an entry for its postinstall script.
- `widget/board.ts`: on opening, a self-test, reported step by step in a
  temporary line under the analysis panel:
  1. `WebAssembly.validate` / instantiate a tiny module: `wasm ok` or the
     error.
  2. Start the engine worker from a `blob:` URL: `worker ok` or the
     error.
  3. `uci` -> `uciok`: `engine ok, <name>`.
  4. For the position on screen: `go depth 20`, each `info depth N` shown
     as it arrives (depth, eval, first moves), then `bestmove` with the
     elapsed time.
- The server analysis panel stays as it is, so the two can be compared.
- Nothing else changes: no Explain change, no tool change.

## Test (developer, web)

1. Restart; reconnect (widget changed).
2. Open a board. Read the self-test line:
   - stops at `wasm`, `worker` or `engine`: answer no, with the reason.
   - the widget does not load at all: size refused (unknown 4).
   - depths climb live: answer yes. Note the depth reached in 3 s and the
     time to depth 20, against the server panel.

## If the answer is yes

Design the real feature separately: browser engine as the live panel,
whether the server engine stays (for Claude's `explain_position`, or as a
deeper check), and what Explain sends. Bundling an engine is allowed: the
"No chess engine is bundled" line in CLAUDE.md came from Mentes, not from
Aio64's own rules (developer, 2026-10-09).

## If the answer is no

Remove the spike changes and the package, record the result here, and
move this document to `archived/`. Fallback: polling (TODO.md).
