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

/** The shallowest path to every position of the tree. */
function indexPositions(rootFen: string, root: TreeNode): Map<string, number[]> {
  // Breadth first, so the first path recorded for a position is the
  // shallowest (the "highest" node of the joining rule).
  const found = new Map<string, number[]>();
  const queue: { node: TreeNode; pos: Chess; path: number[] }[] = [
    { node: root, pos: position(rootFen), path: [] },
  ];
  while (queue.length) {
    const { node, pos, path } = queue.shift()!;
    const key = positionKey(fenOf(pos));
    if (!found.has(key)) found.set(key, path);
    node.children.forEach((child, i) => {
      const next = pos.clone();
      const move = child.san ? parseSan(next, child.san) : undefined;
      if (!move) return;
      next.play(move);
      queue.push({ node: child, pos: next, path: [...path, i] });
    });
  }
  return found;
}

/**
 * Joins a game's line into the tree. The game joins at the shallowest tree
 * node whose position it passes through (normally the root: the whole game);
 * its earlier moves are discarded. Moves already in the tree are followed,
 * so a game added twice is not duplicated. Returns the paths to the searched
 * position (the join point if the game never reaches it) and to the game's
 * last move, or undefined if the game never reaches a position of the tree.
 */
export function joinGame(
  rootFen: string,
  root: TreeNode,
  gameId: string,
  startFen: string,
  moves: string[],
  searchedFen: string,
): { searched: number[]; end: number[] } | undefined {
  const treePositions = indexPositions(rootFen, root);

  // Positions of the game, ply by ply.
  const gamePos = position(startFen);
  const gameKeys = [positionKey(fenOf(gamePos))];
  for (const san of moves) {
    const move = parseSan(gamePos, san);
    if (!move) break;
    gamePos.play(move);
    gameKeys.push(positionKey(fenOf(gamePos)));
  }

  let joinPly = -1;
  let joinPath: number[] | undefined;
  gameKeys.forEach((key, ply) => {
    const path = treePositions.get(key);
    if (path && (!joinPath || path.length < joinPath.length)) {
      joinPly = ply;
      joinPath = path;
    }
  });
  if (!joinPath) return undefined;

  // Walk down the tree to the join node, then add or follow the game's moves.
  let node = root;
  for (const index of joinPath) {
    node.visited = index;
    node = node.children[index];
  }
  const searchedKey = positionKey(searchedFen);
  let path = [...joinPath];
  let searchedPath = gameKeys[joinPly] === searchedKey ? [...path] : undefined;
  for (let ply = joinPly; ply < moves.length && ply + 1 < gameKeys.length; ply++) {
    const index = addOrFollow(node, moves[ply], gameId);
    node = node.children[index];
    path = [...path, index];
    if (!searchedPath && gameKeys[ply + 1] === searchedKey) searchedPath = [...path];
  }
  return { searched: searchedPath ?? joinPath, end: path };
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
