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
  /** Whether the master database exists (the Explorer's Master source). */
  master?: boolean;
  /** The configured accounts' usernames: the board turns to their side. */
  users?: string[];
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id} element`);
  return element as T;
}

const viewerParts = [
  "tree-row",
  "board",
  "controls",
  "analysis",
  "tabs",
  "explorer-source",
  "games-bar",
  "sync-confirm",
  "games-filters",
  "moves",
  "explorer",
  "games",
].map((id) => byId(id));
const gamesPanel = byId("games");
const gamesStatus = byId("games-status");
const gamesList = byId("games-list");
const gamesMore = byId<HTMLButtonElement>("games-more");
const gamesBar = byId("games-bar");
const filtersToggle = byId<HTMLButtonElement>("filters-toggle");
const filtersClear = byId<HTMLButtonElement>("filters-clear");
const gamesFilters = byId("games-filters");
const syncButton = byId<HTMLButtonElement>("sync");
const syncConfirm = byId("sync-confirm");
const syncYes = byId<HTMLButtonElement>("sync-yes");
const syncNo = byId<HTMLButtonElement>("sync-no");
const filterInputs = {
  account: byId<HTMLSelectElement>("f-account"),
  opponent: byId<HTMLInputElement>("f-opponent"),
  color: byId<HTMLSelectElement>("f-color"),
  result: byId<HTMLSelectElement>("f-result"),
  termination: byId<HTMLSelectElement>("f-termination"),
  speed: byId<HTMLSelectElement>("f-speed"),
  rated: byId<HTMLSelectElement>("f-rated"),
  thematic: byId<HTMLSelectElement>("f-thematic"),
  from: byId<HTMLInputElement>("f-from"),
  to: byId<HTMLInputElement>("f-to"),
};
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
const sourceMaster = byId<HTMLButtonElement>("source-master");
const masterMoves = byId("master-moves");
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

/** The configured accounts' usernames, lowercased; sent with every board. */
let users = new Set<string>();

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

// Black at the bottom when one of the accounts played Black in the tree's
// game, White otherwise; the manual flip reverses it.
function orientation(): "white" | "black" {
  const game = mainGame();
  const base = game && users.has(game.black.toLowerCase()) ? "black" : "white";
  return state?.flipped ? (base === "white" ? "black" : "white") : base;
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// PGN tab: the tree as PGN text, variations in parentheses, every move
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
    movesPanel.textContent = "No moves yet: drag a piece, or open a game from All Games or the Explorer.";
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
  scheduleContext();
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
  hasMaster = Boolean(payload.master);
  users = new Set((payload.users ?? []).map((name) => name.toLowerCase()));
  setSource(source);
  setPath(state.path);
  // After setPath, which clears the notice.
  if (payload.notice) {
    notice = payload.notice;
    render();
  }
}

// Aio64's version, injected at build time from package.json.
declare const __AIO64_VERSION__: string;

const app = new App({ name: "aio64-board", version: __AIO64_VERSION__ });

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
    scheduleContext();
    // explain_position: propose the Explain prompt once, at depth 20.
    if (ready && proposeOnce && !stale) {
      proposeOnce = false;
      void explain();
    }
  }
}

/** Set by explain_position's board: fill the Explain prompt by itself. */
let proposeOnce = false;
// The model context: the position on the board and its analysis, given to
// Claude with updateModelContext, which starts no reply; claude.ai attaches
// the latest update to the user's next message. The `explain` prompt (the
// + menu) relies on it: started by the user, its reply is their own turn,
// in which claude.ai draws the board reopened below the answer. Debounced:
// stepping quickly or a fast-deepening search sends one update.
let contextTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleContext(): void {
  clearTimeout(contextTimer);
  if (stale) return;
  contextTimer = setTimeout(() => void sendContext(), 1000);
}

async function sendContext(): Promise<void> {
  if (!state || stale) return;
  const step = currentStep();
  const analysis = explained.get(positionKey(step.fen));
  const game = mainLabel();
  const text = [
    `Aio64 board: ${game ? `${game}, ` : "analysis, "}${step.label === "Start" ? "start position" : `after ${step.label}`}.`,
    `FEN: ${step.fen}`,
    analysis ? analysisText(analysis) : "Stockfish: no analysis yet.",
  ].join("\n");
  try {
    await app.updateModelContext({ content: [{ type: "text", text }] });
  } catch {
    // A host without model context: the explain prompt then lacks the
    // position, and the Explain button still works.
  }
}

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
// needed, deeper if already computed), then sends the chat message so that
// Claude explains it in English below this board, which stays live.
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

    // Only the position: claude.ai keeps one board per chat, and this one
    // stays live (beside the chat once the user clicks its fullscreen
    // control), so the message says nothing about boards.
    const game = mainLabel();
    const lines = [
      `Explain this position (${game ? `${game}, ` : ""}after ${step.label}).`,
      `FEN: ${step.fen}`,
      text,
    ];
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

// Tabs: PGN | Explorer | All Games (internally "moves", "explorer",
// "games"). Explorer and All Games read the accounts' local game
// databases (never a site), each only while visible.
type Tab = "moves" | "explorer" | "games";
let tab: Tab = "moves";

// On the Explorer only, two buttons, always shown: Master (the master
// database; a message when it has not been built) and Personal (every
// account, both colors).
function updatePlayerControls(): void {
  if (stale) return;
  explorerSource.hidden = tab !== "explorer";
  sourceMaster.classList.toggle("active", source === "master");
  asSide.textContent = "Personal";
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
  gamesBar.hidden = tab !== "games";
  gamesFilters.hidden = tab !== "games" || !filtersOpen;
  syncConfirm.hidden = true;
  updatePlayerControls();
  if (tab === "explorer") scheduleExplore();
  if (tab === "games") {
    void listGames();
    void followSync();
  }
}
tabMoves.addEventListener("click", () => showTab("moves"));
tabExplorer.addEventListener("click", () => showTab("explorer"));
tabGames.addEventListener("click", () => showTab("games"));

// Explorer panel: every account's games from the current position.
// Requests are debounced so that stepping quickly sends one query, and only
// the answer to the latest request is shown.

let exploreTimer: ReturnType<typeof setTimeout> | undefined;
let exploreRequest = 0;

interface ExplorerMove {
  uci: string;
  san: string;
  games: number;
  /** From White's side, as on Lichess and Chess.com. */
  white: number;
  draws: number;
  black: number;
}

/**
 * A move's results as a bar: White won, drawn, Black won, each as wide as
 * its share. A share too narrow for its label shows no label.
 */
function resultBar(m: ExplorerMove): HTMLSpanElement {
  const bar = document.createElement("span");
  bar.className = "bar";
  for (const [count, className] of [
    [m.white, "white"],
    [m.draws, "draw"],
    [m.black, "black"],
  ] as const) {
    if (!count) continue;
    const percent = (100 * count) / m.games;
    const part = document.createElement("span");
    part.className = className;
    part.style.width = `${percent}%`;
    if (percent >= 15) part.textContent = `${Math.round(percent)}%`;
    bar.append(part);
  }
  bar.title = `White won ${m.white}, drawn ${m.draws}, Black won ${m.black}`;
  return bar;
}

/** A game as the server lists it, from its account's side. */
interface ListedGame {
  /** The game key, `<site>:<site_id>`. */
  key: string;
  site: "lichess" | "chesscom";
  account: string;
  color: "white" | "black";
  opponent: string;
  opponentRating?: number;
  result: "win" | "draw" | "loss";
  termination: string;
  timeControl: string;
  speed: string;
  rated: boolean;
  endedAt: number;
  thematic: boolean;
}

const SITES = { lichess: "Lichess", chesscom: "Chess.com" };

/** A time control for display: `180+2` becomes `3+2`, days stay `3d`. */
function clock(timeControl: string): string {
  const live = /^(\d+)\+(\d+)$/.exec(timeControl);
  if (!live) return timeControl;
  const minutes = Number(live[1]) / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}+${live[2]}`;
}

/**
 * A listed game, on two lines so that it fits the widget's width: color,
 * opponent and result above; date (UTC), site and account, and clock
 * below, smaller.
 */
function gameRow(g: ListedGame, onClick: () => void): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "game";
  const line = (cells: [string, string][]) => {
    const div = document.createElement("div");
    for (const [text, className] of cells) {
      const span = document.createElement("span");
      span.textContent = text;
      span.className = className;
      div.append(span);
    }
    return div;
  };
  li.append(
    line([
      ["", `side ${g.color}`],
      [`${g.opponent}${g.opponentRating ? ` (${g.opponentRating})` : ""}`, "grow"],
      [RESULTS[g.result], "result"],
    ]),
    // The account, not just its site: there may be several on one site.
    line([
      [`${new Date(g.endedAt).toISOString().slice(0, 10)} · ${SITES[g.site]} ${g.account} · ${clock(g.timeControl)}`, "muted"],
    ]),
  );
  li.addEventListener("click", onClick);
  return li;
}

function scheduleExplore(): void {
  clearTimeout(exploreTimer);
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

const RESULTS = { win: "win", draw: "draw", loss: "loss" };

// Explorer source: Personal (every account) or Master (the master
// database). A new widget starts on Personal.
let hasMaster = false;
let source: "games" | "master" = "games";

function setSource(next: "games" | "master"): void {
  source = next;
  masterMoves.hidden = source !== "master";
  explorerMoves.hidden = explorerGames.hidden = source !== "games";
  updatePlayerControls();
  scheduleExplore();
}
sourceMaster.addEventListener("click", () => setSource("master"));

/**
 * One row per move, most played first: the move (a dot when it is already
 * in the tree here), its game count and its results bar. A click plays it.
 */
function moveRows(moves: ExplorerMove[], step: Step): HTMLLIElement[] {
  const inTree = new Set(step.node.children.map((c) => c.san));
  return moves.map((m) => {
    const li = row(
      [
        [`${inTree.has(m.san) ? "• " : ""}${m.san}`, "main"],
        [String(m.games), "count"],
      ],
      () => playMove(m.uci.slice(0, 2), m.uci.slice(2, 4), PROMOTIONS[m.uci[4] as keyof typeof PROMOTIONS]),
    );
    li.append(resultBar(m));
    return li;
  });
}

// The master database never changes while the server runs, so answers are
// kept for the widget's lifetime.
const masterCache = new Map<string, ExplorerMove[]>();

async function exploreMaster(request: number): Promise<void> {
  if (!hasMaster) {
    explorerStatus.textContent = "No Master database available";
    explorerStatus.classList.add("centered");
    masterMoves.replaceChildren();
    return;
  }
  const step = currentStep();
  const key = positionKey(step.fen);
  let moves = masterCache.get(key);
  if (!moves) {
    const result = await app.callServerTool({ name: "master_moves", arguments: { fen: step.fen } });
    if (request !== exploreRequest) return;
    if (result.isError) {
      explorerStatus.textContent = textOf(result);
      masterMoves.replaceChildren();
      return;
    }
    moves = ((result.structuredContent ?? {}) as { moves?: ExplorerMove[] }).moves ?? [];
    masterCache.set(key, moves);
  }
  const total = moves.reduce((sum, m) => sum + m.games, 0);
  explorerStatus.textContent = total ? `${total} games from here` : "Not in the master database";
  masterMoves.replaceChildren(...moveRows(moves, step));
}

async function explore(): Promise<void> {
  if (!state || stale) return;
  const request = ++exploreRequest;
  explorerStatus.classList.remove("centered");
  if (source === "master") {
    try {
      await exploreMaster(request);
    } catch (error) {
      if (request === exploreRequest) explorerStatus.textContent = error instanceof Error ? error.message : "Search failed";
    }
    return;
  }
  const step = currentStep();
  try {
    const result = await app.callServerTool({ name: "explore_position", arguments: { fen: step.fen } });
    if (request !== exploreRequest) return;
    if (result.isError) {
      explorerStatus.textContent = textOf(result);
      explorerMoves.replaceChildren();
      explorerGames.replaceChildren();
      return;
    }
    const data = (result.structuredContent ?? {}) as { moves?: ExplorerMove[]; games?: ListedGame[]; total?: number };
    const moves = data.moves ?? [];
    const games = data.games ?? [];
    const total = data.total ?? 0;
    explorerStatus.textContent =
      total > games.length ? `${total} games from here; the last ${games.length} below` : `${total} games from here`;

    explorerMoves.replaceChildren(...moveRows(moves, step));
    explorerGames.replaceChildren(...games.map((g) => gameRow(g, () => void addGame(g.key, step.fen, "explorer"))));
  } catch (error) {
    if (request === exploreRequest) explorerStatus.textContent = error instanceof Error ? error.message : "Search failed";
  }
}

// Opens a clicked game in its own tree; games are never merged into another
// tree. If its tree is already open, that tree becomes current. From the
// All Games tab (a game to review) it shows the final position; from the
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

// All Games: every account's games, newest first, both colors, narrowed by
// the filters, 100 at a time ("More" adds the next page).

let gamesRequest = 0;
let filtersOpen = false;
/** Games shown so far, and how many match the filters in all. */
let gamesShown = 0;
let gamesTotal = 0;

/** The filters as list_games arguments; an empty field means "any". */
function filterArguments(): Record<string, unknown> {
  const f = filterInputs;
  const args: Record<string, unknown> = {};
  if (f.account.value) args.account = f.account.value;
  if (f.opponent.value.trim()) args.opponent = f.opponent.value.trim();
  if (f.color.value) args.color = f.color.value;
  if (f.result.value) args.result = f.result.value;
  if (f.termination.value) args.termination = f.termination.value;
  if (f.speed.value) args.speed = f.speed.value;
  if (f.rated.value) args.rated = f.rated.value === "true";
  if (f.thematic.value) args.thematic = f.thematic.value === "true";
  // Dates are UTC days, as the list shows them; "to" includes its day.
  if (f.from.value) args.from = f.from.valueAsNumber;
  if (f.to.value) args.to = f.to.valueAsNumber + 86_400_000 - 1;
  return args;
}

function filtersActive(): boolean {
  return Object.keys(filterArguments()).length > 0;
}

/** Loads the first page (or, with `more`, the next one). */
async function listGames(more = false): Promise<void> {
  if (!state || stale) return;
  const request = ++gamesRequest;
  const offset = more ? gamesShown : 0;
  gamesStatus.textContent = "loading...";
  filtersClear.hidden = !filtersActive();
  filtersToggle.classList.toggle("active", filtersActive());
  try {
    const result = await app.callServerTool({
      name: "list_games",
      arguments: { ...filterArguments(), offset },
    });
    if (request !== gamesRequest) return;
    if (result.isError) {
      gamesStatus.textContent = textOf(result);
      gamesList.replaceChildren();
      gamesMore.hidden = true;
      return;
    }
    const data = (result.structuredContent ?? {}) as { games?: ListedGame[]; total?: number; accounts?: string[] };
    fillAccounts(data.accounts ?? []);
    const games = data.games ?? [];
    const rows = games.map((g) => gameRow(g, () => void addGame(g.key, currentStep().fen, "games")));
    if (more) gamesList.append(...rows);
    else gamesList.replaceChildren(...rows);
    gamesShown = offset + games.length;
    gamesTotal = data.total ?? 0;
    gamesStatus.textContent =
      gamesTotal === 0
        ? filtersActive()
          ? "No game matches the filters"
          : "No games yet: sync to fetch them"
        : `${gamesTotal} games${gamesShown < gamesTotal ? `; the last ${gamesShown} below` : ""}`;
    gamesMore.hidden = gamesShown >= gamesTotal;
  } catch (error) {
    if (request === gamesRequest) gamesStatus.textContent = error instanceof Error ? error.message : "Loading failed";
  }
}

/** The account filter's choices, from the server; filled once. */
function fillAccounts(accounts: string[]): void {
  const select = filterInputs.account;
  if (select.options.length > 1 || accounts.length === 0) return;
  for (const account of accounts) {
    const option = document.createElement("option");
    option.value = account;
    option.textContent = account;
    select.append(option);
  }
}

filtersToggle.addEventListener("click", () => {
  filtersOpen = !filtersOpen;
  gamesFilters.hidden = !filtersOpen;
});

filtersClear.addEventListener("click", () => {
  for (const input of Object.values(filterInputs)) input.value = "";
  void listGames();
});

// A filter applies at once; the opponent's name after a short pause in
// typing.
let opponentTimer: ReturnType<typeof setTimeout> | undefined;
for (const [name, input] of Object.entries(filterInputs)) {
  if (name === "opponent") {
    input.addEventListener("input", () => {
      clearTimeout(opponentTimer);
      opponentTimer = setTimeout(() => void listGames(), 400);
    });
  } else {
    input.addEventListener("change", () => void listGames());
  }
}

gamesMore.addEventListener("click", () => void listGames(true));

// The sync: confirmed first (it may take minutes and fetch from both
// sites), then started on the server, which runs it in the background; the
// widget polls its status every 2 s and reloads the list at the end. A
// widget opened during a sync finds it running and follows it too.

interface SyncSummary {
  account: string;
  added: number;
  skipped: number;
  rejected: number;
  error?: string;
}

const SYNC_POLL_MS = 2000;
let syncTimer: ReturnType<typeof setTimeout> | undefined;

syncButton.addEventListener("click", () => {
  if (stale) return;
  syncConfirm.hidden = false;
  syncYes.focus();
});
syncNo.addEventListener("click", () => {
  syncConfirm.hidden = true;
});
// A click on the dimmed backdrop, or Escape, cancels like Cancel.
syncConfirm.addEventListener("click", (event) => {
  if (event.target === syncConfirm) syncConfirm.hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !syncConfirm.hidden) syncConfirm.hidden = true;
});
syncYes.addEventListener("click", async () => {
  syncConfirm.hidden = true;
  if (stale) return;
  syncButton.disabled = true;
  gamesStatus.textContent = "starting sync...";
  try {
    const result = await app.callServerTool({ name: "sync_games", arguments: {} });
    if (result.isError) {
      gamesStatus.textContent = textOf(result);
      syncButton.disabled = false;
      return;
    }
    void followSync();
  } catch (error) {
    gamesStatus.textContent = error instanceof Error ? error.message : "Sync failed";
    syncButton.disabled = false;
  }
});

/** Polls sync_status while a sync runs; shows the summary at the end. */
async function followSync(): Promise<void> {
  clearTimeout(syncTimer);
  if (stale) return;
  try {
    const result = await app.callServerTool({ name: "sync_status", arguments: {} });
    const status = (result.structuredContent ?? {}) as { running?: boolean; progress?: string; summary?: SyncSummary[] };
    if (status.running) {
      syncButton.disabled = true;
      if (tab === "games") gamesStatus.textContent = `Syncing: ${status.progress ?? ""}`;
      syncTimer = setTimeout(() => void followSync(), SYNC_POLL_MS);
      return;
    }
    // Only after a sync this widget followed: the button was disabled.
    if (syncButton.disabled) {
      syncButton.disabled = false;
      await listGames();
      const summary = (status.summary ?? [])
        .map((s) => (s.error ? `${s.account}: ${s.error}` : `${s.account}: ${s.added} new`))
        .join("; ");
      if (summary) gamesStatus.textContent = `Sync done. ${summary}`;
    }
  } catch {
    syncButton.disabled = false;
  }
}

asSide.addEventListener("click", () => setSource("games"));

// Check when the widget scrolls back into view, at most every 2 seconds.
new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting) && Date.now() - lastCheck > 2000) void stillNewest();
}).observe(document.body);

// claude.ai keeps one board per chat and sends each later open_board result
// to it (observed 2026-11-12), instead of drawing a new board. A board
// that receives a result is therefore the newest again: it expands if a
// newer viewer ID had collapsed it, and takes the result's ID.
app.ontoolresult = (result) => {
  const payload = (result.structuredContent ?? {}) as BoardPayload;
  if (!payload.trees?.trees.length) return;
  if (stale) expand();
  openBoard({ ...payload, trees: payload.trees });
};

function runEngine(): void {
  void startEngine(app, {
    analysis: onAnalysis,
    status: (text) => {
      engineStatus = text;
      if (state) render();
    },
  });
}

// Picture-in-picture: the board floats over the chat, so it stays in view
// while the explanation scrolls. Offered only when claude.ai lists "pip"
// among the display modes it supports; until then the button stays hidden.
const floatButton = byId<HTMLButtonElement>("float");
let floating = false;

function updateFloat(): void {
  const context = app.getHostContext();
  const modes = context?.availableDisplayModes ?? [];
  floating = context?.displayMode === "pip";
  floatButton.hidden = !modes.includes("pip");
  floatButton.textContent = floating ? "Dock" : "Float";
}

floatButton.addEventListener("click", async () => {
  try {
    const result = await app.requestDisplayMode({ mode: floating ? "inline" : "pip" });
    floating = result.mode === "pip";
    floatButton.textContent = floating ? "Dock" : "Float";
  } catch {
    // The host refused: the board stays where it is.
  }
});

app.addEventListener("hostcontextchanged", () => {
  updateFloat();
});

// No button to move the board beside the chat: claude.ai's own fullscreen
// control (the diagonal arrows) already puts it in the side pane, and
// claude.ai refuses to do so automatically (an automatic request got
// "kept inline", tested 2026-11-12).

/** Undoes collapse(): the board shows again and analyzes again. */
function expand(): void {
  stale = false;
  collapsed.hidden = true;
  for (const part of viewerParts) part.hidden = false;
  // The tabs decide which panels and bars show.
  showTab(tab);
  runEngine();
}

await app.connect();
updateFloat();
runEngine();
