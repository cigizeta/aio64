# Architecture Summary: In-Browser Chess Analysis with Stockfish HCE for Claude.ai

## 1. Problem Statement & Sandbox Constraints

Integrating an interactive chess engine into a Claude.ai Artifact introduces specific platform and security limitations:

* **Iframe Isolation & CSP:** Claude.ai renders Artifacts inside an isolated `iframe` (`claudeusercontent.com`) under a `null` origin. Dynamic outbound connections (`fetch`, `WebSocket`, `EventSource`) to arbitrary backends or local tunnels (such as ngrok) are blocked by the host `connect-src` Content Security Policy (CSP).
* **Storage Non-Persistence:** `localStorage` and `IndexedDB` do not persist predictably across artifact re-renders or new sessions due to origin resets.
* **Failure Mode of Modern NNUE:** Modern Stockfish builds (v12+) separate the engine logic (`.wasm`) from neural network weights (`.nnue`, ~40–90 MB). These builds require secondary dynamic network fetches and `SharedArrayBuffer` threading support, both of which fail inside the artifact sandbox.
* **Token Budget Limits:** Embedding complete engine binaries directly into prompts or artifact code as Base64 strings consumes hundreds of kilobytes of model context per turn.

---

## 2. Solution: Classical HCE via Trusted CDN

The solution uses a **Handcrafted Evaluation (HCE)** engine—specifically **Stockfish 10** (or pure ASM.js builds of Stockfish 11):

* **Single-File Distribution:** The entire engine is compiled into a single JavaScript file (`stockfish.js`, ~1.4 MB uncompressed, ~250 KB gzipped) containing all evaluation tables and search logic. No secondary `.wasm` or `.nnue` files are fetched.
* **Tactical Accuracy:** Delivers ~3200 Elo playing strength, providing grandmaster-level tactical analysis, blunder detection, and line calculation.
* **Whitelisted Delivery:** Hosted on trusted public CDNs (Cloudflare `cdnjs` / `jsDelivr`) that are permitted under Claude’s script whitelist.

---

## 3. Browser Disk Caching Across Chats

While the iframe’s memory and local client databases are ephemeral, **Chromium's HTTP disk cache operates at the browser network layer**:

1. **Cache Headers:** The CDN serves the static file with immutable caching headers:
```http
Cache-Control: public, max-age=31536000, immutable

```


2. **Cache Partitioning Key:** Modern Chrome partitions HTTP cache storage by:

$$\{\text{Top-level site: } \texttt{claude.ai},\ \text{Frame site: } \texttt{claudeusercontent.com},\ \text{Resource URL}\}$$

Because all chats within Claude.ai share the exact same top-level and frame domains, the engine binary is downloaded **exactly once**.
3. **Subsequent Sessions:** Starting a new chat, refreshing the tab, or switching conversations loads the 1.4 MB engine file directly from your local SSD (`(disk cache)`) in roughly **5–15 ms** with zero bytes transferred across the network.

---

## 4. Complete Implementation Template

Because browsers block cross-origin Web Worker instantiation (`new Worker("https://cdn...")`), the script is fetched using `cache: "force-cache"` and converted into a same-origin **Blob Worker**:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Stockfish 10 HCE Widget</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 16px;
      color: #1a1a1a;
    }
    #status {
      font-weight: 600;
      margin-bottom: 8px;
    }
    #eval-bar {
      font-family: monospace;
      padding: 8px 12px;
      background: #f3f4f6;
      border-radius: 6px;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div id="status">Initializing engine...</div>
  <div id="eval-bar">Depth: 0 | Score: 0.00 | Best: --</div>

  <script>
    // Trusted CDN URL on Claude.ai whitelist (Stockfish 10 HCE, pure JS)
    const ENGINE_URL = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";
    let engine = null;

    async function initEngine() {
      try {
        // 1. Fetch using force-cache (pulls from SSD disk cache after turn 1)
        const response = await fetch(ENGINE_URL, {
          cache: "force-cache",
          mode: "cors"
        });
        const scriptContent = await response.text();

        // 2. Wrap into an inline Blob Worker to bypass cross-origin restrictions
        const blob = new Blob([scriptContent], { type: "application/javascript" });
        engine = new Worker(URL.createObjectURL(blob));

        // 3. Handle continuous UCI output stream
        engine.onmessage = function(event) {
          const line = typeof event === "object" ? event.data : event;
          if (typeof line === "string") {
            parseUciOutput(line);
          }
        };

        // 4. Send standard UCI boot commands
        engine.postMessage("uci");
        engine.postMessage("ucinewgame");
        engine.postMessage("isready");

        document.getElementById("status").innerText = "Stockfish 10 HCE Ready";
      } catch (err) {
        document.getElementById("status").innerText = "Failed to load engine: " + err.message;
      }
    }

    function evaluatePosition(fen) {
      if (!engine) return;
      engine.postMessage("stop");
      engine.postMessage("position fen " + fen);
      engine.postMessage("go depth 18");
    }

    function parseUciOutput(line) {
      if (!line.startsWith("info depth")) return;

      const depthMatch = line.match(/depth (\d+)/);
      const cpMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      const pvMatch = line.match(/ pv (\w+)/);

      let formattedScore = "0.00";
      if (mateMatch) {
        formattedScore = `Mate in ${mateMatch[1]}`;
      } else if (cpMatch) {
        const pawns = (parseInt(cpMatch[1], 10) / 100).toFixed(2);
        formattedScore = (pawns > 0 ? "+" : "") + pawns;
      }

      const depth = depthMatch ? depthMatch[1] : "-";
      const bestMove = pvMatch ? pvMatch[1] : "--";

      document.getElementById("eval-bar").innerText =
        `Depth: ${depth} | Score: ${formattedScore} | Best Move: ${bestMove}`;
    }

    // Start initialization
    initEngine();
  </script>
</body>
</html>

```

---

## 5. Architectural Trade-offs

| Feature | In-Browser Stockfish 10 (HCE) | Native NNUE over Backend Tunnel |
| --- | --- | --- |
| **Sandbox Compliance** | 100% self-contained in Claude.ai. | Requires public HTTPS tunnel, blocked by Artifact CSP. |
| **Token / Prompt Overhead** | Single CDN link; zero binary payload in prompt. | Zero prompt payload, but requires active tunnel session. |
| **Network Overhead** | 1.4 MB once; 0 B subsequently via disk cache. | Continuous HTTP / SSE polling overhead. |
| **Tactical Strength** | ~3200 Elo (HCE heuristics). | ~3550+ Elo (NNUE weights). |
| **Depth Scalability** | Synchronous, local Worker events at 60 FPS. | Dependent on network latency and serialization rate. |
