import { Chess } from "chessops/chess";
import { INITIAL_FEN, parseFen } from "chessops/fen";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { storedHash } from "./hash.js";
import type { GameInfo } from "./cache.js";
import type { AccountDb } from "./db.js";
import type { Site } from "./record.js";

/**
 * Reads the accounts' game databases: the Explorer, the game list and a
 * single game. Read-only; never contacts a site. Every query runs on each
 * account's file and the results are merged here (a handful of files).
 * Outside this module a game is named by its key, `<site>:<site_id>`.
 */

export function gameKey(site: Site, siteId: string): string {
  return `${site}:${siteId}`;
}

/** A game as listed by the Explorer and All Games, from its account's side. */
export interface ListedGame {
  key: string;
  site: Site;
  /** The account's username, as configured. */
  account: string;
  color: "white" | "black";
  opponent: string;
  opponentRating?: number;
  /** From the account's point of view. */
  result: "win" | "draw" | "loss";
  termination: string;
  timeControl: string;
  speed: Speed;
  rated: boolean;
  endedAt: number;
  /** Started from a position other than the standard start. */
  thematic: boolean;
}

export type Speed = "bullet" | "blitz" | "rapid" | "classical" | "daily";

/**
 * Lichess's categories from the estimated duration, base + 40 * increment
 * (ultrabullet counted as bullet); days per move, or no clock, is daily.
 */
export function speedOf(timeControl: string): Speed {
  const live = /^(\d+)\+(\d+)$/.exec(timeControl);
  if (!live) return "daily";
  const estimate = Number(live[1]) + 40 * Number(live[2]);
  if (estimate < 180) return "bullet";
  if (estimate < 480) return "blitz";
  if (estimate < 1500) return "rapid";
  return "classical";
}

interface GameRow {
  site: Site;
  site_id: string;
  white: string;
  black: string;
  white_rating: number | null;
  black_rating: number | null;
  result: string;
  termination: string;
  time_control: string;
  rated: number;
  ended_at: number;
  thematic: number;
}

const ROW_COLUMNS = `site, site_id, white, black, white_rating, black_rating, result, termination,
  time_control, rated, ended_at, initial_fen IS NOT NULL AS thematic`;

function listed(db: AccountDb, row: GameRow): ListedGame {
  const color = row.black.toLowerCase() === db.username.toLowerCase() ? "black" : "white";
  const opponentRating = color === "white" ? row.black_rating : row.white_rating;
  const won = color === "white" ? "1-0" : "0-1";
  return {
    key: gameKey(row.site, row.site_id),
    site: row.site,
    account: db.username,
    color,
    opponent: color === "white" ? row.black : row.white,
    opponentRating: opponentRating ?? undefined,
    result: row.result === "1/2-1/2" ? "draw" : row.result === won ? "win" : "loss",
    termination: row.termination,
    timeControl: row.time_control,
    speed: speedOf(row.time_control),
    rated: row.rated === 1,
    endedAt: Number(row.ended_at),
    thematic: row.thematic === 1,
  };
}

const newestFirst = (a: ListedGame, b: ListedGame) => b.endedAt - a.endedAt;

export interface ExplorerMove {
  san: string;
  uci: string;
  /** Games that played this move from the position. */
  games: number;
  /** Their results from White's side, as on Lichess and Chess.com:
   * White won, drawn, Black won. */
  white: number;
  draws: number;
  black: number;
}

export interface Exploration {
  moves: ExplorerMove[];
  /** Games that reached the position, newest first, at most MAX_GAMES. */
  games: ListedGame[];
  /** All games that reached the position. */
  total: number;
}

const MAX_GAMES = 50;

/** Moves and games from a position, over every account (both colors). */
export function explore(dbs: AccountDb[], fen: string): Exploration {
  const hash = storedHash(fen);
  const counts = new Map<string, { n: number; w: number; d: number }>();
  let total = 0;
  let games: ListedGame[] = [];
  for (const db of dbs) {
    // Results from White's side, whoever the account played.
    const moves = db.db
      .prepare(
        `SELECT p.next, count(DISTINCT p.game_id) AS n,
           count(DISTINCT CASE WHEN g.result = '1-0' THEN p.game_id END) AS w,
           count(DISTINCT CASE WHEN g.result = '1/2-1/2' THEN p.game_id END) AS d
         FROM positions p JOIN games g ON g.id = p.game_id
         WHERE p.hash = ? AND p.next IS NOT NULL GROUP BY p.next`,
      )
      .all(hash) as { next: string; n: number; w: number; d: number }[];
    for (const { next, n, w, d } of moves) {
      const sum = counts.get(next) ?? { n: 0, w: 0, d: 0 };
      counts.set(next, { n: sum.n + Number(n), w: sum.w + Number(w), d: sum.d + Number(d) });
    }
    total += Number(
      (db.db.prepare("SELECT count(DISTINCT game_id) AS n FROM positions WHERE hash = ?").get(hash) as { n: number }).n,
    );
    const rows = db.db
      .prepare(
        `SELECT ${ROW_COLUMNS} FROM games WHERE id IN (SELECT game_id FROM positions WHERE hash = ?)
         ORDER BY ended_at DESC LIMIT ${MAX_GAMES}`,
      )
      .all(hash) as unknown as GameRow[];
    games.push(...rows.map((row) => listed(db, row)));
  }
  games = games.sort(newestFirst).slice(0, MAX_GAMES);
  const moves = withUci(
    fen,
    [...counts].map(([san, { n, w, d }]) => ({ san, games: n, white: w, draws: d, black: n - w - d })),
  );
  return { moves, games, total };
}

/**
 * Adds each move's UCI (the widget plays a clicked move from its squares)
 * and sorts by games played, most first. A move illegal in the position
 * (a hash collision) is dropped.
 */
export function withUci(fen: string, moves: Omit<ExplorerMove, "uci">[]): ExplorerMove[] {
  const setup = parseFen(fen);
  const pos = setup.isOk ? Chess.fromSetup(setup.value) : undefined;
  const result: ExplorerMove[] = [];
  for (const m of moves) {
    const move = pos?.isOk ? parseSan(pos.value, m.san) : undefined;
    if (move) result.push({ ...m, uci: makeUci(move) });
  }
  return result.sort((a, b) => b.games - a.games);
}

/** All Games' filters; each one left out means "any". */
export interface GameFilters {
  /** `<site>/<username>`. */
  account?: string;
  /** Part of the opponent's name, ignoring case. */
  opponent?: string;
  color?: "white" | "black";
  result?: "win" | "draw" | "loss";
  termination?: string;
  speed?: Speed;
  rated?: boolean;
  /** Unix milliseconds, on the end of the game, inclusive. */
  from?: number;
  to?: number;
  thematic?: boolean;
}

export const PAGE = 100;

/**
 * All Games: every account's games, newest first, filtered, one page at a
 * time. A few thousand rows per account, so filtering here is simpler than
 * building SQL for the derived filters (color, result, speed) and fast.
 */
export function listGames(
  dbs: AccountDb[],
  filters: GameFilters,
  offset: number,
): { games: ListedGame[]; total: number } {
  const opponent = filters.opponent?.toLowerCase();
  const all: ListedGame[] = [];
  for (const db of dbs) {
    if (filters.account && filters.account.toLowerCase() !== db.label.toLowerCase()) continue;
    const rows = db.db.prepare(`SELECT ${ROW_COLUMNS} FROM games`).all() as unknown as GameRow[];
    for (const row of rows) {
      const game = listed(db, row);
      if (opponent && !game.opponent.toLowerCase().includes(opponent)) continue;
      if (filters.color && game.color !== filters.color) continue;
      if (filters.result && game.result !== filters.result) continue;
      if (filters.termination && game.termination !== filters.termination) continue;
      if (filters.speed && game.speed !== filters.speed) continue;
      if (filters.rated !== undefined && game.rated !== filters.rated) continue;
      if (filters.from !== undefined && game.endedAt < filters.from) continue;
      if (filters.to !== undefined && game.endedAt > filters.to) continue;
      if (filters.thematic !== undefined && game.thematic !== filters.thematic) continue;
      all.push(game);
    }
  }
  all.sort(newestFirst);
  return { games: all.slice(offset, offset + PAGE), total: all.length };
}

/** One game by key, for a tree: its players, start and moves. */
export function loadGame(
  dbs: AccountDb[],
  key: string,
): { game: GameInfo; startFen: string; moves: string[] } | undefined {
  const match = /^(lichess|chesscom):(.+)$/.exec(key);
  if (!match) return undefined;
  const [, site, siteId] = match;
  for (const db of dbs) {
    if (db.site !== site) continue;
    const row = db.db
      .prepare(
        "SELECT white, black, white_rating, black_rating, result, initial_fen, moves FROM games WHERE site = ? AND site_id = ?",
      )
      .get(site, siteId) as
      | {
          white: string;
          black: string;
          white_rating: number | null;
          black_rating: number | null;
          result: string;
          initial_fen: string | null;
          moves: string;
        }
      | undefined;
    if (!row) continue;
    return {
      game: {
        id: key,
        white: row.white,
        black: row.black,
        whiteRating: row.white_rating ?? undefined,
        blackRating: row.black_rating ?? undefined,
        result: row.result,
      },
      startFen: row.initial_fen ?? INITIAL_FEN,
      moves: row.moves ? row.moves.split(" ") : [],
    };
  }
  return undefined;
}
