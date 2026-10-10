# Engine Cache Test -- Plan v1

*Status: plan, awaiting implementation and test (2026-10-10). Tests the
IndexedDB engine cache added to browser-analysis-v1.md.*

## Question

Does claude.ai keep a widget's IndexedDB between widgets, so that only
the first board downloads the engine (about 2 MB through claude.ai and
ngrok, the lite NNUE compiled into the `.wasm`)?

Widgets run in sandboxed iframes, so three outcomes are possible:

1. Shared, lasting storage: later widgets find the engine (`cache`).
2. Storage works but each widget gets a fresh or temporary origin: every
   widget starts empty (`download`).
3. Storage is denied: opening IndexedDB throws (today also `download`).

## Change

Today the depth label shows `· cache` or `· download`, and cannot tell
outcome 2 from 3. Add a third temporary value:

- `widget/engine.ts`: `engineOrigin` becomes
  `"cache" | "download" | "no storage" | ""`. `loadStored` tells a failed
  `openStore` (or failed read) apart from a missing or outdated entry;
  on failure the origin is `no storage`. A failed save keeps `download`
  but is remembered, and the label shows `· download (not saved)`.
- Behavior is otherwise unchanged: every storage failure still falls back
  to downloading.

## Test (needs the server running)

1. `npm run typecheck`, `npm run dev`, then disconnect and reconnect the
   Aio64 connector (the widget changed).
2. Desktop, claude.ai web:
   1. In a chat, open a board; wait for the depth line. Expected:
      `download`.
   2. Open a second board in the same chat.
   3. Open a board in a new chat.
   4. Reload the page and open another board.
3. Mobile app: the same steps.
4. Note each label in the table below.

| Step                  | Desktop | Mobile |
|-----------------------|---------|--------|
| First board           |         |        |
| Second board, same chat |       |        |
| New chat              |         |        |
| After reload / restart |        |        |

## Afterwards

- Everything `cache` after the first: the cache works; remove the test
  labels and keep the code.
- `download` throughout: outcome 2, nothing the widget can do; decide
  whether to keep the cache code (harmless) or remove it.
- `no storage`: outcome 3, same decision.
- `download (not saved)`: storage opens but saving fails (e.g. a quota);
  investigate.
- Record the results here and in browser-analysis-v1.md, update
  TODO.md, then move this doc to `done/`.
