import { Chess, normalizeMove } from "chessops/chess";
import { chessgroundDests } from "chessops/compat";
import { makeFen, parseFen } from "chessops/fen";
import { makeSanAndPlay, parseSan } from "chessops/san";
import { makeSquare, parseSquare, squareRank } from "chessops/util";

/** A move in the board's PGN tree; the root has no move. Plain JSON. */
export interface TreeNode {
  san?: string;
  children: TreeNode[];
  /** IDs of the games whose line passes through this move. */
  games?: string[];
  /** Index of the last visited child, followed by Forward. */
  visited?: number;
}

export interface Step {
  node: TreeNode;
  fen: string;
  /** "Start", "12.Nf3", "12...Nc6". */
  label: string;
  lastMove?: [string, string];
}

export function position(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

export function fenOf(pos: Chess): string {
  return makeFen(pos.toSetup());
}

/** Pieces, side to move and castling; counters and en passant ignored. */
export function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 3).join(" ");
}

export function dests(fen: string): Map<string, string[]> {
  return chessgroundDests(position(fen));
}

/** The root and every node along a path, with positions and labels. */
export function walk(rootFen: string, root: TreeNode, path: number[]): Step[] {
  const pos = position(rootFen);
  const steps: Step[] = [{ node: root, fen: fenOf(pos), label: "Start" }];
  let node = root;
  for (const index of path) {
    const child = node.children[index];
    const move = child?.san ? parseSan(pos, child.san) : undefined;
    if (!child || !move || !("from" in move)) break;
    const label = pos.turn === "white" ? `${pos.fullmoves}.${child.san}` : `${pos.fullmoves}...${child.san}`;
    pos.play(move);
    steps.push({ node: child, fen: fenOf(pos), label, lastMove: [makeSquare(move.from), makeSquare(move.to)] });
    node = child;
  }
  return steps;
}

/** Follows the child with this SAN, adding it if missing; returns its index. */
export function addOrFollow(node: TreeNode, san: string, gameId?: string): number {
  let index = node.children.findIndex((c) => c.san === san);
  if (index < 0) {
    node.children.push({ san, children: [] });
    index = node.children.length - 1;
  }
  const child = node.children[index];
  if (gameId && !child.games?.includes(gameId)) child.games = [...(child.games ?? []), gameId];
  node.visited = index;
  return index;
}

/** SAN of a board move (chessground squares), or undefined if illegal. */
export function sanOf(fen: string, from: string, to: string, promotion?: "queen" | "rook" | "bishop" | "knight"): string | undefined {
  const pos = position(fen);
  const fromSquare = parseSquare(from);
  const toSquare = parseSquare(to);
  if (fromSquare === undefined || toSquare === undefined) return undefined;
  // chessops rejects a promotion on any other move, so it only applies to a
  // pawn reaching the last rank (queen unless told otherwise).
  const promotes = pos.board.get(fromSquare)?.role === "pawn" && (squareRank(toSquare) === 0 || squareRank(toSquare) === 7);
  // chessops writes castling as king-takes-rook; normalizeMove maps the
  // chessground king move (e1g1) onto it.
  const move = normalizeMove(pos, {
    from: fromSquare,
    to: toSquare,
    promotion: promotes ? (promotion ?? "queen") : undefined,
  });
  if (!pos.isLegal(move)) return undefined;
  return makeSanAndPlay(pos, move);
}

/**
 * The number of plies along a line (from its start position) until it first
 * reaches a position, or undefined if it never does. Games are never merged
 * into another tree, so this only finds where to show a game opened from
 * the Explorer.
 */
export function plyOf(startFen: string, moves: string[], fen: string): number | undefined {
  const target = positionKey(fen);
  const pos = position(startFen);
  if (positionKey(fenOf(pos)) === target) return 0;
  for (let ply = 0; ply < moves.length; ply++) {
    const move = parseSan(pos, moves[ply]);
    if (!move) return undefined;
    pos.play(move);
    if (positionKey(fenOf(pos)) === target) return ply + 1;
  }
  return undefined;
}

/**
 * Makes the line along a path the main line: at every node on the way, the
 * chosen child moves to the front. Only the order changes; the previous main
 * line becomes a variation where the two diverge. Returns the same path in
 * the new order (all zeros).
 */
export function makeMainLine(root: TreeNode, path: number[]): number[] {
  let node = root;
  let depth = 0;
  for (const index of path) {
    const child = node.children[index];
    if (!child) break;
    if (index > 0) {
      node.children.splice(index, 1);
      node.children.unshift(child);
      // Keep "last visited" pointing at the same child after the reorder.
      if (node.visited !== undefined) {
        node.visited = node.visited === index ? 0 : node.visited < index ? node.visited + 1 : node.visited;
      }
    }
    node = child;
    depth++;
  }
  return new Array<number>(depth).fill(0);
}
