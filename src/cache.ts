import type { Game } from "./lichess.js";

// In-memory caches; lost on restart, which is harmless. Nothing is ever
// written to disk: Aio64 stays read-only.

/** Bounded insertion: Map keeps insertion order, so the first key is the oldest. */
function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value!);
}

/** Finished Lichess games never change, so a reopen never calls Lichess. */
export const games = new Map<string, Game>();

export interface GameInfo {
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

/** Everything a board widget needs to be rebuilt below Claude's answer. */
export interface BoardState {
  rootFen: string;
  root: TreeNode;
  /** Child indexes from the root to the current node. */
  path: number[];
  games: Record<string, GameInfo>;
  /** The last game added from the Games tab (an ID in games): the header
   * shows its players, and the board turns to the user's side in it. */
  mainGame?: string;
  /** Manual flip, reset whenever the main game changes. */
  flipped: boolean;
}

const states = new Map<string, BoardState>();

export function getState(id: string): BoardState | undefined {
  return states.get(id);
}

export function saveState(id: string, state: BoardState): void {
  setBounded(states, id, state, 1000);
}

/**
 * Only the newest board widget is usable (developer's rule); every older one
 * collapses when it learns it was superseded, whatever it shows.
 */
export const viewers = { newest: "" };
