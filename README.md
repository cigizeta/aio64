# Aio64

**Aio64** is an MCP server that lets Claude show chess positions in a board
widget and explain them in human language, with Stockfish.js analyzing
them in the browser. Written in TypeScript.

It is a personal tool, run at home: no paid server, no API key. Claude
reaches it through an ngrok tunnel as a custom connector, on the web and
in the mobile app.

## What it does

- **Board widget**: a movable board with a PGN tree (variations, main line,
  flip), shown inside the Claude chat.
- **Live analysis**: Stockfish.js 19 lite runs in the widget, in your
  browser: infinite analysis, three lines, every depth shown as it is
  reached.
- **Explain**: sends the position and the analysis (at least depth 20) to
  Claude, which explains it in plain language.
- **Your Lichess games**: the Games tab lists your last finished games; the
  Explorer searches your own games from the position on the board, or a
  local Polyglot opening book.

Read-only by design: no tool writes anything anywhere, the Lichess token
must have no scopes (the server refuses to start otherwise), and only
finished games are analyzed.

## Requirements

- A Claude plan that allows custom connectors (claude.ai).
- Node.js 24, pinned through [Volta](https://volta.sh) in `package.json`.
- An [ngrok](https://ngrok.com) account; the free plan's static domain is
  enough.
- A Lichess account and a personal API token created at
  <https://lichess.org/account/oauth/token> with **no scopes ticked**.
- Optional: a Polyglot opening book (`.bin`).

No chess engine needs installing: the server hands Stockfish.js (npm
package `stockfish`) to the widget.

## Setup

Commands are for Bash (Git Bash on Windows).

```bash
git clone <repository-url> aio64
cd aio64
npm install
cp .env.example .env
```

npm may warn that `stockfish` has an install script not covered by
`allowScripts`; it only creates aliases for a build Aio64 does not use,
so leave it unapproved.

Fill in `.env`:

| Variable | Value |
|---|---|
| `PUBLIC_URL` | your ngrok domain, e.g. `https://<your-domain>.ngrok-free.dev` |
| `PORT` | local port, `8000` by default |
| `AIO64_TOKEN` | a random secret of at least 32 characters (see below) |
| `LICHESS_TOKEN` | the scopeless Lichess token; its owner is the player whose games are shown |
| `POLYGLOT_PATH` | optional: path to a `.bin` book, e.g. `books/book.bin` |

Generate `AIO64_TOKEN`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Books go in `books/`, which Git ignores, as it ignores `.env`.

## Run

In one terminal, the server (it builds the widget first):

```bash
npm run dev
```

In another, the tunnel to it:

```bash
ngrok http --url=<your-domain>.ngrok-free.dev 8000
```

At startup the server checks the Lichess token (it must have no scopes),
loads the book if configured, and logs one line per tool call.

## Connect Claude

In claude.ai, Settings > Connectors > Add custom connector:

- URL: `$PUBLIC_URL/mcp`
- Request header: `X-Api-Key` with the value of `AIO64_TOKEN`.

Then, in a chat: "Show the Aio64 board", or paste a FEN and ask Claude to
explain it.

claude.ai caches a connector's tool list and its widgets: after changing a
tool or the widget, disconnect and reconnect the connector (a new chat or
a page reload is not enough). The server log shows
`claude.ai read the tool list (reconnected)` when it worked.

## Development

- `npm run typecheck`: TypeScript check of the server and the widget.
- `npm run build:widget`: builds `dist/board.html` (Vite, single file).
- Server code is in `src/`, the widget in `widget/`.
- Working with Claude Code: start it in the repository; `CLAUDE.md` holds
  the project's rules (read-only, no secrets or network details in
  committed files, design before implementing), and `claude/` holds the
  design documents and `TODO.md`.

## License

Copyright (C) 2026 Calogero Zarba

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public
License for more details: the full text is in `LICENSE`.

The board widget runs Stockfish.js (Copyright (C) 2026 Chess.com, LLC,
GPLv3), built from the Stockfish chess engine by the Stockfish team.
