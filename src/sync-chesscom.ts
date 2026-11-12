import type { AccountDb } from "./db.js";
import { checkResponse, type SyncCounts, SyncError, USER_AGENT } from "./http.js";
import { pgnMoves, pgnTags } from "./pgn.js";
import { type GameRecord, isStandardStart, type Parsed, replay, type Termination } from "./record.js";

/**
 * The Chess.com sync: one account's finished games from its monthly
 * archives (public data, no login). Archives hold finished games only; each
 * game is still checked. A month is fetched again until it is over and
 * fetched once more after that; unchanged months answer 304.
 */

const API = "https://api.chess.com/pub/player";
const HEADERS = { "User-Agent": USER_AGENT };

/** Chess.com's data may refresh up to a day late, so a month counts as
 * complete only once this long has passed after its end. */
const SETTLE_MS = 2 * 24 * 3600_000;

interface Player {
  username?: string;
  rating?: number;
  result?: string;
}

interface ChesscomGame {
  url?: string;
  uuid?: string;
  pgn?: string;
  time_control?: string;
  start_time?: number;
  end_time?: number;
  rated?: boolean;
  rules?: string;
  initial_setup?: string;
  white?: Player;
  black?: Player;
}

const DRAWS = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);

const TERMINATIONS: Record<string, Termination> = {
  checkmated: "checkmate",
  resigned: "resignation",
  timeout: "time",
  abandoned: "abandonment",
  stalemate: "stalemate",
  agreed: "agreement",
  repetition: "repetition",
  "50move": "fifty-move",
  insufficient: "insufficient",
  timevsinsufficient: "time-insufficient",
};

/** `180+2`, `600+0`, `3d` (daily: seconds per move as days), or `-`. */
function timeControl(value: string | undefined): string {
  if (!value || value === "-") return "-";
  const daily = /^1\/(\d+)$/.exec(value);
  if (daily) return `${Math.round(Number(daily[1]) / 86400)}d`;
  const live = /^(\d+)(?:\+(\d+))?$/.exec(value);
  return live ? `${live[1]}+${live[2] ?? 0}` : value;
}

/** The start in milliseconds: `start_time` (daily games only), else the
 * PGN's UTCDate and UTCTime. */
function startedAt(game: ChesscomGame, tags: Map<string, string>): number | undefined {
  if (game.start_time) return game.start_time * 1000;
  const date = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(tags.get("UTCDate") ?? "");
  const time = /^(\d{2}):(\d{2}):(\d{2})$/.exec(tags.get("UTCTime") ?? "");
  if (!date || !time) return undefined;
  return Date.UTC(+date[1], +date[2] - 1, +date[3], +time[1], +time[2], +time[3]);
}

/** One game of a monthly archive, as a stored game or what it is. */
export function parseChesscom(source: string): Parsed {
  let game: ChesscomGame;
  try {
    game = JSON.parse(source) as ChesscomGame;
  } catch {
    return { kind: "rejected", reason: "unreadable JSON" };
  }
  // Live and daily games are numbered separately: the kind is part of the ID.
  const siteId = /\/game\/(live|daily)\/(\d+)/.exec(game.url ?? "")?.slice(1).join("/") ?? game.uuid;
  if (!siteId) return { kind: "rejected", reason: "game without URL or UUID" };
  if (game.rules !== "chess") return { kind: "skipped", siteId };
  if (!game.pgn || !game.end_time || !game.white?.result || !game.black?.result) {
    return { kind: "rejected", reason: `${siteId}: missing PGN, end time or result` };
  }

  // Finished: one side won, or both drew. Anything else is not stored.
  const white = game.white.result;
  const black = game.black.result;
  let result: GameRecord["result"];
  let ending: string;
  if (white === "win") [result, ending] = ["1-0", black];
  else if (black === "win") [result, ending] = ["0-1", white];
  else if (DRAWS.has(white) && DRAWS.has(black)) [result, ending] = ["1/2-1/2", white];
  else return { kind: "rejected", reason: `${siteId}: unfinished or unknown result ${white}/${black}` };

  const tags = pgnTags(game.pgn);
  const fen = tags.get("SetUp") === "1" ? tags.get("FEN") : game.initial_setup;
  const initialFen = fen && !isStandardStart(fen) ? fen : undefined;

  let replayed;
  try {
    replayed = replay(initialFen, pgnMoves(game.pgn));
  } catch (error) {
    return { kind: "rejected", reason: `${siteId}: ${error instanceof Error ? error.message : String(error)}` };
  }

  const record: GameRecord = {
    site: "chesscom",
    siteId,
    white: game.white.username ?? "?",
    black: game.black.username ?? "?",
    whiteRating: game.white.rating,
    blackRating: game.black.rating,
    result,
    termination: TERMINATIONS[ending] ?? "other",
    timeControl: timeControl(game.time_control),
    rated: game.rated === true,
    startedAt: startedAt(game, tags),
    endedAt: game.end_time * 1000,
    initialFen,
    moves: replayed.moves,
    positions: replayed.positions,
    source,
  };
  return { kind: "game", record };
}

/** True once a month (`2026-11`) is over and Chess.com has had time to
 * publish all of its games. */
function settled(month: string): boolean {
  const [year, number] = month.split("-").map(Number);
  return Date.now() > Date.UTC(year, number, 1) + SETTLE_MS;
}

export async function syncChesscom(db: AccountDb, progress: (text: string) => void): Promise<SyncCounts> {
  const counts: SyncCounts = { added: 0, skipped: 0, rejected: 0 };
  const user = encodeURIComponent(db.username.toLowerCase());

  const list = await fetch(`${API}/${user}/games/archives`, { headers: HEADERS });
  checkResponse(list, "Chess.com", `No Chess.com player "${db.username}".`);
  const archives = ((await list.json()) as { archives?: string[] }).archives ?? [];

  const known = db.db.prepare("SELECT etag, last_modified, complete FROM archives WHERE month = ?");
  const save = db.db.prepare(
    "INSERT OR REPLACE INTO archives (month, etag, last_modified, complete) VALUES (?, ?, ?, ?)",
  );

  for (const url of archives) {
    // Only Chess.com's own archive URLs are followed.
    const match = /^https:\/\/api\.chess\.com\/pub\/player\/[^/]+\/games\/(\d{4})\/(\d{2})$/.exec(url);
    if (!match) throw new SyncError(`Unexpected Chess.com archive URL: ${url}`);
    const month = `${match[1]}-${match[2]}`;
    const row = known.get(month) as { etag: string | null; last_modified: string | null; complete: number } | undefined;
    if (row?.complete) continue;

    const headers: Record<string, string> = { ...HEADERS };
    if (row?.etag) headers["If-None-Match"] = row.etag;
    if (row?.last_modified) headers["If-Modified-Since"] = row.last_modified;
    const response = await fetch(url, { headers });
    checkResponse(response, "Chess.com", `Chess.com archive ${month} not found.`);
    const complete = settled(month) ? 1 : 0;

    if (response.status === 304) {
      save.run(month, row?.etag ?? null, row?.last_modified ?? null, complete);
      continue;
    }
    const games = ((await response.json()) as { games?: unknown[] }).games ?? [];
    db.transaction(() => {
      for (const game of games) {
        const parsed = parseChesscom(JSON.stringify(game));
        if (parsed.kind === "game") {
          if (db.storeGame(parsed.record)) counts.added++;
        } else if (parsed.kind === "rejected") {
          counts.rejected++;
          console.warn(`  rejected: ${parsed.reason}`);
        } else {
          counts.skipped++;
        }
      }
      save.run(month, response.headers.get("ETag"), response.headers.get("Last-Modified"), complete);
    });
    progress(`${db.label}: ${month}, ${counts.added} new`);
  }
  return counts;
}
