import type { App } from "@modelcontextprotocol/ext-apps";
import { normalizeMove } from "chessops/chess";
import { makeSanAndPlay } from "chessops/san";
import { parseUci } from "chessops/util";
import { position, positionKey } from "./tree.js";

/**
 * Stockfish.js 19 lite single-threaded (WebAssembly), running in the widget:
 * all of Aio64's analysis. Infinite analysis of the position on screen,
 * MultiPV 3, one thread (the build's only mode), 16 MB hash kept between
 * positions (stepping
 * through a game reuses earlier work). Each completed depth is reported at
 * once: no server round trip.
 *
 * The engine is not embedded in the widget (a 2.7 MB widget was refused by
 * claude.ai). It comes from unpkg, pinned to the installed version: Chrome's
 * HTTP cache keeps it across chats and browser restarts (about 0.1 s
 * cached, 0.9 s the first time), where claude.ai resets the widget's own
 * storage at each new chat. If unpkg fails, the engine is read from the
 * server as MCP resources (a manifest, the loader, the .wasm in base64
 * pieces), about ten times slower through claude.ai and the tunnel.
 */

/** The installed stockfish package's version, set by the Vite build. */
declare const __STOCKFISH_VERSION__: string;

const LINES = 3;
const MAX_PLIES = 8;

export interface EngineLine {
  /** White's point of view: "+0.31", "-1.20", "#3", "#-3". */
  eval: string;
  /** Numbered SAN: "12...Nf6 13.Bg5 Be7". */
  san: string;
}

export interface Analysis {
  depth: number;
  lines: EngineLine[];
  /** Mate or stalemate on the board: the result, no lines. */
  over?: string;
}

interface RawLine {
  depth: number;
  kind: "cp" | "mate";
  value: number;
  pv: string[];
}

let worker: Worker | undefined;
let ready = false;
let failed: string | undefined;
let searching = false;
let stopping = false;
/** The position wanted on screen. */
let fen: string | undefined;
/** The position the running search is about. */
let searchFen: string | undefined;
let expected = LINES;
let raw = new Map<number, RawLine>();
let reported = 0;
let onAnalysis: (fen: string, analysis: Analysis) => void = () => undefined;
let onStatus: (text: string) => void = () => undefined;

async function readText(app: App, uri: string): Promise<string> {
  const result = await app.readServerResource({ uri });
  const content = result.contents[0] as { text?: string } | undefined;
  if (typeof content?.text !== "string") throw new Error(`no text in ${uri}`);
  return content.text;
}

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// unpkg, not jsDelivr: jsDelivr refuses the stockfish package (over its
// 150 MB per-package limit, the full builds' nets included). The loader
// fetches the .wasm itself (instantiateStreaming), from the URL in its
// fragment, so both files stay in the HTTP cache and Chrome may keep the
// compiled module too. A Worker cannot start from a cross-origin URL, so
// the loader is fetched and run as a blob:.
const CDN = `https://unpkg.com/stockfish@${__STOCKFISH_VERSION__}/bin/stockfish-19-lite-single`;
const CDN_TIMEOUT = 20_000;

/** Resolves once the CDN engine answers uciok; rejects on any failure. */
async function startFromCdn(): Promise<Worker> {
  const response = await fetch(`${CDN}.js`);
  if (!response.ok) throw new Error(`CDN ${response.status}`);
  const jsUrl = URL.createObjectURL(new Blob([await response.text()], { type: "text/javascript" }));
  const candidate = new Worker(`${jsUrl}#${encodeURIComponent(`${CDN}.wasm`)}`);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDN engine timeout")), CDN_TIMEOUT);
      candidate.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(event.message || "CDN engine error"));
      };
      candidate.onmessage = (event: MessageEvent) => {
        if (String(event.data) !== "uciok") return;
        clearTimeout(timer);
        resolve();
      };
      candidate.postMessage("uci");
    });
    return candidate;
  } catch (error) {
    candidate.terminate();
    throw error;
  }
}

/** Downloads and starts the engine; status texts until it is ready. */
export async function startEngine(
  app: App,
  handlers: { analysis: (fen: string, analysis: Analysis) => void; status: (text: string) => void },
): Promise<void> {
  onAnalysis = handlers.analysis;
  onStatus = handlers.status;
  onStatus("loading engine...");
  try {
    worker = await startFromCdn();
    worker.onerror = (event) => fail(`engine error: ${event.message || "unknown"}`);
    worker.onmessage = (event: MessageEvent) => receive(String(event.data));
    receive("uciok");
    return;
  } catch (error) {
    console.warn("aio64: CDN engine failed, falling back to the server", error);
  }
  try {
    const { pieces } = JSON.parse(await readText(app, "ui://aio64/engine/manifest.json")) as { pieces: number };
    const js = await readText(app, "ui://aio64/engine/engine.js");
    const parts: string[] = [];
    for (let i = 0; i < pieces; i++) {
      onStatus(`loading engine ${i + 1}/${pieces}...`);
      parts.push(await readText(app, `ui://aio64/engine/wasm-${i}.b64`));
    }
    // The loader takes its .wasm address from the worker URL's fragment, so
    // both become blob: URLs.
    const wasmUrl = URL.createObjectURL(new Blob([decode(parts.join(""))], { type: "application/wasm" }));
    const jsUrl = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
    worker = new Worker(`${jsUrl}#${encodeURIComponent(wasmUrl)}`);
  } catch (error) {
    fail(`engine unavailable: ${errorText(error)}`);
    return;
  }
  worker.onerror = (event) => fail(`engine error: ${event.message || "unknown"}`);
  worker.onmessage = (event: MessageEvent) => receive(String(event.data));
  send("uci");
}

/**
 * Analyzes a position until another one is asked for (infinite). A running
 * search is stopped first, and the next one starts only after its
 * `bestmove`: the single-threaded engine crashed ("RuntimeError:
 * unreachable") when a new search was sent while the old one was still
 * unwinding. Positions asked for meanwhile only replace the pending one.
 */
export function analyzePosition(next: string): void {
  fen = next;
  if (!ready) return;
  if (searching) {
    if (!stopping) {
      send("stop");
      stopping = true;
    }
    return;
  }
  start(next);
}

function start(next: string): void {
  searchFen = next;
  raw = new Map();
  reported = 0;
  const pos = position(next);
  if (pos.isEnd()) {
    searching = false;
    const outcome = pos.outcome();
    const over = outcome?.winner
      ? `Checkmate: ${outcome.winner === "white" ? "White" : "Black"} wins.`
      : pos.isStalemate()
        ? "Stalemate."
        : "Draw.";
    onAnalysis(next, { depth: 0, lines: [], over });
    return;
  }
  let moves = 0;
  for (const [, to] of pos.allDests()) moves += to.size();
  expected = Math.min(LINES, moves);
  send(`position fen ${next}`);
  send("go infinite");
  searching = true;
}

/** A superseded widget stops computing. */
export function stopEngine(): void {
  worker?.terminate();
  worker = undefined;
  ready = false;
}

export function engineFailure(): string | undefined {
  return failed;
}

function fail(text: string): void {
  failed = text;
  onStatus(text);
}

function send(command: string): void {
  worker?.postMessage(command);
}

function receive(line: string): void {
  if (line === "uciok") {
    // No "setoption name Threads": this build has no threads compiled in
    // (it is always one thread).
    send("setoption name Hash value 16");
    send(`setoption name MultiPV value ${LINES}`);
    send("isready");
    return;
  }
  if (line === "readyok" && !ready) {
    ready = true;
    onStatus("");
    if (fen) analyzePosition(fen);
    return;
  }
  if (line.startsWith("bestmove")) {
    // The stopped search has ended: start the position now wanted.
    searching = false;
    stopping = false;
    if (fen) start(fen);
    return;
  }
  const at = searchFen;
  if (stopping || !at || !line.startsWith("info ")) return;
  const parsed = parseInfo(line);
  if (!parsed) return;
  raw.set(parsed.multipv, parsed.line);
  // A depth is complete when every expected line has reached it.
  const depths = [...Array(expected).keys()].map((i) => raw.get(i + 1)?.depth ?? 0);
  const complete = Math.min(...depths);
  if (complete > reported) {
    reported = complete;
    onAnalysis(at, { depth: complete, lines: format(at, complete) });
  }
}

function parseInfo(line: string): { multipv: number; line: RawLine } | undefined {
  const tokens = line.split(" ");
  // Bound scores come from aspiration-window fail-highs/lows, not final values.
  if (tokens.includes("lowerbound") || tokens.includes("upperbound")) return undefined;
  const pvAt = tokens.indexOf("pv");
  const scoreAt = tokens.indexOf("score");
  const depthAt = tokens.indexOf("depth");
  if (pvAt < 0 || scoreAt < 0 || depthAt < 0) return undefined;
  const kind = tokens[scoreAt + 1];
  if (kind !== "cp" && kind !== "mate") return undefined;
  const multipvAt = tokens.indexOf("multipv");
  return {
    multipv: multipvAt < 0 ? 1 : Number(tokens[multipvAt + 1]),
    line: { depth: Number(tokens[depthAt + 1]), kind, value: Number(tokens[scoreAt + 2]), pv: tokens.slice(pvAt + 1) },
  };
}

function format(at: string, depth: number): EngineLine[] {
  const whiteToMove = at.split(" ")[1] === "w";
  const lines: EngineLine[] = [];
  for (let i = 1; i <= expected; i++) {
    const line = raw.get(i);
    if (!line || line.depth < depth) continue;
    const value = whiteToMove ? line.value : -line.value;
    const score = line.kind === "mate" ? `#${value}` : `${value >= 0 ? "+" : ""}${(value / 100).toFixed(2)}`;
    lines.push({ eval: score, san: numberedSan(at, line.pv) });
  }
  return lines;
}

function numberedSan(at: string, pv: string[]): string {
  const pos = position(at);
  const parts: string[] = [];
  for (const uci of pv.slice(0, MAX_PLIES)) {
    const parsed = parseUci(uci);
    // Stockfish writes castling as e1g1; chessops wants king takes rook.
    const move = parsed && normalizeMove(pos, parsed);
    if (!move || !pos.isLegal(move)) break;
    const white = pos.turn === "white";
    const number = pos.fullmoves;
    const san = makeSanAndPlay(pos, move);
    if (white) parts.push(`${number}.${san}`);
    else parts.push(parts.length === 0 ? `${number}...${san}` : san);
  }
  return parts.join(" ");
}

/** Same position, whatever the move counters. */
export function samePosition(a: string, b: string): boolean {
  return positionKey(a) === positionKey(b);
}
