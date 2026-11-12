# CDN Engine -- Plan v1

*Status: approved and implemented (2026-11-08), privacy point accepted
with the approval; not yet tested. Adopts the result of
cdn-engine-spike-v1.md; changes browser-analysis-v1.md's engine loading.*

## Goal

The widget loads Stockfish.js 19 lite from unpkg, so Chrome's HTTP cache
keeps it across chats and browser restarts. Measured on desktop: about
0.9 s the first time, about 0.1 s cached, against about 9.4 s through
claude.ai and ngrok. The engine, its options and the analysis are
unchanged.

## Decisions

1. **unpkg, pinned.** Loader and `.wasm` come from
   `https://unpkg.com/stockfish@<version>/bin/stockfish-19-lite-single.{js,wasm}`.
   jsDelivr is not usable: it refuses the `stockfish` package (over its
   150 MB per-package limit).
2. **One version, not two.** The CDN must serve exactly the build the
   fallback serves. `package.json` pins `stockfish` to `19.0.0` exactly
   (no `^`), and the widget build takes the version from
   `node_modules/stockfish/package.json` (Vite `define`), so the URL can
   never drift from the installed package. A version change changes the
   widget, hence its `ui://` URI: reconnect, as for any widget change.
3. **Resource fallback kept.** If unpkg fails (network, refusal, worker
   error, no `uciok` within 20 s), the widget reads the engine from the
   server as today: manifest, loader, `.wasm` in base64 pieces. A console
   warning gives the reason. It is already written and costs nothing
   while unpkg works.
4. **IndexedDB removed.** The HTTP cache does its job within a chat and
   does better across chats. Removed: `openStore`, `loadStored`,
   `saveStored`, `StoredEngine`, and the `version` field of the manifest
   (only IndexedDB used it), with its hash in `src/server.ts`.
5. **Test label removed.** `engineOrigin`, `engineSource`, `startedAt`
   and the label in `widget/board.ts` go. No permanent label: the
   fallback is visible in the console and in its slower start.
6. **CSP.** The board resource keeps
   `_meta.ui.csp.connectDomains: ["https://unpkg.com"]`; comments lose
   the word "spike".

## Open: privacy (developer to confirm)

Each browser without the cached engine makes two GET requests to unpkg
(public files, no personal data; the browser's IP and claude.ai's
referrer policy apply). Accept, or keep the server-only path?

## Files

- `package.json`, `package-lock.json`: `stockfish` pinned to `19.0.0`
  (the lock file changes through `npm install`, run by the developer).
- Vite config: `define` for the stockfish version.
- `widget/engine.ts`: CDN first, resource fallback; IndexedDB and test
  label removed; header comment rewritten (CDN, why, fallback).
- `widget/board.ts`: label removed.
- `src/server.ts`: manifest without `version`, spike wording removed.
- `README.md`: the engine comes from unpkg at the pinned version, with a
  link to Stockfish.js's source at that version (also closes part of the
  license item in TODO.md); `ngrok http 8000` without `--url`.

## Test

1. `npm run typecheck`, `npm run dev`, reconnect the connector.
2. New chat, board: engine ready within about a second; second new chat:
   near instant.
3. Fallback: temporarily set a wrong CDN version in the define, check the
   engine still starts (slowly) and the console shows the warning; undo.

## Afterwards

- Update browser-analysis-v1.md (engine loading), TODO.md.
- Move cdn-engine-spike-v1.md and engine-cache-test-v1.md references as
  needed; spike to `done/`; gemini-cdn-engine.md and
  gemini-parallel-depth-calls.md to `archived/` with notes.
- Mobile check stays in TODO.md's "When away from the PC".
