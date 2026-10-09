import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess, type Square } from "chess.js";
import { KEYS } from "@echecs/zobrist";

/**
 * A Polyglot opening book, read once into memory and never written. The
 * format: 16-byte big-endian entries (key, move, weight, learn), sorted by
 * key; the key is the position's Zobrist hash over the standard Polyglot
 * Random64 table (KEYS, from @echecs/zobrist).
 */

export interface BookMove {
  san: string;
  uci: string;
  /** Share of the position's total weight, rounded. Raw weights are never
   * shown: they are relative within one position and mean nothing alone. */
  percent: number;
}

const ENTRY = 16;
const PIECES = "pnbrqk";

/** The Polyglot key of a FEN position. */
export function polyglotKey(fen: string): bigint {
  const [placement, turn, castling, ep] = fen.split(" ");
  const ranks = placement.split("/");
  const board: string[][] = []; // board[rank][file], rank 0 is rank 1
  let key = 0n;
  ranks.forEach((row, i) => {
    const rank = 7 - i;
    board[rank] = [];
    let file = 0;
    for (const c of row) {
      if (c >= "1" && c <= "8") {
        file += Number(c);
        continue;
      }
      const white = c === c.toUpperCase();
      // Kinds: black pawn 0, white pawn 1, black knight 2, ... white king 11.
      const kind = PIECES.indexOf(c.toLowerCase()) * 2 + (white ? 1 : 0);
      key ^= KEYS[64 * kind + 8 * rank + file];
      board[rank][file] = c;
      file++;
    }
  });
  if (castling.includes("K")) key ^= KEYS[768];
  if (castling.includes("Q")) key ^= KEYS[769];
  if (castling.includes("k")) key ^= KEYS[770];
  if (castling.includes("q")) key ^= KEYS[771];
  // The en passant file counts only if a pawn of the side to move stands
  // next to the pawn that just moved two squares.
  if (ep && ep !== "-") {
    const file = ep.charCodeAt(0) - 97;
    const rank = turn === "w" ? 4 : 3;
    const pawn = turn === "w" ? "P" : "p";
    if (board[rank]?.[file - 1] === pawn || board[rank]?.[file + 1] === pawn) key ^= KEYS[772 + file];
  }
  if (turn === "w") key ^= KEYS[780];
  return key;
}

const PROMOTION = ["", "n", "b", "r", "q"];
const square = (file: number, row: number) => `${String.fromCharCode(97 + file)}${row + 1}`;

// Polyglot writes castling as the king taking its own rook.
const CASTLING: Record<string, string> = { e1h1: "e1g1", e1a1: "e1c1", e8h8: "e8g8", e8a8: "e8c8" };

export class Book {
  private readonly view: DataView;
  readonly entries: number;

  constructor(bytes: Uint8Array) {
    if (bytes.byteLength === 0 || bytes.byteLength % ENTRY !== 0) throw new Error("not a Polyglot book");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.entries = bytes.byteLength / ENTRY;
  }

  /** The book's moves for a position, highest share first. */
  moves(fen: string): BookMove[] {
    const key = polyglotKey(fen);
    let low = 0;
    let high = this.entries;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.view.getBigUint64(mid * ENTRY) < key) low = mid + 1;
      else high = mid;
    }

    const chess = new Chess(fen);
    const weights = new Map<string, { san: string; uci: string; weight: number }>();
    for (let i = low; i < this.entries && this.view.getBigUint64(i * ENTRY) === key; i++) {
      const move = this.view.getUint16(i * ENTRY + 8);
      const weight = this.view.getUint16(i * ENTRY + 10);
      let uci = square((move >> 6) & 7, (move >> 9) & 7) + square(move & 7, (move >> 3) & 7);
      if (chess.get(uci.slice(0, 2) as Square)?.type === "k") uci = CASTLING[uci] ?? uci;
      uci += PROMOTION[(move >> 12) & 7] ?? "";
      let san: string;
      try {
        san = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
        chess.undo();
      } catch {
        continue; // a move illegal here (a key collision): dropped
      }
      const seen = weights.get(san);
      if (seen) seen.weight += weight;
      else weights.set(san, { san, uci, weight });
    }

    const total = [...weights.values()].reduce((sum, m) => sum + m.weight, 0);
    return [...weights.values()]
      .sort((a, b) => b.weight - a.weight)
      .map(({ san, uci, weight }) => ({ san, uci, percent: total ? Math.round((100 * weight) / total) : 0 }));
  }
}

// Reference keys from the Polyglot specification. A mismatch means the key
// table or the hashing is wrong, and every lookup would silently miss.
const TEST_KEYS: [string, bigint][] = [
  ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 0x463b96181691fc9cn],
  ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", 0x823c9b50fd114196n],
  ["rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2", 0x0756b94461c50fb0n],
  ["rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2", 0x662fafb965db29d4n],
];

/**
 * Loads the book named by POLYGLOT_PATH (relative paths from the repository
 * root). Returns undefined when unset; exits when set but unusable.
 */
export function loadBook(path: string | undefined): Book | undefined {
  if (!path) return undefined;
  for (const [fen, expected] of TEST_KEYS) {
    if (polyglotKey(fen) !== expected) {
      console.error(`\nFATAL: Polyglot key self-test failed for ${fen}\n`);
      process.exit(1);
    }
  }
  const root = fileURLToPath(new URL("..", import.meta.url));
  const full = isAbsolute(path) ? path : resolve(root, path);
  try {
    return new Book(readFileSync(full));
  } catch (error) {
    console.error(`POLYGLOT_PATH: cannot load ${full} (${error instanceof Error ? error.message : String(error)})`);
    process.exit(1);
  }
}
