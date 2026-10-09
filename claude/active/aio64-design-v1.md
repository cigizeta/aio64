# Aio64 -- Design and Plan v1

*Status: design agreed in discussion (2026-10-09); Step 0 not started.*

## What Aio64 is

A remote MCP server that the developer connects to Claude (web and mobile)
as a custom connector. Claude shows chess positions in a board widget and
explains them in human language; Aio64 runs Stockfish behind the hood to
ground those explanations.

## Ground rules

- **Never pay.** No API key (the opposite of Mentes: here Claude calls
  Aio64, and the developer's claude.ai subscription pays for the
  conversation) and no VPS. Aio64 runs at home on Windows.
- **Economy.** Every tool definition and tool result lands in Claude's
  context and counts against the subscription quota: few tools, short
  descriptions, compact results.
- **GPLv3.**
- **No engine bundled.** The developer installs Stockfish; Aio64 talks UCI
  to it as a child process, configured by the full path to `stockfish.exe`.
  Pure interop, no GPL question flows either way (and Aio64 is GPL anyway).

## Architecture

```
Claude (web/mobile) --HTTPS--> ngrok static domain --> localhost:<port>
                                                         Aio64 (Node, TS)
                                                           |-- MCP over Streamable HTTP
                                                           |-- ui:// board widget (MCP Apps)
                                                           `-- stockfish.exe (UCI, stdin/stdout)
```

- **Transport:** MCP Streamable HTTP. Claude web/mobile cannot launch a
  local stdio process.
- **Tunnel:** ngrok, using the developer's existing account and its free
  static domain, so the connector URL survives restarts. Cloudflare quick
  tunnels change URL on each restart; named tunnels need a paid domain.
- **Widgets:** the MCP Apps extension. A tool declares a `ui://` HTML
  resource; the client renders it in a sandboxed iframe in the chat.

## Tools (first version)

- `show_position(fen)` -- board widget, near-empty text result.
- `analyze_position(fen, multipv?, movetime?)` -- Stockfish top lines in
  compact form (e.g. `+0.42 | 1.e4 e5 2.Nf3 ...`), a few lines, a few moves
  deep, plus the board widget, so one call does both.

Engine on `apollo` (2026-10-09): Stockfish 19, latest, installed with
winget (`Stockfish.Stockfish`, `x86-64-universal` build); path in `.env`
as `STOCKFISH_PATH`.

The engine process is kept alive between calls (`ucinewgame`, `position`,
`go movetime`).

## Interactivity

Read-only board first. Later, as much interactivity as MCP Apps allows
(moving pieces in the widget, Claude picking up the new position); to be
designed after the read-only version works.

## Authentication

Required from the start, because the ngrok URL is public.

- **Never a secret in the URL.** URLs end up in logs, history and
  connector settings; they are not secrets. Rejected (developer,
  2026-10-09).
- **Preferred first:** a static bearer token in the `Authorization`
  header, checked on every request with a constant-time comparison; token
  kept out of the repository (environment variable or an ignored `.env`).
- **Research (2026-10-09):** claude.ai custom connectors now support
  "static headers" (beta): a fixed header such as `Authorization: Bearer
  ...`, entered when adding the connector and sent on every request. Docs
  speak of an organization administrator entering it; to verify in the
  connector form of the developer's personal Pro account (Step 0).
- **Verified (2026-10-09, Pro account):** after "Continue anyway", the
  Add custom connector form offers Authentication (Sign in now / Sign in
  when needed / No sign-in), OAuth client options (CIMD, DCR, own client),
  and **Request headers** (up to four, stored securely, never shown
  again). Header names are picked from a fixed list, not typed. Aio64 uses
  **No sign-in** plus `x-api-key: <AIO64_TOKEN>`, leaving `Authorization`
  free for OAuth later.
- **If no static header had been possible** (kept for reference): OAuth from the start instead of
  later. Aio64 then acts as its own single-user authorization server (the
  MCP TypeScript SDK ships auth router helpers), with a login/consent page
  protected by a local password and short-lived access tokens. Designed in
  its own doc if needed.
- **Later:** OAuth anyway, if the repository becomes public.

## Stack and toolchain (Windows, Git Bash)

- Node pinned with **Volta** in `package.json` (`"volta": {"node": ...}`),
  the analogue of the Gradle wrapper. TypeScript is a per-project dev
  dependency, never global; `npx tsc` to build, `tsx` in development.
- No Angular-like framework; libraries allowed:
  - `@modelcontextprotocol/sdk` -- server, Streamable HTTP transport.
  - `@modelcontextprotocol/ext-apps` -- MCP Apps widget helpers.
  - `zod` -- tool input schemas.
  - `chess.js` (BSD-2) -- FEN validation, SAN/UCI conversion.
  - Board renderer: `chessground` (GPL-3.0, Lichess) is allowed since Aio64
    is GPLv3; `cm-chessboard` (MIT) is the alternative. To pick in Step 1.
  - HTTP layer: plain `node:http` or a minimal library (Hono or Express).
- Child processes: spawn the real executable path (`stockfish.exe`),
  never relying on a shell.

## Repository cleanup

Mentes now lives in its own repository, created from the `mentes-final`
tag, which must never be moved or deleted. This repository becomes Aio64
only.

- Done by Claude (2026-10-09): rewrote `README.md`, `CLAUDE.md`,
  `claude/TODO.md`, `.gitattributes`, `.gitignore`; added an "Archived"
  note to each Mentes doc.
- Done by the developer: `git rm` the Mentes code and Gradle files
  (`composeApp/`, `acpSpike/`, `gradle/`, `gradlew`, `gradlew.bat`,
  `build.gradle.kts`, `settings.gradle.kts`, `gradle.properties`,
  `MENTES.md`), delete the untracked `.gradle/` and build outputs, and
  `git mv` the Mentes docs to `claude/archived/`.

## Steps

0. **Feasibility checks (developer, mostly manual).**
   - Volta installed on Windows; `node --version`.
   - ngrok static domain reachable: `ngrok http --url=<domain> <port>`.
   - In claude.ai, Settings > Connectors > Add custom connector: check
     that the form offers a request-header field on the Pro account
     (without saving). Present: bearer token. Absent: OAuth first.
   - MCP Apps: documented as supported on web, desktop and mobile for all
     plans (2026-10-09); Step 1 confirms it in practice.
   **Results so far (2026-10-09, machine `apollo`):** ngrok agent updated
   from 3.3.1 (free accounts now need 3.20.0+); `ngrok http 8000` uses the
   account's free dev domain automatically (kept only in the ignored
   `.env` as `PUBLIC_URL`, never in committed files). Aio64 listens on
   port 8000; the connector URL is `$PUBLIC_URL/mcp`.
1. **Hello board spike.** Minimal server with `show_position` returning a
   widget for a fixed FEN, behind auth, through ngrok; check on web and
   mobile.
2. **Stockfish.** UCI wrapper, `analyze_position`, compact result format.
3. **Interactivity.** Design separately once 1 and 2 work.
