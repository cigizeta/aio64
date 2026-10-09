# Mentes -- Design Summary

*Archived 2026-10-09: superseded, Mentes moved to its own repository
(tag `mentes-final`).*

*Design-phase notes (no code). Conversation date: October 5, 2026.*

## 1. Project Overview

**Mentes** is a ChessBase Lite clone. It is currently a private project and will later be published on GitHub under **GPLv3**.

Core features:

1. **Database** -- game storage and search
2. **Stockfish analysis** -- engine integration via UCI
3. **Lichess integration** -- via the Lichess public API
4. **LLM integration** -- the focus of this discussion

## 2. Core Subsystems

### Database
- Store games as PGN for import/export, with an indexed layer on top (players, ratings, dates, events, results, ECO codes).
- Plan **position search** from the start using position hashes (e.g., Zobrist). It is much harder to retrofit.

### Stockfish
- Runs as a separate process speaking **UCI**.
- Design questions: single-line vs multi-PV, infinite vs fixed-depth analysis, saving analysis back into games as annotations.

### Lichess
- Free, documented API: game import, opening explorer (masters and Lichess databases), cloud evaluations.
- Public game import needs no login; account-specific features use OAuth.

## 3. LLM Integration -- Guiding Principles

- **The LLM explains; it never decides.** Stockfish is the source of truth about positions. LLMs (even frontier ones) do not truly understand chess.
- **Ground every prompt** in hard data: FEN, engine lines and evals, move history, opening names.
- **Validate every move** the LLM mentions against a legal-move generator before displaying it.
- **The LLM layer is optional.** Database, Stockfish, and Lichess must work fully without it.

### Strong use cases
- Explaining engine lines in plain language
- Auto-annotating games (engine finds eval drops; LLM writes commentary)
- Natural-language database queries translated into structured queries
- Player reports summarizing patterns across Lichess games

### The analysis layer (Mentes's real "chess intelligence")
Mentes's own code pre-digests engine output into concrete facts before the LLM sees it:
- Convert UCI moves to SAN
- Normalize evals (White's perspective or win probability)
- Label moments ("blunder", "only move")
- Detect tactical/positional facts: hanging pieces, forks, pins, passed pawns, king safety, pawn-structure changes

This makes strong models better and weak models viable. Template-based commentary can even work with no LLM at all.

### Small local models (e.g., Qwen 8B)
- **Good at:** translating evals into words, comparing numbers, ranking multi-PV lines, fluently restating supplied facts.
- **Poor at:** following lines move by move, explaining *why* unaided, parsing raw UCI output (especially side-to-move eval perspective), long contexts.
- Verdict: a capable **narrator**, not an analyst. Recommended: build a 20-30 position benchmark to compare models on identical pre-digested input.

## 4. MCP Server Architecture

Expose Mentes's capabilities as **MCP servers**, used by the LLM as tools.

Proposed engine tools:
- `analyze_position` -- FEN in, top N lines with evals out
- `evaluate_move` -- eval change caused by a specific move
- `legal_moves` / `validate_line` -- lets the LLM check itself
- `analyze_game` -- full PGN in, critical moments out

Further servers: **database** (position search, player stats) and **Lichess** (explorer, game import).

Design concerns: depth/time limits per call, compact structured output with consistent eval units, no hardcoded paths or credentials (keep servers public-ready).

## 5. Constraints and Decisions

| Constraint | Consequence |
|---|---|
| No API key | Rules out direct pay-per-use API access |
| Mentes must be the primary interface | Rules out relying on Claude Desktop as the host |
| Local models are weak at chess | Strong cloud model preferred; analysis layer essential |
| Private now, GPLv3 later | Keep proprietary components optional and separate |

### Decision for the private phase
**Use Anthropic (Opus) with the user's own Claude subscription**, via the Claude Code CLI / Agent SDK, with Mentes as the primary interface and MCP host.

## 6. Subscription Landscape (as of October 2026 -- recheck before release)

- **Anthropic:** Personal use of the Agent SDK with your own subscription is supported. Third-party developers may not offer Claude.ai login or route other users' requests through subscription credentials. A planned Agent SDK credit was paused in June 2026; rules may change again.
- **OpenAI:** Most open. Codex supports ChatGPT sign-in, and the official Codex App Server lets third-party tools use a ChatGPT subscription. Avoid community shortcuts relying on undocumented backend endpoints.
- **Google:** Closed. Using Gemini CLI OAuth in third-party software violates Google's terms (accounts have been suspended), and Gemini CLI stopped serving Pro/Ultra subscription logins on June 18, 2026. API key only.

### Other agent frameworks (open source, model-agnostic)
OpenAI Agents SDK (MIT), Google ADK (Apache 2.0), Microsoft Agent Framework (MIT), LangGraph (MIT), Pydantic AI (MIT), Hugging Face smolagents (Apache 2.0). None unlock a Claude subscription; they need API keys or local models.

## 7. Pluggable Provider Layer

One interface, multiple backends:
- Claude subscription (now)
- ChatGPT subscription (candidate for the published version)
- API key
- Local model
- None

This makes waiting on the shifting landscape cheap: swap or add backends without touching the rest of Mentes.

## 8. Integrating from Kotlin

The official Agent SDK exists only for **TypeScript and Python**. Anthropic's official Java SDK works from Kotlin but requires an API key.

Options:
1. **Community JVM SDK** (Spring AI community `claude-agent-sdk-java`, Apache 2.0) wrapping the Claude Code CLI
2. **Drive the Claude Code CLI directly** as a subprocess with streaming JSON
3. **Sidecar** process running the official SDK, talking to Mentes over stdio or local HTTP

### The UCI analogy
Communicating with the Claude CLI resembles communicating with a UCI engine: launch a process, write to stdin, read a stream from stdout.

Differences to design for: JSON messages, seconds of latency and usage limits (avoid automatic triggers), conversation state and sessions, nondeterminism, nested tool activity, new failure modes (expired login, limits, network).

**Design consequence:** a generic *external process adapter*, with UCI and agent protocols as layers on top.

### Side-by-side chat UI
Mentes draws its own chat panel; the CLI runs headless. Integration ideas:
- Automatic context (current position, game, selected move)
- Streaming replies
- Visible tool activity ("Analyzing position…")
- Clickable, validated moves that update the board
- "Ask Claude about this move" from the board
- Sessions attached to games
- **Disable Claude Code's built-in coding tools** (file editing, shell); allow only chess MCP tools
- Open question: fixed, dockable, or slide-in panel

## 9. Agent Client Protocol (ACP)

ACP (created by Zed) is a standard JSON-RPC-over-stdio protocol between applications and AI agents -- essentially **UCI for agents**.

- **Claude Code:** no native support, but an official Apache 2.0 adapter, `@agentclientprotocol/claude-agent-acp`, built on the TypeScript Agent SDK (requires Node). Verify whether it picks up subscription login; its README example uses an API key.
- **Kotlin:** an official ACP Kotlin SDK (JVM, client and agent sides, full ACP v1) exists. Released on Maven Central (`com.agentclientprotocol:acp` 0.30.1 as of October 2026, MIT). JetBrains' Koog framework uses it.

Resulting stack:

```
Mentes (Kotlin) → ACP Kotlin SDK → claude-agent-acp (Node) → Claude Code → subscription
                                     ↳ Mentes MCP servers passed through to Claude
```

Layered architecture:
- **Process layer:** launch, stdio, lifecycle, shutdown
- **Protocol layer:** UCI for engines; ACP for agents (custom adapters only where needed)
- **Mentes core:** board, database, chat panel, MCP servers -- agnostic of which engine or agent is behind them

## 10. GPLv3 Considerations

*General guidance, not legal advice. See the FSF GPL FAQ.*

- Stockfish is GPLv3 -- ideal pairing.
- Communicating with separate programs at arm's length (pipes, stdio, ACP) normally keeps them separate works.
- **Don't bundle proprietary agents** (e.g., Claude Code); users install them.
- Included libraries must be GPLv3-compatible (MIT and Apache 2.0 qualify; Apache 2.0 is incompatible with GPLv2 only).
- Check the licenses of the Agent SDK, any JVM ports, the ACP Kotlin SDK, and the Codex App Server before release.
- Keep agents optional so users aren't tied to a proprietary tool.

## 11. Android from the Start (decided October 5, 2026)

Android is a first-class target from the start, alongside desktop. Every
feature gets a **Desktop screen** design and a **Smartphone screen** design.
Build order is unchanged: database, Stockfish, Lichess, AI last.

Development moves from WSL2 to native Windows (emulator, USB phone, `.msi`
packaging, Android Studio on the native filesystem).

Consequences identified, not yet decided:

- **Modules:** likely `shared` + `desktopApp` + `androidApp`. Verify that the
  current Android Gradle Plugin (9.x) forbids the Android application plugin
  in a KMP module before relying on it. Cheap now while `composeApp` is a
  scaffold.
- **Android SDK:** not provisioned by Foojay; installed by hand.
- **Platform seams** behind interfaces: file access (Storage Access Framework
  on Android), app data location, process launching.
- **Database:** SQLite (SQLDelight or Room KMP) works on both; phone storage
  constrains the position-search index size.
- **Stockfish:** must be bundled on Android (per ABI, executed from the
  native library directory, still UCI). Desktop: bundled or user-installed,
  undecided. Bundling means shipping its source (GPLv3, compatible).
- **Lichess:** Ktor in common code; OAuth differs (loopback on desktop,
  browser + deep link on Android).
- **AI:** ACP needs Node and Claude Code locally, impossible on a phone.
  Proposed: desktop-only.

Open decisions:

1. Layout chosen by **window size class** (recommended: one state holder per
   feature, wide and compact layouts, shared components) or strictly by
   platform.
2. Module restructure as the first step.
3. Stockfish on desktop: bundled or user-installed.
4. AI on Android: out of scope, desktop-only.
5. Android minimum version; physical phone or emulator for testing.

## 12. Open Questions / Next Steps

- [ ] Choose for the private phase: direct Claude CLI vs ACP (with adapter) -- in progress, see acp-hello-spike-v1.md
- [ ] Detail the MCP server tools (inputs, outputs, limits, eval units)
- [ ] Decide chat panel layout (fixed, dockable, slide-in)
- [ ] Define the scope of the analysis layer
- [ ] Build a model benchmark (20-30 positions)
- [ ] Recheck subscription terms and licenses before GPLv3 release
