import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DatabaseSync as Database } from "node:sqlite";
import { DatabaseSync, DIRECTORY } from "./db.js";
import { type ExplorerMove, withUci } from "./games.js";
import { storedHash } from "./hash.js";

/**
 * The master database (games/master.sqlite), built by `npm run
 * build-master` and only read here. Totals per position and move, from
 * White's side; no games are stored.
 */

const PATH = fileURLToPath(new URL("master.sqlite", DIRECTORY));

export class Master {
  private constructor(
    private readonly db: Database,
    /** How many games the database was built from. */
    readonly games: number,
  ) {}

  /** The master database, or undefined when it has not been built. */
  static open(): Master | undefined {
    if (!existsSync(PATH)) return undefined;
    const db = new DatabaseSync(PATH, { readOnly: true });
    const row = db.prepare("SELECT value FROM meta WHERE key = 'games'").get() as { value: string } | undefined;
    return new Master(db, Number(row?.value ?? 0));
  }

  /** The moves played from a position, most played first. */
  moves(fen: string): ExplorerMove[] {
    const rows = this.db
      .prepare("SELECT next, white, draws, black FROM moves WHERE hash = ?")
      .all(storedHash(fen)) as { next: string; white: number; draws: number; black: number }[];
    return withUci(
      fen,
      rows.map((r) => ({
        san: r.next,
        games: Number(r.white) + Number(r.draws) + Number(r.black),
        white: Number(r.white),
        draws: Number(r.draws),
        black: Number(r.black),
      })),
    );
  }
}
