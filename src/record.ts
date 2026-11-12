import { Chess } from "chessops/chess";
import { INITIAL_FEN, makeFen, parseFen } from "chessops/fen";
import { makeSanAndPlay, parseSan } from "chessops/san";
import { polyglotKey } from "./book.js";

/**
 * One finished game as stored in an account's database, whichever site it
 * came from. Pure data: the sync modules build it, db.ts stores it.
 */

export type Site = "lichess" | "chesscom";

/** How a game ended, the same values for both sites. */
export type Termination =
  | "checkmate"
  | "resignation"
  | "time"
  | "abandonment"
  | "stalemate"
  | "agreement"
  | "repetition"
  | "fifty-move"
  | "insufficient"
  | "time-insufficient"
  | "other";

export interface GameRecord {
  site: Site;
  siteId: string;
  white: string;
  black: string;
  whiteRating?: number;
  blackRating?: number;
  result: "1-0" | "0-1" | "1/2-1/2";
  termination: Termination;
  /** `180+2` (seconds), `3d` (days per move), `-` (unlimited). */
  timeControl: string;
  rated: boolean;
  /** Unix milliseconds; undefined when the site gives no start. */
  startedAt?: number;
  endedAt: number;
  /** Undefined for the standard start. */
  initialFen?: string;
  /** Normalized SAN (see replay). */
  moves: string[];
  /** One per position, from the start to the final one: its Zobrist hash
   * and the move played from it (undefined for the final position). */
  positions: { hash: bigint; next?: string }[];
  /** The site's original reply for this game, verbatim. */
  source: string;
}

/** What a site's game turned out to be. */
export type Parsed =
  | { kind: "game"; record: GameRecord }
  | { kind: "ongoing"; siteId: string; startedAt: number }
  /** Not stored, not an error: aborted, a variant, never played. */
  | { kind: "skipped"; siteId?: string }
  /** Not stored, and worth reporting: an illegal move, a malformed game. */
  | { kind: "rejected"; reason: string };

export interface Replayed {
  moves: string[];
  positions: { hash: bigint; next?: string }[];
  final: Chess;
  /** How many times the final position occurred in the game. */
  finalRepeats: number;
}

/**
 * Replays a game with chessops. Each move is rewritten as chessops writes it
 * (`Ngf3` only when two knights can reach f3, `O-O`, `=Q`, `+`, `#`), so the
 * stored moves always match the moves of the widget's trees. Throws on an
 * illegal or unreadable move.
 */
export function replay(initialFen: string | undefined, sans: string[]): Replayed {
  const setup = parseFen(initialFen ?? INITIAL_FEN);
  if (setup.isErr) throw new Error(`invalid FEN ${initialFen}`);
  const created = Chess.fromSetup(setup.value);
  if (created.isErr) throw new Error(`impossible position ${initialFen}`);
  const pos = created.value;

  // Hashes are stored as SQLite's signed 64-bit INTEGER.
  const hashOf = () => BigInt.asIntN(64, polyglotKey(makeFen(pos.toSetup())));
  const positions: { hash: bigint; next?: string }[] = [{ hash: hashOf() }];
  const moves: string[] = [];
  for (const san of sans) {
    const move = parseSan(pos, san);
    if (!move) throw new Error(`illegal move ${san} after ${moves.length} plies`);
    const normalized = makeSanAndPlay(pos, move);
    moves.push(normalized);
    positions[positions.length - 1].next = normalized;
    positions.push({ hash: hashOf() });
  }

  const finalHash = positions[positions.length - 1].hash;
  const finalRepeats = positions.filter((p) => p.hash === finalHash).length;
  return { moves, positions, final: pos, finalRepeats };
}

/**
 * The kind of a draw a site reports only as "draw" (Lichess), inferred from
 * the final position. Threefold repetition and the fifty-move rule almost
 * never coincide (developer, 2026-11-12), so the order matters little;
 * anything else is taken as agreed.
 */
export function inferDraw(game: Replayed): Termination {
  if (game.final.isInsufficientMaterial()) return "insufficient";
  if (game.finalRepeats >= 3) return "repetition";
  if (game.final.halfmoves >= 100) return "fifty-move";
  return "agreement";
}

/** True when a FEN is the standard starting position (move counters aside). */
export function isStandardStart(fen: string): boolean {
  return fen.split(" ").slice(0, 4).join(" ") === INITIAL_FEN.split(" ").slice(0, 4).join(" ");
}
