# CLAUDE.md -- Aio64

**Aio64** is a remote MCP server, written in TypeScript, that the developer
connects to Claude (web and mobile) as a custom connector. It shows chess
positions in a board widget, where Stockfish.js analyzes them in the
browser, so that Claude can explain positions in human language.

## Never pay

Aio64 never uses an API key and never runs on a paid server. It runs at
home on Windows, reached through an ngrok tunnel; the developer's claude.ai
subscription pays for the conversation on Claude's side.

## Read-only, and never a cheating tool

- Aio64 is read-only: no tool may change anything anywhere (no writes to
  Lichess or any other service, no files written, no moves played). Every
  tool carries the MCP annotation `readOnlyHint: true`.
- External tokens get the least rights possible, and the server verifies
  them at startup (the Lichess token must have no scopes).
- Games are analyzed only once finished; the server enforces this from
  the game status, never relying on Claude's judgment.

## Refreshing Claude's tool list

claude.ai caches each connector's tool list; new chats and page reloads
do not refresh it. After adding, renaming, or changing the description or
parameters of a tool, the developer must disconnect and reconnect the
Aio64 connector in Settings > Connectors. Remind them whenever a change
needs it. Changes to a tool's behavior only need a server restart.

claude.ai also caches widget HTML by its `ui://` URI. The server puts a
hash of the built widget into the URI, so any widget change gives a new
URI; since the URI is part of the tool definitions, a widget change also
needs a disconnect and reconnect.

## No personal network details in the repository

IP addresses (including the developer's own), the ngrok domain, and tokens
must never appear in any committed file: code, docs under `claude/`,
comments, examples, or commit messages. They live only in the ignored
`.env`; elsewhere write a placeholder such as `<your-domain>`,
`$PUBLIC_URL`, or `<AIO64_TOKEN>`. The loopback `localhost` /
`127.0.0.1` is fine.

## No autonomous writes allowed

The development of this project assumes that access to NotebookEdit, Bash,
PowerShell, and Monitor is fully denied to Claude.  As a consequence, Git
is also fully denied.

The `mentes-final` tag preserves the Mentes project this repository used to
hold. Never suggest a command that moves or deletes it.

## claude/ organization

Each repository has its own `claude/` directory (prose, distinct from the
`.claude/` harness config), holding `TODO.md` plus `active/`, `done/`, and
`archived/`.

- `active/`: work in progress.
- `done/`: completed, verified work, moved from `active/` as-is, no rename.
- `archived/`: superseded/abandoned/stale docs, moved here as-is with
  a "superseded, see X" note if applicable.

Source code must never reference a `claude/` document (bare filename or
path) -- inline the "why" directly in the code instead. Fix existing
violations opportunistically, not as a sweep.

Within `claude/`, docs may reference each other, but only by bare filename,
because filenames survive moves between the three subdirectories; paths do not.

## Design first, implement later

Do not rush off implementing. First discuss the design thoroughly, then write
the implementation plan as a document in `claude/active/`, and only then apply
it.

## Fenced blocks

When you want the developers to run something themselves, such as shell
commands or a commit, put it inside a fenced block so that they can copy it.
Put each command in its own fenced block: three consecutive commands are
three fenced blocks, never one block holding all three. Commit messages
must be one line only.

## Development platform: Windows with Git Bash

Aio64 is developed on native Windows, not WSL. The shell is **Git Bash**,
never PowerShell or cmd: every command in a fenced block uses Bash syntax.

- Line endings are governed by `.gitattributes`.
- Git Bash rewrites arguments that look like Unix paths when calling native
  Windows programs; prefix the command with `MSYS_NO_PATHCONV=1` when that
  bites.
- Code that launches processes cannot rely on a shell: spawn the real
  executable (e.g. the full path to `stockfish.exe`).

## Toolchain: Volta, Node, TypeScript

- Node is pinned with **Volta** through the `volta` field of `package.json`.
  Never suggest installing Node any other way.
- TypeScript and every other tool are per-project dev dependencies, run
  through `npx` or npm scripts, never installed globally.
- No Angular-like frameworks; libraries are fine.

## Licensing

Aio64 is AGPLv3 only (`LICENSE`, `AGPL-3.0-only`): the developer's goal
is that nobody makes money by forking or using the code, and AGPLv3 also
obliges anyone running a modified Aio64 as a network service to share its
source. Its GPLv3 dependencies (chessground, chessops, Stockfish.js) may
be combined with it (GPLv3 section 13). The widget runs Stockfish.js
(GPLv3, npm `stockfish`), which the server hands to it as MCP resources;
no engine needs installing.

## No em dashes

Never write em dashes (—) or en dashes (–) to any file in this repository,
Markdown or otherwise. Write a double hyphen (--) instead.
Ordinary hyphens (-) are fine.
