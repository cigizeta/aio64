import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as Database, StatementSync } from "node:sqlite";
import type { GameRecord, Parsed, Site } from "./record.js";

// node:sqlite may still print an ExperimentalWarning in the pinned Node; it
// is built in and needs no dependency, so only that one warning is dropped.
// Loaded through require, after the filter, because a static import would
// load it (and warn) before this module runs.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning.message;
  if (text.includes("SQLite")) return;
  (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
export const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * One SQLite file per configured account, in games/ (ignored by Git). The
 * only files Aio64 writes; only the sync writes them. The tables are
 * general: a file could hold any finished games, from either site.
 */

export const DIRECTORY = new URL("../games/", import.meta.url);

/** Bumped when the format changes: games and positions are then rebuilt
 * from each game's stored source, without contacting any site. */
const SCHEMA_VERSION = "1";

const GAME_TABLES = `
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    site TEXT NOT NULL,
    site_id TEXT NOT NULL,
    white TEXT NOT NULL COLLATE NOCASE,
    black TEXT NOT NULL COLLATE NOCASE,
    white_rating INTEGER,
    black_rating INTEGER,
    result TEXT NOT NULL,
    termination TEXT NOT NULL,
    time_control TEXT NOT NULL,
    rated INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER NOT NULL,
    initial_fen TEXT,
    moves TEXT NOT NULL,
    source TEXT NOT NULL,
    UNIQUE (site, site_id)
  );
  CREATE INDEX IF NOT EXISTS games_ended_at ON games (ended_at);
  CREATE TABLE IF NOT EXISTS positions (
    hash INTEGER NOT NULL,
    game_id INTEGER NOT NULL REFERENCES games (id),
    ply INTEGER NOT NULL,
    next TEXT,
    PRIMARY KEY (hash, game_id, ply)
  ) WITHOUT ROWID;
`;

const SITE_TABLES: Record<Site, string> = {
  // Lichess games still in progress when last fetched: IDs only, never
  // their moves or players. Every Lichess game created up to the cursor is
  // either in games or here.
  lichess: `
    CREATE TABLE IF NOT EXISTS pending (
      site_id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL
    ) WITHOUT ROWID;
  `,
  // Chess.com's monthly archives; a complete month is never fetched again.
  chesscom: `
    CREATE TABLE IF NOT EXISTS archives (
      month TEXT PRIMARY KEY,
      etag TEXT,
      last_modified TEXT,
      complete INTEGER NOT NULL DEFAULT 0
    ) WITHOUT ROWID;
  `,
};

export class AccountDb {
  readonly db: Database;
  private statements?: { game: StatementSync; position: StatementSync };

  constructor(
    readonly site: Site,
    readonly username: string,
    reparse: (site: Site, source: string) => Parsed,
  ) {
    mkdirSync(DIRECTORY, { recursive: true });
    this.db = new DatabaseSync(new URL(`${site}-${username.toLowerCase()}.sqlite`, DIRECTORY));
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
    this.db.exec(SITE_TABLES[site]);
    this.db.exec(GAME_TABLES);

    const version = this.getMeta("schema_version");
    if (version !== undefined && version !== SCHEMA_VERSION) this.rebuild(reparse);
    this.setMeta("schema_version", SCHEMA_VERSION);
    this.setMeta("site", site);
    this.setMeta("username", username);
  }

  /** The account as shown in logs and summaries: `lichess/<user>`. */
  get label(): string {
    return `${this.site}/${this.username}`;
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  /** Runs `work` in one transaction: all of it is written, or none. */
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Stores a game and its positions; false if it was already stored. */
  storeGame(game: GameRecord): boolean {
    this.statements ??= {
      game: this.db.prepare(`
        INSERT OR IGNORE INTO games (site, site_id, white, black, white_rating, black_rating, result,
          termination, time_control, rated, started_at, ended_at, initial_fen, moves, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `),
      position: this.db.prepare("INSERT OR IGNORE INTO positions (hash, game_id, ply, next) VALUES (?, ?, ?, ?)"),
    };
    const row = this.statements.game.get(
      game.site,
      game.siteId,
      game.white,
      game.black,
      game.whiteRating ?? null,
      game.blackRating ?? null,
      game.result,
      game.termination,
      game.timeControl,
      game.rated ? 1 : 0,
      game.startedAt ?? null,
      game.endedAt,
      game.initialFen ?? null,
      game.moves.join(" "),
      game.source,
    ) as { id: number | bigint } | undefined;
    if (!row) return false;
    const position = this.statements.position;
    game.positions.forEach((p, ply) => position.run(p.hash, row.id, ply, p.next ?? null));
    return true;
  }

  countGames(): number {
    return Number((this.db.prepare("SELECT count(*) AS n FROM games").get() as { n: number | bigint }).n);
  }

  /**
   * After a format change: every stored game is rebuilt from its source, in
   * one transaction. Games that no longer parse are dropped. Tables other
   * than games and positions (meta, pending, archives) are kept.
   */
  private rebuild(reparse: (site: Site, source: string) => Parsed): void {
    const sources = this.db.prepare("SELECT site, source FROM games").all() as { site: Site; source: string }[];
    this.transaction(() => {
      this.db.exec("DROP TABLE positions; DROP TABLE games;");
      this.db.exec(GAME_TABLES);
      this.statements = undefined;
      for (const { site, source } of sources) {
        const parsed = reparse(site, source);
        if (parsed.kind === "game") this.storeGame(parsed.record);
      }
    });
  }
}
