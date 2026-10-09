# Hello Board Spike -- Plan v1

*Status: plan, choices settled with the developer (2026-10-09), awaiting
approval to implement. Step 1 of aio64-design-v1.md.*

## Goal

Prove the whole chain end to end:

Claude (web and mobile) -> ngrok -> Aio64 on `localhost:8000` -> one tool
whose result shows a given position on a chessground board in the
conversation.

**Success:** asked to show a position, Claude calls `show_position(fen)`
and the board renders inline with that position, on claude.ai web **and**
on the mobile app. An invalid FEN gets a short tool error. A request
without the token gets 401.

Out of scope: Stockfish, interactivity, board orientation.

## Decisions (developer, 2026-10-09)

- **Run:** `tsx`, no server build step; `tsc --noEmit` type-checks.
- **HTTP:** plain `node:http`, no framework.
- **Auth header:** only `X-Api-Key: <token>`. `Authorization` stays free
  for OAuth later. (Planned as `X-Aio64-Token`, but the connector form
  offers no custom header names; `x-api-key` was the available choice.)
- **MCP sessions:** stateless.
- **Board:** chessground (GPL-3.0, Lichess) from the start.
- **Widget bundling:** Vite + `vite-plugin-singlefile`, one self-contained
  HTML file, as in the official ext-apps examples.
- **Position:** passed from the tool to the widget as a FEN, through the
  ext-apps `App` client.
- **FEN validation:** on the server, with chess.js (BSD-2).

## Files

```
package.json
tsconfig.json
vite.config.ts           widget build only
src/server.ts            HTTP server, auth, MCP server, tool, resource
widget/board.html        widget entry (Vite input)
widget/board.ts          App client + chessground
dist/board.html          build output, read by the server (ignored by Git)
```

### package.json

- `"type": "module"`, `"private": true`, `"license": "GPL-3.0-only"`.
- `"volta": { "node": "24.21.0" }`.
- dependencies: `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`,
  `zod`, `chess.js`, `chessground`.
- devDependencies: `typescript`, `tsx`, `@types/node`, `vite`,
  `vite-plugin-singlefile`.
- scripts:
  - `"build:widget": "vite build"`
  - `"dev": "npm run build:widget && tsx --env-file=.env src/server.ts"`
  - `"typecheck": "tsc --noEmit"`

`package-lock.json` is committed and pins exact versions.

### tsconfig.json

`strict`, `target` `ES2024`, `module`/`moduleResolution` `NodeNext` for
the server; `lib` includes `DOM` for the widget code; `noEmit`.

### vite.config.ts

Input `widget/board.html`, output `dist/`, plugin `viteSingleFile()`, so
JS and CSS (chessground's base, board and piece CSS, whose piece images
are data URIs) end up inline in `dist/board.html`.

## server.ts

1. **Config.** Read `PORT` and `AIO64_TOKEN` from `process.env` (loaded by
   `--env-file`). Exit with a clear message if the token is missing or
   shorter than 32 characters. Read `dist/board.html` once at startup;
   exit if missing ("run npm run build:widget").
2. **HTTP.** Plain `node:http`. Only `/mcp`; anything else 404.
3. **Auth.** First thing on every request: the `X-Api-Key` header must
   equal the token, compared with `crypto.timingSafeEqual` on
   equal-length buffers. Otherwise 401, empty body. Never log the token or
   the headers.
4. **MCP.** Stateless Streamable HTTP: for each POST, a fresh `McpServer`
   and a `StreamableHTTPServerTransport` with `sessionIdGenerator:
   undefined`, then `transport.handleRequest(req, res, body)`. GET and
   DELETE on `/mcp` answer 405.
5. **Widget resource.** `registerAppResource` (from
   `@modelcontextprotocol/ext-apps/server`), URI `ui://aio64/board.html`,
   MIME type `RESOURCE_MIME_TYPE` (`text/html;profile=mcp-app`), content
   the built HTML.
6. **Tool.** `registerAppTool`:
   - name `show_position`;
   - description: "Show a chess position on a board.";
   - input: `{ fen: string }` (zod), described as "FEN of the position";
   - `_meta.ui.resourceUri: "ui://aio64/board.html"`;
   - validate with chess.js (`validateFen`); invalid -> `isError: true`
     with the validator's one-line reason;
   - valid -> text "Board shown." plus `structuredContent: { fen }`.
7. **Logging.** One line per request: method, path, status.

Before coding, check the installed versions' API (`registerAppTool`,
`App` client, transport constructor, chessground config) against their
type definitions in `node_modules`, not against blog posts.

## Widget

- `board.html`: a single `<div id="board">`, sized
  `width: min(100%, 360px); aspect-ratio: 1`; theme via
  `prefers-color-scheme` for the page background.
- `board.ts`:
  - import chessground and its CSS (base, brown board, cburnett pieces);
  - create the board with `viewOnly: true`, `coordinates: true`,
    orientation white, starting position until data arrives;
  - create the ext-apps `App`, register the tool-result handler, connect;
  - on a tool result, read `structuredContent.fen` and call
    `board.set({ fen })`.
- No external resources at runtime: everything is inline, so the iframe
  CSP needs no extra origins.

## .gitignore

Add `dist/` (already present).

## Run and test (developer)

1. `npm install`
2. `npm run typecheck`
3. Terminal 1: `npm run dev`
4. Terminal 2: `ngrok http 8000`
5. Negative test, no header: `curl -i -X POST https://<domain>/mcp` -> 401.
6. claude.ai > Settings > Connectors > Add custom connector: name `Aio64`,
   URL `https://<domain>/mcp`, Continue (anyway), Authentication
   **No sign-in**, Request header `x-api-key` = `<AIO64_TOKEN>`.
7. New chat, connector enabled: "Show me the position after 1.e4 e5 2.Nf3
   Nc6 3.Bb5 on a board." The board renders inline with that position.
   Then ask for an invalid FEN on purpose and see Claude handle the error.
   Repeat on the mobile app.
8. Record results in this doc.

## Results (2026-10-09, machine `apollo`)

- `npm install`: chessground 9.2.1 is deprecated; switched to
  `@lichess-org/chessground` 10.4.2 (same repository, new scope).
  esbuild's postinstall approved via `allowScripts`. `npm audit`: 3 high,
  all one `braces` advisory (all versions) reached through
  `vite-plugin-singlefile` -> `micromatch`; build-time only, patterns are
  ours, never fed external input. Accepted; `audit fix --force` would
  downgrade the plugin.
- `npm run typecheck`: clean on first run.
- Connector form: header names come from a fixed list; `x-api-key` used.
- **Web: success.** "Show me the position after 1.e4 e5 2.Nf3 Nc6 3.Bb5
  on a board." -> Claude called `show_position`, the chessground board
  rendered inline with the correct position, followed by a one-sentence
  answer.
- Defect: board coordinates render tiny and misplaced (the "H" outside
  the right edge). The `#board` sizing does not match chessground's
  `cg-wrap` expectations. Fix in Step 2.
- **401 without key: success** (`curl -i -X POST <domain>/mcp`). ngrok
  adds an `Ngrok-Agent-Ips` response header exposing the home public IP to
  any caller; not ours to control. Keep the domain out of the repository
  before it goes public.
- **Invalid FEN via Claude:** given a FEN with `x` as side to move, Claude
  spotted it, corrected to `w` and called the tool only with the valid
  FEN. The server-side validation was therefore not exercised; tested
  directly with a `tools/call` curl instead: `isError: true`, "Invalid
  FEN: side-to-move is invalid" (chess.js already prefixes "Invalid FEN:",
  so the server no longer adds its own).
- **Step 1 done on web.** Carried over: mobile check (TODO), coordinates
  defect (Step 2).
- Mobile deferred (developer, 2026-10-09): development happens on web;
  the developer checks mobile when away from the PC.

## Open questions

- Does the connector check pass with No sign-in and a header, or does it
  still need "Continue anyway"?
- Does the widget size itself correctly on mobile?
- Does Claude produce correct FENs from move lists, or will a
  `moves` input (SAN list, converted by chess.js) be needed later?
