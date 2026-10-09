# ACP Hello Spike -- Plan v1

*Archived 2026-10-09: superseded, Mentes moved to its own repository
(tag `mentes-final`).*

*Status: Step 1 run successfully; usage-page check pending. Continues
mentes-design-summary.md, section 12, first open question.*

## Goal

Prove that Mentes (Kotlin) can talk to Claude through ACP using the
developer's **personal claude.ai subscription** (Pro or Max), not an API key.
A single "Hello" prompt with a streamed reply is enough.

This is the feasibility gate for the LLM integration. A failure here does
**not** make the project infeasible: the fallback (see below) drives the
Claude Code CLI directly, which is supported for personal use with one's own
subscription. It would only rule out the ACP route.

## Findings so far (October 2026)

- **ACP Kotlin SDK** -- `com.agentclientprotocol:acp`, on Maven Central,
  latest release **0.30.1**. MIT. Needs Kotlin 2.2.20+ (we use 2.4.20).
  Provides `StdioTransport`, `Protocol`, `Client`, `ClientSupport`,
  `ClientSessionOperations`. The "0.1.0-SNAPSHOT" note in the design summary
  is outdated. The README example targets an older API; check the 0.30.1
  API before coding.
- **claude-agent-acp** -- `npm install @agentclientprotocol/claude-agent-acp@preview`,
  Apache 2.0, needs Node. Subscription support is **unconfirmed**:
  - For: the JetBrains "Subscription ACP Agent" plugin states the adapter
    supports subscriptions by default; the login is read from
    `~/.claude/.credentials.json` (Linux) after `claude auth login`. A
    `--hide-claude-auth` flag lets hosts hide that option.
  - Against: an OpenClaw issue (March 2026) reports an API key is required;
    a Zed issue (August 2026, untriaged) reports subscription login missing
    in Zed 1.13.2.
  - Working hypothesis: the adapter supports it; some hosts hide or break it.
    Only a local test settles this.
- If `ANTHROPIC_API_KEY` is set, Claude Code silently uses API billing.
  It must be unset.
- The VS Code extension bundles its own `claude` binary, not on PATH.
  Install the standalone CLI with the native installer
  (`curl -fsSL https://claude.ai/install.sh | bash`).

## Step 0 -- manual checks (developer, outside Mentes)

Run on the PC logged in with the personal account:

1. `claude auth status` -- shows a claude.ai login, personal Pro/Max.
2. `env | grep ANTHROPIC` -- prints nothing.
3. `node --version` -- 18 or newer.
4. `npx @agentclientprotocol/claude-agent-acp@preview` -- starts and waits
   silently on stdin (Ctrl+C to quit).

Never print `~/.claude/.credentials.json`; `ls -l` is enough to check it
exists.

**Result (2026-10-05, machine `apollo`):** checks 1-3 pass -- claude.ai
login, `subscriptionType: pro`, no `ANTHROPIC_*` variables, Node v24.18.0;
the credentials file exists (mode 600). Check 4: npx resolved `@preview` to
**0.85.2-preview.19** and installed it; it then waits silently on stdin
as expected. Step 0 passes. The spike pins that exact version rather
than the moving `@preview` tag.

Node and npx come from **Volta** shims (`~/.volta/bin/node`,
`~/.volta/bin/npx`), which are on `PATH` only via the shell profile.

## Step 1 -- Kotlin hello

1. Launch the adapter with `ProcessBuilder`
   (`npx @agentclientprotocol/claude-agent-acp@0.85.2-preview.19`); wire its
   stdin/stdout into the SDK `StdioTransport`; forward its stderr to the
   console. Resolve `npx` by name through `PATH`, never a hardcoded path
   (Volta shims). If the launch fails, print the `PATH` the process saw.
   Run from a shell so the daemon inherits the Volta `PATH`.
2. `initialize`, then `session/new` with no MCP servers.
3. Prompt "Hello"; print streamed text chunks as they arrive.
4. Reject every permission request: no file edits, no shell.
5. Print authentication and usage-limit errors in full -- that is exactly
   what the spike is testing.

Run with `./gradlew :acpSpike:run`.

**Success:** a streamed reply arrives, and the claude.ai usage page shows it
against the subscription, not API usage.

## Decisions

- **Account:** personal claude.ai subscription. Decided.
- **Location:** throwaway Gradle module `acpSpike/` with a plain JVM `main`,
  keeping `composeApp` clean. Decided.
- **ACP only.** The spike targets ACP alone. ACP plays for Mentes the role
  UCI plays for chess engines: a standard protocol to any compliant agent,
  not a tie to one vendor's CLI. The CLI-direct route
  (`claude -p --output-format stream-json`) is not built now; it is a last
  resort, used only if ACP proves unworkable. Decided.

## Step 1 result (2026-10-05, machine `apollo`)

`./gradlew :acpSpike:run` compiled and ran first time. A streamed reply
arrived ("Hi! What can I help you with today?"), stop reason `END_TURN`,
with no `authenticate` call.

- Subscription evidence: `UsageUpdate._meta` carries `_claude/rateLimit`
  with `five_hour` and `seven_day` windows, `overageStatus: rejected`,
  `isUsingOverage: false` -- these are subscription plan limits, not API
  billing. A `cost` of 0.0695 USD is also reported; Claude Code shows an
  API-equivalent cost even on subscriptions. Still to confirm on the
  claude.ai usage page.
- The model was `claude-opus-5-5`, about 17k context tokens for "Hello".
- The session inherits the developer's Claude Code setup: the
  `AvailableCommandsUpdate` lists the user's skills synced from claude.ai and
  MCP commands. Mentes will need to control that (system prompt, settings,
  tools) so the agent behaves as a chess assistant, not a general one; an
  open design question for the integration, not for the spike.
- **Principle for the integration (developer, 2026-10-05):** Mentes must be
  economical in what it sends. Every request carries the agent's setup
  overhead against the subscription quota, so minimizing context, tools,
  model tier, and number of requests is a first-class design goal.
- Gradle reported deprecated features incompatible with Gradle 10; to check
  with `--warning-mode all` whether they come from our scripts.

## SDK API (0.30.x)

Read from the GitHub tag `v0.30.0` (there is no `v0.30.1` tag; Maven
Central has 0.30.1, published 2026-08-25). The README client example uses
deprecated or removed names (`ClientSupport`, `SessionParameters`,
`createClientSession`); do not follow it.

- Artifact: `com.agentclientprotocol:acp:0.30.1`; Gradle metadata picks the
  JVM variant. Its POM declares coroutines 1.9.0, serialization-json 1.7.3,
  kotlinx-io 0.5.4, kotlin-logging 7.0.0 at runtime scope.
- `StdioTransport(parentScope, ioDispatcher, input: Flow<String>,
  output: suspend (String) -> Unit)` -- one NDJSON line per element; the
  `Source`/`Sink` constructor is deprecated.
- `Protocol(scope, transport)`, then `Client(protocol)`, then
  `protocol.start()` -- the client must exist before start.
- `client.initialize(ClientInfo(...)): AgentInfo`; `AgentInfo.authMethods`
  lists what the agent offers; `client.authenticate(AuthMethodId)` exists.
- `client.newSession(SessionCreationParameters(cwd, mcpServers)) { _, _ ->
  ClientSessionOperations }`.
- `session.prompt(listOf(ContentBlock.Text("Hello"))): Flow<Event>`;
  `Event.SessionUpdateEvent` carries `SessionUpdate.AgentMessageChunk`,
  `Event.PromptResponseEvent` carries the `StopReason`.
- `ClientSessionOperations` needs only `requestPermissions` and `notify`;
  file system and terminal methods default to throwing, which is right as
  long as the capabilities are not advertised.

## Implementation (Step 1)

- `gradle/libs.versions.toml`: add the `kotlinJvm` plugin (same Kotlin
  version), `acp` 0.30.1, `kotlinx-coroutines-core` 1.9.0, and
  `slf4j-simple` so the SDK's kotlin-logging output reaches the console.
- Root `build.gradle.kts`: `kotlinJvm apply false`.
- `settings.gradle.kts`: `include(":acpSpike")`.
- `acpSpike/build.gradle.kts`: `kotlinJvm` + `application`,
  `jvmToolchain(25)`, `mainClass = "io.github.cigizeta.mentes.acpspike.MainKt"`.
- `acpSpike/src/main/kotlin/.../Main.kt`, in `runBlocking`:
  1. Start `npx @agentclientprotocol/claude-agent-acp@0.85.2-preview.19`;
     on `IOException`, print the `PATH` and exit. A daemon thread copies
     the child's stderr to ours.
  2. Use the `Flow<String>` transport: input reads lines from the child's
     stdout on `Dispatchers.IO`; output writes line + `\n` and flushes.
  3. `initialize` with default `ClientCapabilities` (no fs, no terminal) and
     `Implementation("mentes-acp-spike", "0.1.0")`. Print the agent
     implementation and every auth method (id, name, description). Do not
     call `authenticate`: the test is whether the stored claude.ai login is
     used without it.
  4. `newSession` with `cwd` set to a fresh empty temp directory, so the
     agent can see none of the developer's files, and no MCP servers.
  5. Prompt "Hello"; print each `AgentMessageChunk` text without newline,
     flushing; at the end print the stop reason.
  6. `requestPermissions`: select a `REJECT_ONCE` option if offered, else
     `Cancelled`, and log the tool call. `notify`: log the update.
  7. Any exception is printed in full with its stack trace. `finally`:
     close the protocol, destroy the child process.

## Licensing note

The adapter and Claude Code are installed by the user, never bundled with
the GPLv3 release.

## Next actions

1. Review the Implementation section above.
2. Write the module as described.
3. Developer runs `./gradlew :acpSpike:run` and checks the claude.ai usage
   page.
