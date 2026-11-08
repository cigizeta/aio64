import { App } from "@modelcontextprotocol/ext-apps";
import { Chessground } from "@lichess-org/chessground";
import type { Key } from "@lichess-org/chessground/types";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import {
  addOrFollow,
  dests,
  makeMainLine,
  plyOf,
  position,
  positionKey,
  sanOf,
  type Step,
  type TreeNode,
  walk,
} from "./tree.js";
import { type Analysis, analyzePosition, engineFailure, startEngine, stopEngine } from "./engine.js";

interface GameInfo {
  id: string;
  white: string;
  black: string;
  whiteRating?: number;
  blackRating?: number;
  result: string;
}

/** Mirrors the server's Tree: one game (played or analysis) with variations. */
interface Tree {
  rootFen: string;
  root: TreeNode;
  path: number[];
  games: Record<string, GameInfo>;
  /** Set on a played-game tree: the game it holds. */
  mainGame?: string;
  flipped: boolean;
}

/** Mirrors the server's Trees; saved as is for the re-show loop. */
interface Trees {
  trees: Tree[];
  current: number;
}

const MAX_TREES = 10;
const TREES_FULL = `${MAX_TREES} trees open: close one to open another.`;

interface BoardPayload {
  trees?: Trees;
  viewerId?: string;
  /** From explain_position: propose the Explain prompt at depth 20. */
  propose?: boolean;
  /** Shown in the status line, e.g. when no tree could be added. */
  notice?: string;
  /** Whether the server has a Polyglot book (the Explorer's Book source). */
  book?: boolean;
  /** The Lichess token's owner, the only player the Explorer and Games tabs show. */
  user?: string;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id} element`);
  return element as T;
}

const viewerParts = ["tree-row", "board", "controls", "analysis", "tabs", "explorer-source", "moves", "explorer", "games"].map(
  (id) => byId(id),
);
const gamesPanel = byId("games");
const gamesStatus = byId("games-status");
const gamesList = byId("games-list");
const tabGames = byId<HTMLButtonElement>("tab-games");
const treeSelect = byId<HTMLSelectElement>("tree-select");
const treeCount = byId("tree-count");
const closeTree = byId<HTMLButtonElement>("close-tree");
const collapsed = byId("collapsed");
const movesPanel = byId("moves");
const explorerPanel = byId("explorer");
const tabMoves = byId<HTMLButtonElement>("tab-moves");
const tabExplorer = byId<HTMLButtonElement>("tab-explorer");
const asSide = byId<HTMLButtonElement>("as-side");
const explorerStatus = byId("explorer-status");
const explorerMoves = byId("explorer-moves");
const explorerGames = byId("explorer-games");
const explorerSource = byId("explorer-source");
const sourceBook = byId<HTMLButtonElement>("source-book");
const bookMoves = byId("book-moves");
const buttons = {
  first: byId<HTMLButtonElement>("first"),
  back: byId<HTMLButtonElement>("back"),
  forward: byId<HTMLButtonElement>("forward"),
  last: byId<HTMLButtonElement>("last"),
  explain: byId<HTMLButtonElement>("explain"),
  mainline: byId<HTMLButtonElement>("mainline"),
  flip: byId<HTMLButtonElement>("flip"),
};

// Widget state. Analyses are keyed by position (pieces, side to move,
// castling), so they stay valid wherever the position appears, in any tree.
// `state` is the current tree, the same object as trees.trees[current].
let trees: Trees | undefined;
let state: Tree | undefined;
let steps: Step[] = [];
let busy = false;
let notice = "";
let viewerId: string | undefined;
let stale = false;
/** The deepest browser analysis of each position (by position key). */
const explained = new Map<string, Analysis>();

// On phones and tablets dragging is awkward: tap the piece, then the square.
// The primary pointer, unlike Chessground's 'ontouchstart' check, keeps
// dragging on touchscreen laptops used with a mouse.
const touchFirst = matchMedia("(pointer: coarse)").matches;

const board = Chessground(byId("board"), {
  coordinates: false,
  orientation: "white",
  draggable: { enabled: !touchFirst },
  movable: { free: false, color: "both", showDests: true, events: { after: (orig, dest) => onBoardMove(orig, dest) } },
});

function currentStep(): Step {
  return steps[steps.length - 1];
}

function rated(name: string, rating?: number): string {
  return rating ? `${name} (${rating})` : name;
}

/** The Lichess token's owner, sent by the server with every board. */
let user = "";

// A played-game tree's game; an analysis tree has none.
function gameOf(tree: Tree | undefined): GameInfo | undefined {
  return tree?.mainGame ? tree.games[tree.mainGame] : undefined;
}

function mainGame(): GameInfo | undefined {
  return gameOf(state);
}

function gameLabel(game: GameInfo | undefined): string {
  return game ? `${rated(game.white, game.whiteRating)} vs ${rated(game.black, game.blackRating)}, ${game.result}` : "";
}

function mainLabel(): string {
  return gameLabel(mainGame());
}

// Tree selector: played-game trees by their game, analysis trees numbered
// in order ("Analysis 1", "Analysis 2").
function renderSelector(): void {
  if (!trees) return;
  let analyses = 0;
  treeSelect.replaceChildren(
    ...trees.trees.map((tree, i) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = gameLabel(gameOf(tree)) || `Analysis ${++analyses}`;
      return option;
    }),
  );
  treeSelect.value = String(trees.current);
  treeCount.textContent = `(${trees.trees.length})`;
  closeTree.disabled = stale || trees.trees.length <= 1;
}

function switchTree(index: number): void {
  if (!trees || stale || index < 0 || index >= trees.trees.length) return;
  void stillNewest();
  trees.current = index;
  state = trees.trees[index];
  setPath(state.path);
}

/** Adds a tree and makes it current; false (nothing changes) at the cap. */
function addTree(tree: Tree): boolean {
  if (!trees || trees.trees.length >= MAX_TREES) return false;
  trees.trees.push(tree);
  trees.current = trees.trees.length - 1;
  state = tree;
  return true;
}

treeSelect.addEventListener("change", () => switchTree(Number(treeSelect.value)));

// The last tree cannot be closed (the button is disabled then).
closeTree.addEventListener("click", () => {
  if (!trees || stale || trees.trees.length <= 1) return;
  trees.trees.splice(trees.current, 1);
  switchTree(Math.min(trees.current, trees.trees.length - 1));
});

// The newest widget reports its trees to the server (memory only), so that
// a board Claude opens next carries them over. Debounced; stale widgets
// never report.
let reportTimer: ReturnType<typeof setTimeout> | undefined;

function reportTrees(): void {
  clearTimeout(reportTimer);
  if (stale || !viewerId) return;
  reportTimer = setTimeout(() => {
    if (stale || !trees || !viewerId) return;
    void app
      .callServerTool({ name: "report_trees", arguments: { viewerId, state: JSON.stringify(trees) } })
      .catch(() => undefined);
  }, 1000);
}

// Black at the bottom when the user played Black in the tree's game, White
// otherwise; the manual flip reverses it.
function orientation(): "white" | "black" {
  const game = mainGame();
  const base = game && game.black.toLowerCase() === user.toLowerCase() ? "black" : "white";
  return state?.flipped ? (base === "white" ? "black" : "white") : base;
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Moves tab: the tree as PGN text, variations in parentheses, every move
// clickable. No game tags in the text: the tree selector names the tree's
// game.
function renderMoves(): void {
  if (!state) return;
  const rootPos = position(state.rootFen);
  const rootOffset = rootPos.turn === "white" ? 0 : 1;
  const rootFull = rootPos.fullmoves;
  let currentElement: HTMLElement | undefined;

  const appendMove = (into: HTMLElement, node: TreeNode, path: number[], depth: number, force: boolean) => {
    const ply = depth + rootOffset;
    const number = rootFull + Math.floor(ply / 2);
    const white = ply % 2 === 0;
    const span = document.createElement("span");
    span.className = "move";
    span.textContent = white ? `${number}.${node.san}` : force ? `${number}...${node.san}` : `${node.san}`;
    if (samePath(path, state!.path)) {
      span.classList.add("current");
      currentElement = span;
    }
    span.addEventListener("click", () => navigateTo(path));
    into.append(span, " ");
  };

  const renderLine = (into: HTMLElement, from: TreeNode, fromPath: number[], depth: number, forceFirst: boolean) => {
    let node = from;
    let path = fromPath;
    let d = depth;
    let force = forceFirst;
    while (node.children.length) {
      const [main, ...alternatives] = node.children;
      appendMove(into, main, [...path, 0], d, force);
      force = false;
      alternatives.forEach((alternative, k) => {
        const variation = document.createElement("span");
        variation.className = "variation";
        variation.append("( ");
        const altPath = [...path, k + 1];
        appendMove(variation, alternative, altPath, d, true);
        renderLine(variation, alternative, altPath, d + 1, false);
        variation.append(") ");
        into.append(variation);
      });
      if (alternatives.length) force = true;
      node = main;
      path = [...path, 0];
      d++;
    }
  };

  movesPanel.replaceChildren();
  renderLine(movesPanel, state.root, [], 0, true);
  if (!state.root.children.length) {
    movesPanel.textContent = "No moves yet: drag a piece, or open a game from the Games tab or the Explorer.";
  }
  currentElement?.scrollIntoView({ block: "nearest" });
}

function render(): void {
  if (!state) return;
  const step = currentStep();
  const result = explained.get(positionKey(step.fen));
  board.set({
    fen: step.fen,
    lastMove: step.lastMove as Key[] | undefined,
    turnColor: step.fen.split(" ")[1] === "w" ? "white" : "black",
    movable: {
      color: stale ? undefined : "both",
      dests: stale ? new Map() : (dests(step.fen) as Map<Key, Key[]>),
    },
  });
  renderSelector();
  board.set({ orientation: orientation() });
  updatePlayerControls();
  renderAnalysis(result);
  const node = step.node;
  buttons.first.disabled = buttons.back.disabled = state.path.length === 0;
  buttons.forward.disabled = buttons.last.disabled = node.children.length === 0;
  buttons.explain.disabled = busy;
  buttons.mainline.disabled = !state.path.some((index) => index > 0);
  renderMoves();
}

/** Moves to a path, remembering it as the visited branch at every node. */
function setPath(path: number[]): void {
  if (!state) return;
  steps = walk(state.rootFen, state.root, path);
  state.path = path.slice(0, steps.length - 1);
  steps.slice(0, -1).forEach((step, i) => (step.node.visited = state!.path[i]));
  notice = "";
  render();
  scheduleExplore();
  reportTrees();
  if (!stale) analyzePosition(currentStep().fen);
}

function navigateTo(path: number[]): void {
  if (stale) return;
  void stillNewest();
  setPath(path);
}

/** Forward follows the last visited child, else the main line. */
function forwardIndex(node: TreeNode): number | undefined {
  if (!node.children.length) return undefined;
  const visited = node.visited ?? 0;
  return visited < node.children.length ? visited : 0;
}

function forward(): void {
  const index = forwardIndex(currentStep().node);
  if (state && index !== undefined) navigateTo([...state.path, index]);
}

function toEnd(): void {
  if (!state) return;
  const path = [...state.path];
  let node = currentStep().node;
  for (let index = forwardIndex(node); index !== undefined; index = forwardIndex(node)) {
    path.push(index);
    node = node.children[index];
  }
  navigateTo(path);
}

// A move on the board or from the explorer: follows the existing branch with
// that move, or adds a new one ("Your analysis"). Nothing is ever dropped.
// Dragged promotions are always to a queen.
const PROMOTIONS = { q: "queen", r: "rook", b: "bishop", n: "knight" } as const;

function playMove(from: string, to: string, promotion: "queen" | "rook" | "bishop" | "knight" | undefined): void {
  if (!state || stale) return;
  const san = sanOf(currentStep().fen, from, to, promotion);
  if (!san) {
    render();
    return;
  }
  const index = addOrFollow(currentStep().node, san);
  navigateTo([...state.path, index]);
}

function onBoardMove(orig: Key, dest: Key): void {
  playMove(orig, dest, "queen");
}

function openBoard(payload: BoardPayload & { trees: Trees }): void {
  trees = payload.trees;
  for (const tree of trees.trees) tree.flipped ??= false;
  trees.current = Math.min(Math.max(trees.current, 0), trees.trees.length - 1);
  state = trees.trees[trees.current];
  viewerId = payload.viewerId;
  proposeOnce = Boolean(payload.propose);
  hasBook = Boolean(payload.book);
  user = payload.user ?? "Me";
  setSource(hasBook ? source : "games");
  setPath(state.path);
  // After setPath, which clears the notice.
  if (payload.notice) {
    notice = payload.notice;
    render();
  }
}

const app = new App({ name: "aio64-board", version: "0.1.1" });

// Only the newest board widget is usable; once a newer one exists (below an
// explanation, or opened for anything else) this one collapses to a line.
function collapse(): void {
  stale = true;
  stopEngine();
  for (const part of viewerParts) part.hidden = true;
  collapsed.hidden = false;
}

let lastCheck = 0;

async function stillNewest(): Promise<boolean> {
  if (stale) return false;
  if (!state || !viewerId) return true;
  lastCheck = Date.now();
  try {
    const result = await app.callServerTool({ name: "viewer_status", arguments: { viewerId } });
    const newest = (result.structuredContent as { newest?: boolean } | undefined)?.newest !== false;
    if (!newest) collapse();
    return newest;
  } catch {
    return true; // a failed check never blocks the widget
  }
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  const block = result.content.find((c) => c.type === "text");
  return block?.text ?? "";
}

// Live analysis in the browser (widget/engine.ts): the position on screen
// is analyzed without end, and each completed depth redraws the panel. The
// deepest analysis of every position is kept, so going back shows it at
// once while the search resumes.
const analysisPanel = byId("analysis");
let engineStatus = "loading engine...";

// Explain needs at least this depth; deeper if already computed.
const EXPLAIN_DEPTH = 20;
const depthWaiters: { key: string; resolve: (analysis: Analysis) => void }[] = [];

function onAnalysis(fen: string, analysis: Analysis): void {
  const key = positionKey(fen);
  const known = explained.get(key);
  if (!known || analysis.over || analysis.depth >= known.depth) explained.set(key, analysis);
  const best = explained.get(key)!;
  const ready = Boolean(best.over) || best.depth >= EXPLAIN_DEPTH;
  for (let i = depthWaiters.length - 1; i >= 0; i--) {
    if (depthWaiters[i].key === key && ready) depthWaiters.splice(i, 1)[0].resolve(best);
  }
  if (state && positionKey(currentStep().fen) === key) {
    renderAnalysis(best);
    // explain_position: propose the Explain prompt once, at depth 20.
    if (ready && proposeOnce && !stale) {
      proposeOnce = false;
      void explain();
    }
  }
}

/** Set by explain_position's board: fill the Explain prompt by itself. */
let proposeOnce = false;

/** The position's analysis at EXPLAIN_DEPTH or deeper, waiting if needed. */
function analysisForExplain(fen: string): Promise<Analysis> {
  const key = positionKey(fen);
  const known = explained.get(key);
  if (known && (known.over || known.depth >= EXPLAIN_DEPTH)) return Promise.resolve(known);
  return new Promise((resolve) => depthWaiters.push({ key, resolve }));
}

// The panel also carries messages (errors, the tree cap) above the lines:
// the widget has no separate status line.
function renderAnalysis(result: Analysis | undefined): void {
  renderLines(result);
  if (!notice) return;
  const message = document.createElement("div");
  message.className = "notice";
  message.textContent = notice;
  analysisPanel.prepend(message);
}

function renderLines(result: Analysis | undefined): void {
  if (!result || (!result.over && !result.lines.length)) {
    analysisPanel.replaceChildren();
    analysisPanel.textContent = stale ? "" : engineStatus || "analyzing...";
    return;
  }
  if (result.over) {
    analysisPanel.textContent = result.over;
    return;
  }
  const depth = document.createElement("span");
  depth.className = "depth";
  depth.textContent = `depth ${result.depth}`;
  analysisPanel.replaceChildren(
    ...result.lines.map((line, i) => {
      const row = document.createElement("div");
      const score = document.createElement("span");
      score.className = "score";
      score.textContent = line.eval;
      row.append(score, line.san);
      if (i === 0) row.prepend(depth);
      return row;
    }),
  );
}

/** The engine text Explain sends to Claude. */
function analysisText(analysis: Analysis): string {
  if (analysis.over) return analysis.over;
  const lines = analysis.lines.map((line, i) => `${i + 1}) ${line.eval}  ${line.san}`);
  return [`Stockfish 19 lite (in the browser), depth ${analysis.depth}`, ...lines].join("\n");
}

// Explain: the position's browser analysis, at least depth 20 (waiting if
// needed, deeper if already computed); saves all the trees, then fills the
// chat message so that Claude explains it in English and reopens the board
// below its answer with the saved state.
async function explain(): Promise<void> {
  if (!state || !(await stillNewest())) return;
  const step = currentStep();
  const failure = engineFailure();
  if (failure) {
    notice = failure;
    render();
    return;
  }
  busy = true;
  notice = "";
  render();
  try {
    const analysis = await analysisForExplain(step.fen);
    const text = analysisText(analysis);
    busy = false;
    render();

    const saved = await app.callServerTool({ name: "save_board", arguments: { state: JSON.stringify(trees) } });
    const stateId = saved.isError ? undefined : (saved.structuredContent as { id?: string } | undefined)?.id;

    const game = mainLabel();
    const lines = [`Explain this position (${game ? `${game}, ` : ""}after ${step.label}).`, `FEN: ${step.fen}`, text];
    if (stateId) lines.push(`After explaining, call open_board with state "${stateId}".`);
    await app.sendMessage({ role: "user", content: [{ type: "text", text: lines.join("\n") }] });
  } catch (error) {
    notice = error instanceof Error ? error.message : "Analysis failed";
  } finally {
    busy = false;
    render();
  }
}

buttons.first.addEventListener("click", () => navigateTo([]));
buttons.back.addEventListener("click", () => state && navigateTo(state.path.slice(0, -1)));
buttons.forward.addEventListener("click", forward);
buttons.last.addEventListener("click", toEnd);
buttons.explain.addEventListener("click", () => void explain());

// Make main line: the line through the current move, extended below it by
// the branches last visited (what End would reach), becomes the main line.
// Only the order changes; the current move stays selected.
buttons.flip.addEventListener("click", () => {
  if (!state || stale) return;
  state.flipped = !state.flipped;
  render();
  // The Explorer shows the user's games with the side now at the bottom.
  scheduleExplore();
});

buttons.mainline.addEventListener("click", () => {
  if (!state || stale) return;
  void stillNewest();
  const depth = state.path.length;
  const full = [...state.path];
  let node = currentStep().node;
  for (let index = forwardIndex(node); index !== undefined; index = forwardIndex(node)) {
    full.push(index);
    node = node.children[index];
  }
  makeMainLine(state.root, full);
  setPath(new Array<number>(depth).fill(0));
});

// Tabs: Moves | Explorer | Games. Explorer and Games show the user's own
// games; each queries Lichess only while visible.
type Tab = "moves" | "explorer" | "games";
let tab: Tab = "moves";

// On the Explorer only, two buttons: Local (the book, when there is one)
// and "<user> as <side>", where the side is the one at the bottom of the
// board (Flip changes it). The player is always the Lichess token's owner,
// never chosen in the widget.
function updatePlayerControls(): void {
  if (stale) return;
  explorerSource.hidden = tab !== "explorer";
  sourceBook.hidden = !hasBook;
  sourceBook.classList.toggle("active", source === "book");
  asSide.textContent = `${user} as ${orientation()}`;
  asSide.classList.toggle("active", source === "games");
}

function showTab(next: Tab): void {
  tab = next;
  tabMoves.classList.toggle("active", tab === "moves");
  tabExplorer.classList.toggle("active", tab === "explorer");
  tabGames.classList.toggle("active", tab === "games");
  movesPanel.hidden = tab !== "moves";
  explorerPanel.hidden = tab !== "explorer";
  gamesPanel.hidden = tab !== "games";
  updatePlayerControls();
  if (tab === "explorer") scheduleExplore();
  if (tab === "games") void listRecentGames();
}
tabMoves.addEventListener("click", () => showTab("moves"));
tabExplorer.addEventListener("click", () => showTab("explorer"));
tabGames.addEventListener("click", () => showTab("games"));

// Explorer panel: the chosen player's own games from the current position.
// Requests are debounced so that stepping quickly does not flood Lichess,
// and only the answer to the latest request is shown.

let exploreTimer: ReturnType<typeof setTimeout> | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let exploreRequest = 0;

// While the server's Lichess stream is open ("updating"), a fuller answer
// may arrive; the panel asks again every few seconds (cache hits on the
// server, no new Lichess requests), for the stream's 2 minutes at most.
const REFRESH_MS = 5000;
const MAX_REFRESHES = 24;

interface ExplorerMove {
  uci: string;
  san: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  performance?: number;
}

interface RecentGame {
  id: string;
  opponent: string;
  opponentRating?: number;
  result: "win" | "draw" | "loss";
  speed: string;
  month: string;
}

function scheduleExplore(): void {
  clearTimeout(exploreTimer);
  clearTimeout(refreshTimer);
  if (explorerPanel.hidden) return;
  exploreTimer = setTimeout(() => void explore(), 300);
}

function row(cells: [string, string][], onClick: () => void): HTMLLIElement {
  const li = document.createElement("li");
  for (const [text, className] of cells) {
    const span = document.createElement("span");
    span.textContent = text;
    span.className = className;
    li.append(span);
  }
  li.addEventListener("click", onClick);
  return li;
}

const SPEEDS: Record<string, string> = { correspondence: "corr" };
const RESULTS = { win: "won", draw: "drew", loss: "lost" };

// Explorer source: the user's games (the player database) or Local (the
// server's Polyglot book, offered only when one is configured). A new
// widget starts on the user's games.
let hasBook = false;
let source: "games" | "book" = "games";

function setSource(next: "games" | "book"): void {
  source = next;
  bookMoves.hidden = source !== "book";
  explorerMoves.hidden = explorerGames.hidden = source !== "games";
  updatePlayerControls();
  scheduleExplore();
}
sourceBook.addEventListener("click", () => setSource("book"));

interface BookMove {
  san: string;
  uci: string;
  percent: number;
}

// The book never changes while the server runs, so answers are kept for
// the widget's lifetime.
const bookCache = new Map<string, BookMove[]>();

async function exploreBook(request: number): Promise<void> {
  const step = currentStep();
  const key = positionKey(step.fen);
  let moves = bookCache.get(key);
  if (!moves) {
    const result = await app.callServerTool({ name: "book_moves", arguments: { fen: step.fen } });
    if (request !== exploreRequest) return;
    if (result.isError) {
      explorerStatus.textContent = textOf(result);
      bookMoves.replaceChildren();
      return;
    }
    moves = ((result.structuredContent ?? {}) as { moves?: BookMove[] }).moves ?? [];
    bookCache.set(key, moves);
  }
  explorerStatus.textContent = moves.length ? "" : "Out of book";
  const inTree = new Set(step.node.children.map((c) => c.san));
  bookMoves.replaceChildren(
    ...moves.map((m) =>
      row(
        [
          [`${inTree.has(m.san) ? "• " : ""}${m.san}`, "main"],
          [`${m.percent}%`, "grow"],
        ],
        () => playMove(m.uci.slice(0, 2), m.uci.slice(2, 4), PROMOTIONS[m.uci[4] as keyof typeof PROMOTIONS]),
      ),
    ),
  );
}

async function explore(refreshes = 0): Promise<void> {
  if (!state || stale) return;
  clearTimeout(refreshTimer);
  const request = ++exploreRequest;
  if (source === "book") {
    try {
      await exploreBook(request);
    } catch (error) {
      if (request === exploreRequest) explorerStatus.textContent = error instanceof Error ? error.message : "Book failed";
    }
    return;
  }
  const step = currentStep();
  if (refreshes === 0) explorerStatus.textContent = "searching...";
  try {
    const result = await app.callServerTool({
      name: "explore_position",
      arguments: { color: orientation(), fen: step.fen },
    });
    if (request !== exploreRequest) return;
    if (result.isError) {
      explorerStatus.textContent = textOf(result);
      explorerMoves.replaceChildren();
      explorerGames.replaceChildren();
      return;
    }
    const data = (result.structuredContent ?? {}) as {
      moves?: ExplorerMove[];
      recentGames?: RecentGame[];
      indexing?: boolean;
      updating?: boolean;
    };
    const moves = data.moves ?? [];
    const games = data.recentGames ?? [];
    const total = moves.reduce((sum, m) => sum + m.games, 0);
    // The refresh is silent: a label promising an update makes the developer
    // wait for a change that almost never comes (the data is usually
    // complete; Lichess only re-checks for games played since its last
    // indexing).
    const refreshing = Boolean(data.updating) && refreshes < MAX_REFRESHES;
    explorerStatus.textContent = `${total} games from here`;
    if (refreshing) {
      refreshTimer = setTimeout(() => {
        if (request === exploreRequest) void explore(refreshes + 1);
      }, REFRESH_MS);
    }

    // Moves already in the tree at this node are marked with a dot.
    const inTree = new Set(step.node.children.map((c) => c.san));
    explorerMoves.replaceChildren(
      ...moves.map((m) =>
        row(
          [
            [`${inTree.has(m.san) ? "• " : ""}${m.san}`, "main"],
            [String(m.games), "muted"],
            [`+${m.wins} =${m.draws} -${m.losses}`, "grow"],
            [m.performance ? String(m.performance) : "", "muted"],
          ],
          () => playMove(m.uci.slice(0, 2), m.uci.slice(2, 4), PROMOTIONS[m.uci[4] as keyof typeof PROMOTIONS]),
        ),
      ),
    );
    explorerGames.replaceChildren(
      ...games.map((g) =>
        row(
          [
            [RESULTS[g.result], "main"],
            [`vs ${g.opponent}${g.opponentRating ? ` (${g.opponentRating})` : ""}`, "grow"],
            [SPEEDS[g.speed] ?? g.speed, "muted"],
            [g.month, "muted"],
          ],
          () => void addGame(g.id, step.fen, "explorer"),
        ),
      ),
    );
  } catch (error) {
    if (request === exploreRequest) explorerStatus.textContent = error instanceof Error ? error.message : "Search failed";
  }
}

// Opens a clicked game in its own tree; games are never merged into another
// tree. If its tree is already open, that tree becomes current. From the
// Games tab (a game to review) it shows the final position; from the
// Explorer, the searched position (else the final one).
async function addGame(id: string, searchedFen: string, from: "explorer" | "games"): Promise<void> {
  if (!trees || stale) return;
  void stillNewest();
  const statusLine = from === "explorer" ? explorerStatus : gamesStatus;

  // The game's main line is its own moves, so a ply count is a path of zeros.
  const showAt = (ply: number) => {
    showTab("moves");
    setPath(new Array<number>(ply).fill(0));
  };
  const mainLineOf = (tree: Tree): string[] => {
    const moves: string[] = [];
    for (let node = tree.root.children[0]; node; node = node.children[0]) if (node.san) moves.push(node.san);
    return moves;
  };

  const open = trees.trees.findIndex((tree) => tree.mainGame === id);
  if (open >= 0) {
    const tree = trees.trees[open];
    trees.current = open;
    state = tree;
    const moves = mainLineOf(tree);
    const ply = from === "explorer" ? plyOf(tree.rootFen, moves, searchedFen) : undefined;
    showAt(ply ?? moves.length);
    return;
  }
  if (trees.trees.length >= MAX_TREES) {
    statusLine.textContent = TREES_FULL;
    return;
  }

  statusLine.textContent = "loading game...";
  try {
    const result = await app.callServerTool({ name: "load_game", arguments: { game: id } });
    if (result.isError) {
      statusLine.textContent = textOf(result);
      return;
    }
    const data = result.structuredContent as { game: GameInfo; startFen: string; moves: string[] };
    const root: TreeNode = { children: [] };
    let node = root;
    for (const san of data.moves) {
      const child: TreeNode = { san, children: [], games: [id] };
      node.children.push(child);
      node = child;
    }
    const tree: Tree = { rootFen: data.startFen, root, path: [], games: { [id]: data.game }, mainGame: id, flipped: false };
    // Checked again: the cap may have been reached while loading.
    if (!addTree(tree)) {
      statusLine.textContent = TREES_FULL;
      return;
    }
    const ply = from === "explorer" ? plyOf(data.startFen, data.moves, searchedFen) : undefined;
    showAt(ply ?? data.moves.length);
  } catch (error) {
    statusLine.textContent = error instanceof Error ? error.message : "Loading failed";
  }
}

// Games tab: the player's last finished games, newest first, both colors.

interface ListedGame {
  id: string;
  color: "white" | "black";
  opponent: string;
  opponentRating?: number;
  result: "win" | "draw" | "loss";
  speed: string;
  endedAt?: number;
}

function ago(ms: number | undefined): string {
  if (!ms) return "";
  const seconds = (Date.now() - ms) / 1000;
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  if (seconds < 2 * 86_400) return "yesterday";
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)} days ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

let gamesRequest = 0;

async function listRecentGames(): Promise<void> {
  if (!state || stale) return;
  const request = ++gamesRequest;
  gamesStatus.textContent = "loading...";
  try {
    const result = await app.callServerTool({ name: "recent_games", arguments: {} });
    if (request !== gamesRequest) return;
    if (result.isError) {
      gamesStatus.textContent = textOf(result);
      gamesList.replaceChildren();
      return;
    }
    const games = ((result.structuredContent ?? {}) as { games?: ListedGame[] }).games ?? [];
    gamesStatus.textContent = `Your last ${games.length} finished games`;
    gamesList.replaceChildren(
      ...games.map((g) =>
        row(
          [
            [RESULTS[g.result], "main"],
            [g.color === "white" ? "W" : "B", "muted"],
            [`vs ${g.opponent}${g.opponentRating ? ` (${g.opponentRating})` : ""}`, "grow"],
            [SPEEDS[g.speed] ?? g.speed, "muted"],
            [ago(g.endedAt), "muted"],
          ],
          () => void addGame(g.id, currentStep().fen, "games"),
        ),
      ),
    );
  } catch (error) {
    if (request === gamesRequest) gamesStatus.textContent = error instanceof Error ? error.message : "Loading failed";
  }
}

asSide.addEventListener("click", () => setSource("games"));

// Check when the widget scrolls back into view, at most every 2 seconds.
new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting) && Date.now() - lastCheck > 2000) void stillNewest();
}).observe(document.body);

app.ontoolresult = (result) => {
  const payload = (result.structuredContent ?? {}) as BoardPayload;
  if (payload.trees?.trees.length) openBoard({ ...payload, trees: payload.trees });
};

await app.connect();
void startEngine(app, {
  analysis: onAnalysis,
  status: (text) => {
    engineStatus = text;
    if (state) render();
  },
});
