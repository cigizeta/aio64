import { KEYS } from "@echecs/zobrist";

/**
 * The positions' hash in every Aio64 database (accounts and master): the
 * Polyglot Zobrist key, over the standard Random64 table (KEYS, from
 * @echecs/zobrist). A position is identified by its pieces, side to move,
 * castling rights and a capturable en passant square, so transpositions
 * share one hash.
 */

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

/** The hash as stored: SQLite's signed 64-bit INTEGER. */
export function storedHash(fen: string): bigint {
  return BigInt.asIntN(64, polyglotKey(fen));
}

// Reference keys from the Polyglot specification.
const TEST_KEYS: [string, bigint][] = [
  ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 0x463b96181691fc9cn],
  ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", 0x823c9b50fd114196n],
  ["rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2", 0x0756b94461c50fb0n],
  ["rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2", 0x662fafb965db29d4n],
];

/**
 * Exits if the hash disagrees with the specification's reference keys: a
 * wrong hash would make every lookup silently miss.
 */
export function checkHash(): void {
  for (const [fen, expected] of TEST_KEYS) {
    if (polyglotKey(fen) !== expected) {
      console.error(`\nFATAL: position hash self-test failed for ${fen}\n`);
      process.exit(1);
    }
  }
}
