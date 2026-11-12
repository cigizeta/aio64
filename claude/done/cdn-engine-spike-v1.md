# CDN Engine Spike -- Plan v1

*Status: implemented (2026-11-08), not yet tested. Idea from gemini-cdn-engine.md
(its Stockfish 10 proposal is not adopted: the lite NNUE stays).*

## Question

Can the widget load Stockfish.js 19 lite from a public CDN so that
Chrome's HTTP cache keeps both the loader (`.js`) and the `.wasm` (the
lite NNUE compiled in), and possibly the compiled WebAssembly, across
chats?

Today (engine-cache-test-v1.md) claude.ai resets the widget's IndexedDB
at each new chat, so every chat's first board downloads about 2.7 MB of
base64 through claude.ai and ngrok. The HTTP cache is the browser's own,
partitioned by top-level site and frame *site* (not origin), so it may
survive the per-chat origin that resets IndexedDB.

Only the lite build (`stockfish-19-lite-single`) is in scope: no full
build, no separate `.nnue` file.

## What makes caching possible

1. The CDN serves both files with a long `Cache-Control`. jsDelivr does
   for pinned npm URLs: `https://cdn.jsdelivr.net/npm/stockfish@19.0.0/bin/stockfish-19-lite-single.js`
   and `.../stockfish-19-lite-single.wasm` (19.0.0 is the installed
   version; the URL must pin it exactly, never a range).
2. Each URL is identical in every chat. The loader takes the `.wasm`
   address from its URL fragment (`location.hash`), so the widget passes
   the full CDN URL there, never a relative or `blob:` one.
3. The `.wasm` is fetched by the loader itself, from the response
   (`WebAssembly.instantiateStreaming`, which the loader already uses).
   Only then can Chrome also keep the compiled module (its code cache
   for large streamed modules). The base64 path rules this out today.

A Worker cannot be created from a cross-origin URL, so the loader is
fetched with `fetch` (HTTP cache applies) and started as a `blob:`
Worker; the `.wasm` fetch inside it goes straight to the CDN.

## Change (spike only)

- `src/server.ts`: the board resource declares
  `_meta.ui.csp.connectDomains: ["https://cdn.jsdelivr.net"]` (the loader
  and the `.wasm` are both `fetch` requests, so `connect-src`).
  The resource-based engine stays registered, as the fallback.
- `widget/engine.ts`, `startEngine`:
  1. Try the CDN: `fetch` the `.js`, start it as a `blob:` Worker with
     `#<encoded CDN .wasm URL>`, wait for `uciok`.
  2. On any failure (CSP refusal, network, worker error before `uciok`),
     fall back to today's path unchanged (IndexedDB, then resources).
- Temporary test label on the depth line: `· cdn` or `· fallback`, plus
  the time from start to `readyok` in ms.

Nothing else changes: same build, same options, same analysis.

## Test (needs the server running)

1. `npm run typecheck`, `npm run dev`, then disconnect and reconnect the
   Aio64 connector (widget and resource metadata changed).
2. Desktop, claude.ai web, DevTools open on the Network tab, "Disable
   cache" **off**, filter `stockfish`:
   1. New chat, first board. Expected: `cdn`; both files downloaded.
   2. Second board, same chat.
   3. New chat, first board. **The deciding step**: both files must show
      `(disk cache)` or `(memory cache)` in the Size column.
   4. Reload the page, open a board.
   5. Close the browser, reopen, new chat, open a board.
3. Compiled module: in step 3, compare the `readyok` time with step 1.
   A clear drop beyond the download time suggests the compiled module was
   reused too (Chrome does not report this directly; optional check in
   `chrome://tracing` is not required).
4. Mobile app: the same steps, labels only (no DevTools).

| Step                     | Label | `.js`  | `.wasm` | ms  | Mobile |
|--------------------------|-------|--------|---------|-----|--------|
| First board              |       |        |         |     |        |
| Second board, same chat  |       |        |         |     |        |
| New chat                 |       |        |         |     |        |
| After reload             |       |        |         |     |        |
| After browser restart    |       |        |         |     |        |

## Afterwards

- `cdn` and both files cached in a new chat: adopt. Write the real
  design (keep or drop the resource fallback and IndexedDB, README note
  that the engine comes from jsDelivr at the pinned version), then remove
  the test labels.
- `fallback` from the start: claude.ai ignores or refuses
  `connectDomains`. Record it; the spike ends, today's path stays.
- `cdn` but downloaded again in each new chat: the frame site changes
  per chat too. Record it; the spike ends.
- Only the `.js` cached: check the `.wasm` URL and response headers
  before concluding.
- Record results here and in browser-analysis-v1.md, update TODO.md,
  move this doc to `done/`; move gemini-cdn-engine.md and gemini-parallel-depth-calls.md to
  `archived/` with their notes.

## First run (2026-11-08)

claude.ai honored `connectDomains`: the widget's request reached
jsDelivr, which answered 403 "Package size exceeded the configured limit
of 150 MB" (the limit is per package; `stockfish` holds every build, the
full nets included). The widget fell back to resources (9.4 s). Switched
to unpkg, which serves the same pinned file:
`https://unpkg.com/stockfish@19.0.0/bin/stockfish-19-lite-single.js`.

## Second run, unpkg (2026-11-08, desktop, claude.ai web)

| Step                     | Label | ms   |
|--------------------------|-------|------|
| First board              | cdn   | 890  |
| New chat, first board    | cdn   | 121  |
| After browser restart    | cdn   | 99   |
| Old path, for comparison | fallback | 9403 |

The HTTP cache survives a new chat and a browser restart, unlike
IndexedDB: from about 9.4 s through claude.ai and ngrok to about 0.1 s.
Even uncached, the CDN (0.9 s) is ten times faster than the old path.
Not yet tested: the mobile app (no longer decisive, given the uncached
speed).

## Open points

- Privacy: each chat's first board makes a request to jsDelivr (no
  personal data; the browser's IP and the claude.ai referrer policy
  apply). Acceptable?
- Read-only rule: unaffected (a GET of a public file).
