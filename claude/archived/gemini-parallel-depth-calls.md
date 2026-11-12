Here is a technical summary of the concept and architecture, structured for Claude.

---

# Architecture Proposal: Simulating Streaming Engine Analysis via Aggregated Parallel MCP Calls

### Context & Problem

* **Environment:** A sandboxed UI widget (e.g., an interactive chessboard running in an iframe) communicating with an MCP (Model Context Protocol) server.
* **Objective:** Display progressive Stockfish evaluation updates (evaluation bar, best move arrow, depth progression) as the engine computes.
* **Constraint:** The MCP client bridge and widget environment operate strictly on a discrete request/response model (`tools/call`), without a native server-to-client streaming channel (no direct SSE/WebSocket pipeline into the widget).

---

### Core Concept: Parallel Staged Depth Calls with Server-Side Multiplexing

Instead of firing a single long-running request (which leaves the UI frozen until completion) or sequentially polling depth-by-depth (which introduces round-trip network/IPC serialization latency), the widget fires **multiple depth requests concurrently**.

1. **Client Action:** The widget issues $N$ parallel `tools/call` requests for the same position, each specifying an incremental target depth:

$$\{ \text{depth}: d_1, d_2, \dots, d_n \} \quad \text{for position } P$$

2. **Server-Side Aggregation:** The MCP server detects that incoming requests share the same `(session_id, fen)` tuple and merges them into a **single engine search session**.
3. **Exploiting Iterative Deepening:**
* Stockfish operates via iterative deepening, inherently computing depths $1, 2, \dots, N$ in sequence.
* The server runs a single `go depth N` command on the native Stockfish UCI process.
* As Stockfish emits `info depth d score ... pv ...` lines over standard output, the MCP server resolves the corresponding pending promise for depth $d$.


4. **Client Reception:** From the widget's perspective, responses resolve asynchronously over time at the engine's natural search speed, creating a smooth, progressive UI update stream over a purely pull-based protocol.

---

### System Architecture Flow

```
+--------------------------------------------------------------------+
| Chessboard Widget (Sandbox iframe)                                 |
|                                                                    |
|  Fires simultaneously:                                             |
|   - callTool("eval", { fen, depth: 6 })   ───(Promise 1)           |
|   - callTool("eval", { fen, depth: 10 })  ───(Promise 2)           |
|   - callTool("eval", { fen, depth: 14 })  ───(Promise 3)           |
|   - callTool("eval", { fen, depth: 18 })  ───(Promise 4)           |
+─────────────────────────────────┬──────────────────────────────────+
                                  │ Host Client Bridge (IPC / RPC)
                                  ▼
+--------------------------------------------------------------------+
| MCP Server (Engine Coordinator)                                   |
|                                                                    |
|  1. Incoming Request Deduplicator & Listener Registry               |
|     - Groups calls by position hash (FEN)                          |
|     - Max requested depth = 18                                     |
|                                                                    |
|  2. Single UCI Pipe Controller                                     |
|     - Sends to Stockfish:                                          |
|         position fen <FEN>                                         |
|         go depth 18                                                |
|                                                                    |
|  3. stdout Parser & Promise Dispatcher                             |
|     - info depth 6 ...   ──> Resolves Promise 1 (returns to widget)|
|     - info depth 10 ...  ──> Resolves Promise 2 (returns to widget)|
|     - info depth 14 ...  ──> Resolves Promise 3 (returns to widget)|
|     - info depth 18 ...  ──> Resolves Promise 4 (returns to widget)|
+─────────────────────────────────┬──────────────────────────────────+
                                  │ stdin / stdout
                                  ▼
+--------------------------------------------------------------------+
| Stockfish Binary (Native process)                                  |
| Computes iterative deepening: D1 -> D2 -> ... -> D18               |
+--------------------------------------------------------------------+

```

---

### Implementation Considerations & Guardrails

| Challenge | Mechanism / Resolution |
| --- | --- |
| **Host Bridge Concurrency Limits** | Firing 20 discrete calls simultaneously may trigger client-side message rate limiting or queue serialization. **Mitigation:** Use non-linear stepped depths (e.g., depths 6, 10, 14, 18) to keep in-flight calls between 4 and 6 while still delivering smooth visual feedback. |
| **Race Conditions on Shallow Depths** | Depths 1 through 6 compute in fractions of a millisecond. An engine search might reach depth 8 before the server finishes processing the RPC envelope for depth 4. **Mitigation:** The server maintains an in-memory cache of completed depth lines for the active search session. If a request arrives for a depth the engine has already passed, it resolves immediately against the cache. |
| **Rapid Move Navigation & Stale Data** | If the user moves a piece or navigates move history while calls are pending, old searches become irrelevant. **Mitigation:** |



1. *Client-side:* Tag all requests with a monotonic `generation_id` or `fen_id`; discard any resolving promises from older states.



2. *Server-side:* Upon receiving a request with a new FEN, send `stop` to the UCI pipe, reject/clear dangling callbacks from the previous position, and begin the new search. |

---

### Key Advantages

* **Native Execution Speed:** Keeps Stockfish as a compiled native binary (utilizing AVX2/hardware threads) on the server, avoiding browser WASM thread and `SharedArrayBuffer` sandbox limitations.
* **Zero Protocol Changes:** Requires no WebSockets, SSE sidecars, or modifications to the host application's MCP implementation.
* **Low Server Overhead:** Despite multiple incoming tool calls, compute workload is strictly bounded to one single-threaded or multi-threaded search thread per board.
