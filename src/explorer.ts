import { GameError } from "./lichess.js";
import { note } from "./log.js";

/**
 * The Lichess opening explorer's PLAYER database: one player's own games.
 * This is the only explorer URL in Aio64. The Masters and Lichess databases
 * must never be queried (developer's rule), so no code builds any other
 * explorer path.
 */
const PLAYER_DATABASE = "https://explorer.lichess.ovh/player";

// Lichess re-checks a player for new games through a global queue that
// moves slowly (measured: about 5 places in 20 s), sending updated lines on
// the same connection; one connection kept open is gentler than new requests.
const STREAM_TIMEOUT_MS = 120_000;
const CACHE_MS = 10 * 60_000;
const RECENT_GAMES = 8;

export interface ExplorerMove {
  uci: string;
  san: string;
  games: number;
  /** Results from the explored player's point of view. */
  wins: number;
  draws: number;
  losses: number;
  performance?: number;
}

export interface RecentGame {
  id: string;
  opponent: string;
  opponentRating?: number;
  /** From the explored player's point of view: "win", "draw", "loss". */
  result: "win" | "draw" | "loss";
  speed: string;
  month: string;
}

export interface Exploration {
  moves: ExplorerMove[];
  recentGames: RecentGame[];
  /**
   * True while the player waits in Lichess's indexing queue for a re-check
   * for new games (queuePosition > 0). The data already covers every game
   * up to the previous indexing; only games played since may be missing.
   */
  indexing: boolean;
  /** True while the Lichess stream is still open: a fuller answer may come. */
  updating: boolean;
}

interface RawMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  performance?: number;
}

interface RawGame {
  id: string;
  winner?: "white" | "black" | null;
  speed: string;
  month: string;
  white: { name: string; rating?: number };
  black: { name: string; rating?: number };
}

interface RawExploration {
  moves?: RawMove[];
  recentGames?: RawGame[];
  /** Above 0 while the player's games wait to be indexed by Lichess. */
  queuePosition?: number;
}

const cache = new Map<string, { at: number; value: Exploration }>();

/**
 * Searches whose Lichess stream is still open; the widget polls these. At
 * most a few stay open (stepping through positions opens one each); a new
 * stream closes the oldest, whose last answer stays cached.
 */
const open = new Map<string, AbortController>();
const MAX_OPEN_STREAMS = 3;

/**
 * Answers as soon as Lichess sends its first line. Lichess keeps the
 * connection open after that (measured: first line in 0.2 to 1 s, then
 * nothing until our timeout), and may send more complete lines while it
 * scans the player's games; those keep arriving in the background and only
 * update the cache. While the stream is open, answers say `updating`, and
 * the widget asks again to pick up the fuller answer from the cache.
 */
export function explorePlayer(
  player: string,
  color: "white" | "black",
  fen: string,
  token: string,
): Promise<Exploration> {
  const key = `${player.toLowerCase()}|${color}|${fen}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    note("cached");
    return Promise.resolve({ ...hit.value, updating: open.has(key) });
  }

  const url = new URL(PLAYER_DATABASE);
  url.searchParams.set("player", player);
  url.searchParams.set("color", color);
  url.searchParams.set("fen", fen);
  url.searchParams.set("recentGames", String(RECENT_GAMES));

  return new Promise<Exploration>((resolve, reject) => {
    let answered = false;

    const deliver = (raw: RawExploration) => {
      const value = convert(raw, color);
      cache.set(key, { at: Date.now(), value });
      if (!answered) {
        answered = true;
        note("lichess");
        resolve({ ...value, updating: true });
      }
    };

    const controller = new AbortController();
    open.set(key, controller);
    while (open.size > MAX_OPEN_STREAMS) {
      const [oldestKey, oldest] = open.entries().next().value!;
      oldest.abort();
      open.delete(oldestKey);
    }
    const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

    void (async () => {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (response.status === 404) throw new GameError(`No Lichess player "${player}".`);
        if (response.status === 429) throw new GameError("Lichess rate limit; try again in a minute.");
        if (!response.ok || !response.body) throw new GameError(`Lichess explorer answered HTTP ${response.status}.`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) deliver(JSON.parse(line) as RawExploration);
          }
        }
        if (buffer.trim()) deliver(JSON.parse(buffer) as RawExploration);
      } catch (error) {
        // The background timeout after an answer is the normal end.
        if (!answered) reject(error);
      } finally {
        if (open.get(key) === controller) open.delete(key);
        clearTimeout(timer);
        if (!answered) resolve(convert({}, color));
      }
    })();
  });
}

function convert(raw: RawExploration, color: "white" | "black"): Exploration {
  const indexing = (raw.queuePosition ?? 0) > 0;
  const asWhite = color === "white";
  return {
    moves: (raw.moves ?? []).map((m) => ({
      uci: m.uci,
      san: m.san,
      games: m.white + m.draws + m.black,
      wins: asWhite ? m.white : m.black,
      draws: m.draws,
      losses: asWhite ? m.black : m.white,
      performance: m.performance,
    })),
    recentGames: (raw.recentGames ?? []).map((g) => {
      const opponent = asWhite ? g.black : g.white;
      const result = !g.winner ? "draw" : (g.winner === "white") === asWhite ? "win" : "loss";
      return {
        id: g.id,
        opponent: opponent.name,
        opponentRating: opponent.rating,
        result,
        speed: g.speed,
        month: g.month,
      };
    }),
    indexing,
    updating: false,
  };
}
