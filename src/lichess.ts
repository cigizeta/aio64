const LICHESS = "https://lichess.org";

/**
 * Verifies the Lichess token before the server starts. Aio64 must never hold
 * a token that can act on an account, so any scope at all is fatal: the
 * process exits and there is no override. Unknown tokens and an unreachable
 * Lichess are fatal too (fail closed). The token is never printed.
 *
 * Returns the token owner's username: the only player Aio64 explores and
 * lists, so it is never configured separately.
 */
export async function checkLichessToken(token: string): Promise<string> {
  let body: Record<string, { userId?: string; scopes?: string } | null>;
  try {
    const response = await fetch(`${LICHESS}/api/token/test`, { method: "POST", body: token });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = (await response.json()) as typeof body;
  } catch (error) {
    fatal(`cannot verify the Lichess token (${error instanceof Error ? error.message : String(error)}).`);
  }

  const info = body[token];
  if (!info) fatal("Lichess does not know this token (revoked or mistyped).");

  const scopes = info.scopes ?? "";
  if (scopes !== "") {
    fatal(
      [
        `THE LICHESS TOKEN HAS SCOPES: ${scopes}`,
        "Aio64 is read-only and refuses any token that can act on an account.",
        "Revoke this token at https://lichess.org/account/oauth/token",
        "and create a new one with NO scopes ticked.",
      ].join("\n"),
    );
  }

  if (!info.userId) fatal("the Lichess token has no owner.");

  // The token test gives the lowercase ID; the account gives the name as
  // written, for display. Reading one's own profile needs no scope.
  try {
    const response = await fetch(`${LICHESS}/api/account`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) return ((await response.json()) as { username?: string }).username ?? info.userId;
  } catch {
    // the ID is enough
  }
  return info.userId;
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}\n`);
  process.exit(1);
}

export interface Game {
  white: string;
  black: string;
  whiteRating?: number;
  blackRating?: number;
  result: string;
  opening?: string;
  initialFen?: string;
  moves: string[];
}

/** A user-facing refusal or failure; its message goes to Claude as is. */
export class GameError extends Error {}

const UNFINISHED = new Set(["created", "started"]);
const UNPLAYED = new Set(["aborted", "noStart"]);
const ACCEPTED_VARIANTS = new Set(["standard", "fromPosition"]);

/** Extracts the 8-character game ID from an ID or a Lichess game URL. */
export function parseGameId(input: string): string {
  const trimmed = input.trim();
  const path = /lichess\.org\/([A-Za-z0-9]+)/.exec(trimmed)?.[1] ?? trimmed;
  const id = path.slice(0, 8);
  if (!/^[A-Za-z0-9]{8}$/.test(id)) throw new GameError(`"${input}" is not a Lichess game ID or URL.`);
  return id;
}

interface ExportedGame {
  id?: string;
  speed?: string;
  lastMoveAt?: number;
  status?: string;
  variant?: string;
  initialFen?: string;
  moves?: string;
  winner?: "white" | "black";
  opening?: { name?: string };
  players?: Record<"white" | "black", { user?: { name?: string }; rating?: number; aiLevel?: number }>;
}

/** Fetches a finished standard game. Read-only: a single GET. */
export async function fetchGame(id: string, token: string): Promise<Game> {
  const url = `${LICHESS}/game/export/${id}?moves=true&clocks=false&evals=false&opening=true`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) throw new GameError(`No Lichess game with ID ${id}.`);
  if (response.status === 429) throw new GameError("Lichess rate limit; try again in a minute.");
  if (!response.ok) throw new GameError(`Lichess answered HTTP ${response.status}.`);

  const game = (await response.json()) as ExportedGame;
  if (!game.status || UNFINISHED.has(game.status)) {
    throw new GameError("This game is not finished; Aio64 analyzes finished games only.");
  }
  if (!ACCEPTED_VARIANTS.has(game.variant ?? "standard")) {
    throw new GameError("Only standard chess is supported.");
  }

  const name = (side: "white" | "black") => {
    const player = game.players?.[side];
    return player?.user?.name ?? (player?.aiLevel ? `Stockfish level ${player.aiLevel}` : "Anonymous");
  };
  const unplayed = UNPLAYED.has(game.status);
  const result =
    game.winner === "white" ? "1-0" : game.winner === "black" ? "0-1" : unplayed ? "*" : "1/2-1/2";

  return {
    white: name("white"),
    black: name("black"),
    whiteRating: game.players?.white.rating,
    blackRating: game.players?.black.rating,
    result,
    opening: game.opening?.name,
    initialFen: game.initialFen,
    moves: game.moves ? game.moves.split(" ") : [],
  };
}

export interface RecentGame {
  id: string;
  /** The listed player's color in this game. */
  color: "white" | "black";
  opponent: string;
  opponentRating?: number;
  /** From the listed player's point of view. */
  result: "win" | "draw" | "loss";
  speed: string;
  /** When the game ended (last move), in milliseconds. */
  endedAt?: number;
}

// Lichess orders the export by start date only, but a long correspondence
// game can end after many games started later. So the last RECENT_FETCH
// games by start are fetched (without moves: small) and sorted by end time
// (lastMoveAt), keeping RECENT_MAX. A game started before those is missed;
// accepted by the developer (50 games, about a second for one's own games).
const RECENT_FETCH = 50;
const RECENT_MAX = 10;
// Short, so that a game just finished on Lichess shows up within a minute.
const RECENT_CACHE_MS = 60_000;
const recentCache = new Map<string, { at: number; games: RecentGame[] }>();

/**
 * A player's finished standard games that ended most recently, newest end
 * first. Read-only. Lichess is asked for finished games only, so games in
 * progress never appear.
 */
export async function recentGames(player: string, token: string): Promise<RecentGame[]> {
  const key = player.toLowerCase();
  const hit = recentCache.get(key);
  if (hit && Date.now() - hit.at < RECENT_CACHE_MS) return hit.games;

  const url =
    `${LICHESS}/api/games/user/${encodeURIComponent(player)}` +
    `?max=${RECENT_FETCH}&moves=false&ongoing=false&finished=true`;
  const response = await fetch(url, {
    headers: { Accept: "application/x-ndjson", Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) throw new GameError(`No Lichess player "${player}".`);
  if (response.status === 429) throw new GameError("Lichess rate limit; try again in a minute.");
  if (!response.ok) throw new GameError(`Lichess answered HTTP ${response.status}.`);

  const games: RecentGame[] = [];
  for (const line of (await response.text()).split("\n")) {
    if (!line.trim()) continue;
    const game = JSON.parse(line) as ExportedGame;
    if (!game.id || !game.status || UNFINISHED.has(game.status) || UNPLAYED.has(game.status)) continue;
    if (!ACCEPTED_VARIANTS.has(game.variant ?? "standard")) continue;

    const color = game.players?.black.user?.name?.toLowerCase() === key ? "black" : "white";
    const opponent = game.players?.[color === "white" ? "black" : "white"];
    const result = !game.winner ? "draw" : game.winner === color ? "win" : "loss";
    games.push({
      id: game.id,
      color,
      opponent: opponent?.user?.name ?? (opponent?.aiLevel ? `Stockfish level ${opponent.aiLevel}` : "Anonymous"),
      opponentRating: opponent?.rating,
      result,
      speed: game.speed ?? "",
      endedAt: game.lastMoveAt,
    });
  }

  games.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const latest = games.slice(0, RECENT_MAX);
  recentCache.set(key, { at: Date.now(), games: latest });
  return latest;
}
