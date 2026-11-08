import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { validateFen } from "chess.js";
import { z } from "zod";
import { explorePlayer } from "./explorer.js";
import { loadBook } from "./book.js";
import { logCall, logLine, note, withNote } from "./log.js";
import {
  type GameInfo,
  type Tree,
  type TreeNode,
  type Trees,
  MAX_TREES,
  games,
  getState,
  latest,
  saveState,
  viewers,
} from "./cache.js";
import { checkLichessToken, fetchGame, type Game, GameError, parseGameId, recentGames } from "./lichess.js";

// All analysis runs in the widget: Stockfish.js lite single-threaded
// (WebAssembly). The widget loads it from unpkg; these MCP resources, read
// through claude.ai, are the fallback when unpkg fails. Embedded in the widget it made the HTML 2.7 MB, which
// claude.ai refused; the .wasm goes in base64 pieces about the size of a
// widget that always loaded.
const ENGINE_PIECE = 400 * 1024;
const engineJs = readFileSync(
  createRequire(import.meta.url).resolve("stockfish/bin/stockfish-19-lite-single.js"),
  "utf8",
);
const engineWasm64 = readFileSync(
  createRequire(import.meta.url).resolve("stockfish/bin/stockfish-19-lite-single.wasm"),
).toString("base64");
const enginePieces: string[] = [];
for (let at = 0; at < engineWasm64.length; at += ENGINE_PIECE) {
  enginePieces.push(engineWasm64.slice(at, at + ENGINE_PIECE));
}

// The widget loads the engine from unpkg, which Chrome's HTTP cache keeps
// across chats (claude.ai resets the widget's own storage at each new
// chat); the resources above are its fallback.
const BOARD_CSP = { connectDomains: ["https://unpkg.com"] };

const port = Number(process.env.PORT ?? 8000);
const token = process.env.AIO64_TOKEN ?? "";
if (token.length < 32) {
  console.error("AIO64_TOKEN missing or shorter than 32 characters (see .env.example)");
  process.exit(1);
}
const tokenBuffer = Buffer.from(token);

let boardHtml: string;
try {
  boardHtml = readFileSync(new URL("../dist/board.html", import.meta.url), "utf8");
} catch {
  console.error("dist/board.html missing: run npm run build:widget");
  process.exit(1);
}

const lichessToken = process.env.LICHESS_TOKEN ?? "";
if (!lichessToken) {
  console.error("LICHESS_TOKEN missing (see .env.example)");
  process.exit(1);
}
// The user is the token's owner, never configured separately.
const lichessUser = await checkLichessToken(lichessToken);
console.log(`Lichess token verified: ${lichessUser}, no scopes`);

const book = loadBook(process.env.POLYGLOT_PATH);
console.log(book ? `Polyglot book loaded: ${book.entries} entries` : "No POLYGLOT_PATH: book disabled");

// claude.ai caches widget HTML by URI, so a fixed URI keeps serving a stale
// widget after a rebuild. A content hash in the URI makes every build new.
const boardHash = createHash("sha256").update(boardHtml).digest("hex").slice(0, 8);
const BOARD_URI = `ui://aio64/board-${boardHash}.html`;

function textResult(text: string, isError = false) {
  if (isError) note(`ERROR ${text}`);
  return { isError, content: [{ type: "text" as const, text }] };
}

// Aio64 never changes anything anywhere; every tool says so to the client.
const READ_ONLY = { readOnlyHint: true };

const fenInput = { fen: z.string().describe("FEN of the position") };

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** A finished standard Lichess game, from the cache or from Lichess. */
async function loadGame(input: string): Promise<{ id: string; game: Game }> {
  const id = parseGameId(input);
  let game = games.get(id);
  if (!game) {
    game = await fetchGame(id, lichessToken);
    games.set(id, game);
  }
  return { id, game };
}

function gameInfo(id: string, game: Game): GameInfo {
  const { white, black, whiteRating, blackRating, result, opening } = game;
  return { id, white, black, whiteRating, blackRating, result, opening };
}

/** A new analysis tree: a position with no game. */
function analysisTree(rootFen: string, flipped = false): Tree {
  return { rootFen, root: { children: [] }, path: [], games: {}, flipped };
}

/**
 * A board Claude opens from a position keeps the newest widget's trees and
 * adds an analysis tree as the current one; at MAX_TREES it keeps the trees
 * unchanged, with a notice for the widget.
 */
function withAnalysis(tree: Tree): { trees: Trees; notice?: string } {
  const previous = latest.trees;
  if (!previous) return { trees: { trees: [tree], current: 0 } };
  if (previous.trees.length >= MAX_TREES) {
    return { trees: previous, notice: `${MAX_TREES} trees open: close one to open another.` };
  }
  const trees = [...previous.trees, tree];
  return { trees: { trees, current: trees.length - 1 } };
}

const MAX_NODES = 5000;

function countNodes(node: TreeNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/**
 * The widget payload: the trees and a fresh viewer ID recorded as the
 * newest widget overall. `propose` makes the widget fill the user's message
 * box with the Explain prompt once its analysis reaches depth 20.
 */
function boardResult(text: string, trees: Trees, propose = false, notice?: string) {
  const viewerId = randomUUID();
  viewers.newest = viewerId;
  latest.trees = trees;
  return {
    ...textResult(text),
    structuredContent: { trees, viewerId, propose, notice, book: Boolean(book), user: lichessUser },
  };
}

const gameInfoSchema = z.object({
  id: z.string(),
  white: z.string(),
  black: z.string(),
  whiteRating: z.number().optional(),
  blackRating: z.number().optional(),
  result: z.string(),
  opening: z.string().optional(),
});

const treeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    san: z.string().max(10).optional(),
    children: z.array(treeNodeSchema),
    games: z.array(z.string()).optional(),
    visited: z.number().int().min(0).optional(),
  }),
);

const treeSchema = z.object({
  rootFen: z.string(),
  root: treeNodeSchema,
  path: z.array(z.number().int().min(0)),
  games: z.record(gameInfoSchema),
  mainGame: z.string().optional(),
  flipped: z.boolean().default(false),
});

const treesSchema = z
  .object({
    trees: z.array(treeSchema).min(1).max(MAX_TREES),
    current: z.number().int().min(0),
  })
  .refine((t) => t.current < t.trees.length, "current out of range");

/** Parses a widget's trees from JSON; an error text if invalid or too large. */
function parseTrees(state: string): Trees | string {
  let parsed: Trees;
  try {
    parsed = treesSchema.parse(JSON.parse(state));
  } catch {
    return "Invalid board state";
  }
  const nodes = parsed.trees.reduce((sum, tree) => sum + countNodes(tree.root), 0);
  if (nodes > MAX_NODES) return `Trees larger than ${MAX_NODES} moves`;
  return parsed;
}

// X-Api-Key, not Authorization, so that Authorization stays free for OAuth
// later. The claude.ai connector form offers only predefined header names,
// and X-Api-Key is the non-Authorization one; it sends it on every request.
function authorized(req: IncomingMessage): boolean {
  const value = req.headers["x-api-key"];
  if (typeof value !== "string") return false;
  const given = Buffer.from(value);
  return given.length === tokenBuffer.length && timingSafeEqual(given, tokenBuffer);
}

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "aio64", version: "0.1.1" });

  registerAppResource(
    server,
    "board",
    BOARD_URI,
    { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { csp: BOARD_CSP } } },
    async () => {
      note(`${Math.round(boardHtml.length / 1024)} kB`);
      return { contents: [{ uri: BOARD_URI, mimeType: RESOURCE_MIME_TYPE, text: boardHtml, _meta: { ui: { csp: BOARD_CSP } } }] };
    },
  );

  // The browser engine: the manifest, the loader, then the .wasm pieces.
  server.registerResource(
    "engine-manifest",
    "ui://aio64/engine/manifest.json",
    { mimeType: "application/json" },
    async (uri) => {
      note(`${enginePieces.length} pieces`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ pieces: enginePieces.length }) }] };
    },
  );
  server.registerResource("engine-js", "ui://aio64/engine/engine.js", { mimeType: "text/javascript" }, async (uri) => {
    note(`${Math.round(engineJs.length / 1024)} kB`);
    return { contents: [{ uri: uri.href, mimeType: "text/javascript", text: engineJs }] };
  });
  enginePieces.forEach((piece, i) => {
    server.registerResource(`engine-wasm-${i}`, `ui://aio64/engine/wasm-${i}.b64`, { mimeType: "text/plain" }, async (uri) => {
      note(`piece ${i}, ${Math.round(piece.length / 1024)} kB`);
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: piece }] };
    });
  });

  registerAppTool(
    server,
    "explain_position",
    {
      description:
        "Show a chess position (FEN) on a board for you to explain it in plain language. Stockfish analyzes it in the widget, which then proposes the explanation prompt to the user.",
      inputSchema: fenInput,
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: BOARD_URI } },
    },
    async ({ fen }) => {
      const check = validateFen(fen);
      if (!check.ok) return textResult(check.error ?? "Invalid FEN", true);
      const { trees, notice } = withAnalysis(analysisTree(fen));
      return boardResult(
        "Board opened at the position. Stockfish analyzes it in the widget, which will propose the explanation prompt; wait for it.",
        trees,
        !notice,
        notice,
      );
    },
  );


  // Older widgets ask this to learn they were superseded and collapse;
  // hidden from Claude's tool list.
  registerAppTool(
    server,
    "viewer_status",
    {
      description: "Whether a board widget is still the newest one.",
      inputSchema: { viewerId: z.string() },
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: BOARD_URI, visibility: ["app"] } },
    },
    async ({ viewerId }) => {
      const newest = viewers.newest === viewerId;
      return { ...textResult(newest ? "newest" : "superseded"), structuredContent: { newest } };
    },
  );

  // Explain stores the widget state here so that Claude reopens the board
  // below its answer with a short ID instead of the whole state. Memory
  // only; hidden from Claude's tool list.
  registerAppTool(
    server,
    "save_board",
    {
      description: "Store a board widget's state; returns a short ID.",
      // The tree is recursive, so it travels as a JSON string and is
      // validated here, rather than as a recursive tool input schema.
      inputSchema: { state: z.string().max(1_000_000) },
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: BOARD_URI, visibility: ["app"] } },
    },
    async ({ state }) => {
      const parsed = parseTrees(state);
      if (typeof parsed === "string") return textResult(parsed, true);
      const id = randomUUID().slice(0, 8);
      saveState(id, parsed);
      return { ...textResult(id), structuredContent: { id } };
    },
  );

  // The newest widget reports its trees here (debounced), so that a board
  // Claude opens next carries them over. Reports from superseded widgets
  // are ignored. Server memory only, so read-only like save_board; hidden
  // from Claude's tool list.
  registerAppTool(
    server,
    "report_trees",
    {
      description: "Report the newest board widget's trees.",
      inputSchema: { viewerId: z.string(), state: z.string().max(1_000_000) },
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: BOARD_URI, visibility: ["app"] } },
    },
    async ({ viewerId, state }) => {
      if (viewers.newest !== viewerId) return textResult("superseded");
      const parsed = parseTrees(state);
      if (typeof parsed === "string") return textResult(parsed, true);
      latest.trees = parsed;
      return textResult("reported");
    },
  );

  // The explorer panel: the token owner's own games from the current
  // position (player database only). Always the token's owner, never a player
  // chosen in the widget. Results go to the widget, never to Claude;
  // hidden from Claude's tool list.
  registerAppTool(
    server,
    "explore_position",
    {
      description: "The user's own moves and recent games from a position.",
      inputSchema: {
        color: z.enum(["white", "black"]),
        fen: z.string(),
      },
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: BOARD_URI, visibility: ["app"] } },
    },
    async ({ color, fen }) => {
      const check = validateFen(fen);
      if (!check.ok) return textResult(check.error ?? "Invalid FEN", true);
      try {
        const exploration = await explorePlayer(lichessUser, color, fen, lichessToken);
        return { ...textResult(`${exploration.moves.length} moves`), structuredContent: { ...exploration } };
      } catch (error) {
        if (error instanceof GameError) return textResult(error.message, true);
        return textResult(`Lichess error: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    },
  );

  // The Explorer's Book source: the local Polyglot book's moves, with
  // their share of the book's weight. Registered only when a book is
  // configured; hidden from Claude.
  if (book) {
    registerAppTool(
      server,
      "book_moves",
      {
        description: "The opening book's moves from a position.",
        inputSchema: fenInput,
        annotations: READ_ONLY,
        _meta: { ui: { resourceUri: BOARD_URI, visibility: ["app"] } },
      },
      async ({ fen }) => {
        const check = validateFen(fen);
        if (!check.ok) return textResult(check.error ?? "Invalid FEN", true);
        const moves = book.moves(fen);
        return { ...textResult(`${moves.length} book moves`), structuredContent: { moves } };
      },
    );
  }

  // The Games tab: the token owner's last finished games, to review them right
  // after playing. Results go to the widget only; hidden from Claude.
  registerAppTool(
    server,
    "recent_games",
    {
      description: "The user's last finished games, newest first.",
      inputSchema: {},
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: BOARD_URI, visibility: ["app"] } },
    },
    async () => {
      try {
        const list = await recentGames(lichessUser, lichessToken);
        return { ...textResult(`${list.length} games`), structuredContent: { games: list } };
      } catch (error) {
        if (error instanceof GameError) return textResult(error.message, true);
        return textResult(`Lichess error: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    },
  );

  // A game found by the explorer; the widget joins its line into the tree.
  // Same checks as open_board (finished games only); hidden from Claude's
  // tool list.
  registerAppTool(
    server,
    "load_game",
    {
      description: "A finished game's start position and moves.",
      inputSchema: { game: z.string() },
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: BOARD_URI, visibility: ["app"] } },
    },
    async ({ game }) => {
      try {
        const { id, game: loaded } = await loadGame(game);
        return {
          ...textResult("Game loaded."),
          structuredContent: {
            game: gameInfo(id, loaded),
            startFen: loaded.initialFen ?? START_FEN,
            moves: loaded.moves,
          },
        };
      } catch (error) {
        if (error instanceof GameError) return textResult(error.message, true);
        return textResult(`Lichess error: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    },
  );

  registerAppTool(
    server,
    "open_board",
    {
      description:
        "Open an interactive chess board at a position (FEN) or the start, to explore the user's own games and review their recent ones.",
      inputSchema: {
        fen: z.string().optional().describe("Position to show"),
        color: z.enum(["white", "black"]).optional().describe("Side at the bottom; the explorer shows the user's games with it"),
        state: z.string().optional().describe("Saved board ID, to reopen"),
      },
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: BOARD_URI } },
    },
    async ({ fen, color, state }) => {
      if (state) {
        const saved = getState(state);
        if (saved) return boardResult("Board reopened.", saved);
        const fallback = withAnalysis(analysisTree(START_FEN));
        return boardResult("Saved board not found; opened at the start.", fallback.trees, false, fallback.notice);
      }

      if (fen) {
        const check = validateFen(fen);
        if (!check.ok) return textResult(check.error ?? "Invalid FEN", true);
      }
      // An analysis tree has no game, so White is at the bottom unless flipped.
      const { trees, notice } = withAnalysis(analysisTree(fen ?? START_FEN, color === "black"));
      return boardResult(notice ? `Board opened; no new tree (${MAX_TREES} open).` : "Board opened.", trees, false, notice);
    },
  );

  return server;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

// What the request log shows of a request: the tool called, "tools/list"
// (claude.ai reading the tool list, i.e. a reconnect), or nothing for the
// rest of the protocol. Arguments are never logged.
function loggedAs(body: unknown): string | undefined {
  const messages = Array.isArray(body) ? body : [body];
  for (const m of messages) {
    const { method, params } = (m ?? {}) as { method?: unknown; params?: { name?: unknown } };
    if (method === "tools/list") return "tools/list";
    // The widget's HTML: worth seeing, since claude.ai may refuse a large one.
    if (method === "resources/read") return "resources/read";
    // The widget's frequent "am I still the newest?" check is noise.
    if (method === "tools/call" && typeof params?.name === "string" && params.name !== "viewer_status") {
      return params.name;
    }
  }
  return undefined;
}

function finish(res: ServerResponse, status: number): void {
  res.writeHead(status).end();
}

// Stateless Streamable HTTP: a fresh MCP server per POST, no session IDs,
// so a server restart is invisible to Claude.
async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    finish(res, 400);
    return;
  }
  const tool = loggedAs(body);
  const started = Date.now();
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const handled = withNote(async () => {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
    if (tool === "tools/list") logLine("claude.ai read the tool list (reconnected)");
    else if (tool) logCall(tool, Date.now() - started, handled.note());
  });
  await handled.result;
}

const httpServer = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path !== "/mcp") return finish(res, 404);
  if (!authorized(req)) {
    logLine("REJECTED a request without a valid X-Api-Key (401)");
    return finish(res, 401);
  }
  if (req.method !== "POST") return finish(res, 405);

  handleMcp(req, res).catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) finish(res, 500);
  });
});

httpServer.listen(port, () =>
  console.log(`Aio64 listening on http://localhost:${port}/mcp (widget ${BOARD_URI})`),
);

process.on("SIGINT", () => process.exit(0));
