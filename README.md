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
- **Your games**: the finished games of your Lichess and Chess.com
  accounts, kept in local databases filled by a sync you start by hand.
  All Games lists and filters them; the Explorer shows the moves played
  from the position on the board, with game counts and results.
- **Master database**: optionally, the Explorer's Master source, built by
  Aio64 from any PGN collection you choose (see below).

<table><tr><td style="border: 2px solid; padding: 8px 12px;">
💡 <b>Tip: click the board's expand button (the two diagonal arrows) once
per chat.</b> The board then sits beside the chat and stays in view while
explanations scroll by; otherwise it scrolls away above them.
</td></tr></table>

Read-only by design: only the sync writes, and only to the local game
databases (the master database is built by a command you run yourself); nothing is ever written to Lichess, Chess.com or any other
service. No site token or password is needed (public data only), and only
finished games are stored.

## Requirements

- A Claude plan that allows custom connectors (claude.ai).
- Node.js 24, pinned through [Volta](https://volta.sh) in `package.json`.
- An [ngrok](https://ngrok.com) account; the free plan's static domain is
  enough.
- A Lichess and/or Chess.com account (its username only).
- Optional: a PGN collection for the master database.

No chess engine needs installing: the widget loads Stockfish.js 19 lite
(npm package `stockfish`, pinned in `package.json`) from
[unpkg](https://unpkg.com), at exactly the installed version, and the
browser caches it (about 2 MB the first time). If unpkg is unreachable,
the server hands the same files to the widget, more slowly.

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
| `LICHESS_USERS` | Lichess usernames whose finished games are kept, comma-separated |
| `CHESSCOM_USERS` | Chess.com usernames whose finished games are kept, comma-separated |

At least one of `LICHESS_USERS` and `CHESSCOM_USERS` must list an
account. Each account's finished games are kept in its own SQLite file in
`games/`, which Git ignores; only the sync writes there.

Generate `AIO64_TOKEN`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Master database (optional)

The Explorer's Master source shows, for each position up to move 20, the
moves played in a PGN collection of your choice, with how many games
played each and how White scored. Build it from one or more PGN files,
plain or zstd-compressed (detected automatically, read without
unpacking), of any size; the collection you choose is the filter:

```bash
npm run build-master -- <file.pgn>
```

It writes `games/master.sqlite`, always rebuilt from the files given
(asking before it replaces an existing one); restart the server to use
it. Without it, the Explorer offers only your own games.

## Run

In one terminal, the server (it builds the widget first):

```bash
npm run dev
```

In another, the tunnel to it:

```bash
ngrok http 8000
```

ngrok uses your account's dev domain; add `--url=<your-domain>` only if
you have more than one.

At startup the server opens each account's game database (logging how
many games it holds) and the master database if built, and logs one line
per tool call.

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
GPLv3), built from the Stockfish chess engine by the Stockfish team. Its
source: <https://github.com/nmrugg/stockfish.js>, at the version pinned
in `package.json`.
