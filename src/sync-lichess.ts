import type { AccountDb } from "./db.js";
import { checkResponse, ndjsonLines, type SyncCounts, USER_AGENT } from "./http.js";
import { type GameRecord, inferDraw, type Parsed, replay, type Termination } from "./record.js";

/**
 * The Lichess sync: one account's finished games, without a token (public
 * data). Lichess's export filters by creation time, never by end, so a plain
 * cursor would miss a game created before the last sync but finished after
 * it (a correspondence game can last months). Hence the invariant: every
 * game created up to the cursor is either stored or listed in `pending`
 * (its ID only), and each sync re-checks the pending IDs.
 */

const LICHESS = "https://lichess.org";
const BATCH = 100;
/** Lichess's limit for the export by IDs. */
const IDS_PER_REQUEST = 300;
const CURSOR = "lichess_cursor";

const HEADERS = { Accept: "application/x-ndjson", "User-Agent": USER_AGENT };
// Moves are needed for finished games; clocks, evaluations and openings are
// not stored.
const EXPORT_OPTIONS = "moves=true&clocks=false&evals=false&opening=false&literate=false";

interface Player {
  user?: { name?: string };
  rating?: number;
  aiLevel?: number;
}

interface LichessGame {
  id?: string;
  rated?: boolean;
  variant?: string;
  createdAt?: number;
  lastMoveAt?: number;
  status?: string;
  winner?: "white" | "black";
  initialFen?: string;
  moves?: string;
  clock?: { initial?: number; increment?: number };
  daysPerTurn?: number;
  players?: { white?: Player; black?: Player };
}

const ONGOING = new Set(["created", "started"]);
const UNPLAYED = new Set(["aborted", "noStart"]);
const STANDARD = new Set(["standard", "fromPosition"]);

const TERMINATIONS: Record<string, Termination> = {
  mate: "checkmate",
  resign: "resignation",
  stalemate: "stalemate",
  // Lichess's "timeout": the opponent left and the win was claimed.
  timeout: "abandonment",
  cheat: "other",
  unknownFinish: "other",
  variantEnd: "other",
};

function playerName(player: Player | undefined): string {
  if (player?.user?.name) return player.user.name;
  return player?.aiLevel ? `Stockfish level ${player.aiLevel}` : "Anonymous";
}

/** One line of Lichess's NDJSON export, as a stored game or what it is. */
export function parseLichess(line: string): Parsed {
  let game: LichessGame;
  try {
    game = JSON.parse(line) as LichessGame;
  } catch {
    return { kind: "rejected", reason: "unreadable JSON" };
  }
  if (!game.id || !game.status || game.createdAt === undefined) {
    return { kind: "rejected", reason: "missing ID, status or creation time" };
  }
  // Checked first: nothing of a game in progress is kept but its ID.
  if (ONGOING.has(game.status)) return { kind: "ongoing", siteId: game.id, startedAt: game.createdAt };
  if (UNPLAYED.has(game.status) || !STANDARD.has(game.variant ?? "standard")) {
    return { kind: "skipped", siteId: game.id };
  }
  if (game.lastMoveAt === undefined) return { kind: "rejected", reason: `${game.id}: no end time` };

  const initialFen = game.variant === "fromPosition" ? game.initialFen : undefined;
  let replayed;
  try {
    replayed = replay(initialFen, game.moves ? game.moves.split(" ") : []);
  } catch (error) {
    return { kind: "rejected", reason: `${game.id}: ${error instanceof Error ? error.message : String(error)}` };
  }

  let termination: Termination;
  if (game.status === "draw") termination = inferDraw(replayed);
  else if (game.status === "outoftime") termination = game.winner ? "time" : "time-insufficient";
  else termination = TERMINATIONS[game.status] ?? "other";

  const timeControl = game.clock
    ? `${game.clock.initial ?? 0}+${game.clock.increment ?? 0}`
    : game.daysPerTurn
      ? `${game.daysPerTurn}d`
      : "-";

  const record: GameRecord = {
    site: "lichess",
    siteId: game.id,
    white: playerName(game.players?.white),
    black: playerName(game.players?.black),
    whiteRating: game.players?.white?.rating,
    blackRating: game.players?.black?.rating,
    result: game.winner === "white" ? "1-0" : game.winner === "black" ? "0-1" : "1/2-1/2",
    termination,
    timeControl,
    rated: game.rated === true,
    startedAt: game.createdAt,
    endedAt: game.lastMoveAt,
    initialFen,
    moves: replayed.moves,
    positions: replayed.positions,
    source: line,
  };
  return { kind: "game", record };
}

/** Applies one parsed game to the database; part of a caller's transaction. */
function apply(db: AccountDb, parsed: Parsed, counts: SyncCounts, deletePending: (id: string) => void): void {
  switch (parsed.kind) {
    case "game":
      if (db.storeGame(parsed.record)) counts.added++;
      deletePending(parsed.record.siteId);
      break;
    case "ongoing":
      db.db
        .prepare("INSERT OR IGNORE INTO pending (site_id, started_at) VALUES (?, ?)")
        .run(parsed.siteId, parsed.startedAt);
      break;
    case "skipped":
      counts.skipped++;
      if (parsed.siteId) deletePending(parsed.siteId);
      break;
    case "rejected":
      counts.rejected++;
      console.warn(`  rejected: ${parsed.reason}`);
      break;
  }
}

export async function syncLichess(db: AccountDb, progress: (text: string) => void): Promise<SyncCounts> {
  const counts: SyncCounts = { added: 0, skipped: 0, rejected: 0 };
  const deletePending = (id: string) => db.db.prepare("DELETE FROM pending WHERE site_id = ?").run(id);

  // Step 1: every game created since the cursor, finished or not, oldest
  // first. The cursor is inclusive; games seen again are ignored.
  const cursor = Number(db.getMeta(CURSOR) ?? 0);
  const since = cursor > 0 ? `&since=${cursor}` : "";
  const url =
    `${LICHESS}/api/games/user/${encodeURIComponent(db.username)}` +
    `?finished=true&ongoing=true&sort=dateAsc&${EXPORT_OPTIONS}${since}`;
  const response = await fetch(url, { headers: HEADERS });
  checkResponse(response, "Lichess", `No Lichess player "${db.username}".`);

  let batch: { parsed: Parsed; createdAt?: number }[] = [];
  let newest = cursor;
  let seen = 0;
  const flush = () => {
    db.transaction(() => {
      for (const { parsed, createdAt } of batch) {
        apply(db, parsed, counts, deletePending);
        if (createdAt !== undefined && createdAt > newest) newest = createdAt;
      }
      db.setMeta(CURSOR, String(newest));
    });
    batch = [];
    progress(`${db.label}: ${seen} games read, ${counts.added} new`);
  };
  for await (const line of ndjsonLines(response)) {
    seen++;
    const parsed = parseLichess(line);
    const createdAt =
      parsed.kind === "game" ? parsed.record.startedAt : parsed.kind === "ongoing" ? parsed.startedAt : undefined;
    batch.push({ parsed, createdAt });
    if (batch.length >= BATCH) flush();
  }
  flush();

  // Step 2: the games pending since earlier syncs. Finished ones are stored,
  // unplayed or variant ones forgotten, the rest stay pending.
  const pending = (db.db.prepare("SELECT site_id FROM pending").all() as { site_id: string }[]).map(
    (row) => row.site_id,
  );
  for (let at = 0; at < pending.length; at += IDS_PER_REQUEST) {
    const ids = pending.slice(at, at + IDS_PER_REQUEST);
    const byIds = await fetch(`${LICHESS}/api/games/export/_ids?${EXPORT_OPTIONS}`, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "text/plain" },
      body: ids.join(","),
    });
    checkResponse(byIds, "Lichess", "Lichess export by IDs not found.");
    const parsedGames: Parsed[] = [];
    for await (const line of ndjsonLines(byIds)) parsedGames.push(parseLichess(line));
    db.transaction(() => {
      for (const parsed of parsedGames) apply(db, parsed, counts, deletePending);
    });
    progress(`${db.label}: ${pending.length} pending games checked, ${counts.added} new`);
  }
  return counts;
}
