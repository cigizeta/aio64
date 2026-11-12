// In-memory caches; lost on restart, which is harmless. Nothing here is
// written to disk (only the sync writes, to the accounts' game databases).

export interface GameInfo {
  /** The game key, `<site>:<site_id>` (e.g. `lichess:q7ZvsdUF`). */
  id: string;
  white: string;
  black: string;
  whiteRating?: number;
  blackRating?: number;
  result: string;
  opening?: string;
}

/** A move in the board's PGN tree; the root has no move. Plain JSON. */
export interface TreeNode {
  san?: string;
  children: TreeNode[];
  /** IDs of the games whose line passes through this move. */
  games?: string[];
  /** Index of the last visited child, followed by Forward. */
  visited?: number;
}

/** One tree: a game (played or analysis) with the user's variations. */
export interface Tree {
  rootFen: string;
  root: TreeNode;
  /** Child indexes from the root to the current node. */
  path: number[];
  games: Record<string, GameInfo>;
  /** The last game added from the Games tab (an ID in games): the header
   * shows its players, and the board turns to the user's side in it. */
  mainGame?: string;
  /** Manual flip. */
  flipped: boolean;
}

export const MAX_TREES = 10;

/** Everything a board widget needs to be rebuilt: 1 to MAX_TREES trees. */
export interface Trees {
  trees: Tree[];
  /** Index of the tree shown on the board. */
  current: number;
}

/**
 * The newest widget's trees, reported by the widget itself, so that a
 * board Claude opens next carries them over. Memory only.
 */
export const latest: { trees?: Trees } = {};

/**
 * Only the newest board widget is usable (developer's rule); every older one
 * collapses when it learns it was superseded, whatever it shows.
 */
export const viewers = { newest: "" };
