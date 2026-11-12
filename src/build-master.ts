import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync, DIRECTORY } from "./db.js";
import { checkHash } from "./hash.js";
import { pgnMoves, pgnTags, readGames } from "./pgn.js";
import { isStandardStart, replay } from "./record.js";

/**
 * Builds the master database from PGN files:
 *   npm run build-master -- <file.pgn> [<file.pgn> ...]
 *
 * Run by hand from the command line, never by the server or an MCP tool;
 * the server only reads the result. Always a full rebuild: PGN games have
 * no reliable ID, so appending could count games twice, and the database
 * always matches exactly the files given. It is built in a temporary file
 * and replaces games/master.sqlite only once complete.
 *
 * Only totals are kept: for each position up to MAX_PLY and each move
 * played from it, how many games White won, drew, or Black won. A
 * collection of millions of games would take gigabytes as stored games.
 */

const MAX_PLY = 40;
const SCHEMA_VERSION = "1";
/** Totals kept in memory before being added to the file. */
const FLUSH_PAIRS = 1_000_000;
const PROGRESS_GAMES = 10_000;

const FINAL = fileURLToPath(new URL("master.sqlite", DIRECTORY));
const TEMPORARY = `${FINAL}.tmp`;

type Totals = { white: number; draws: number; black: number };

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log("Usage: npm run build-master -- <file.pgn> [<file.pgn> ...]");
    process.exit(1);
  }
  checkHash();
  for (const file of files) {
    if (!existsSync(file) || !statSync(file).isFile()) {
      console.error(`Not a file: ${file}`);
      process.exit(1);
    }
  }

  if (existsSync(FINAL)) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await prompt.question("Replace games/master.sqlite? [Y/n] ")).trim().toLowerCase();
    prompt.close();
    if (answer !== "" && answer !== "y" && answer !== "yes") {
      console.log("Nothing changed.");
      return;
    }
  }

  mkdirSync(DIRECTORY, { recursive: true });
  rmSync(TEMPORARY, { force: true });
  const db = new DatabaseSync(TEMPORARY);
  // A temporary file: a crash only loses the build, so no journal.
  db.exec("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;");
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
    CREATE TABLE moves (
      hash INTEGER NOT NULL,
      next TEXT NOT NULL,
      white INTEGER NOT NULL,
      draws INTEGER NOT NULL,
      black INTEGER NOT NULL,
      PRIMARY KEY (hash, next)
    ) WITHOUT ROWID;
  `);
  const upsert = db.prepare(`
    INSERT INTO moves (hash, next, white, draws, black) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (hash, next) DO UPDATE SET
      white = white + excluded.white, draws = draws + excluded.draws, black = black + excluded.black
  `);

  // Key: the hash and the move, "hash move".
  const totals = new Map<string, Totals>();
  const flush = () => {
    db.exec("BEGIN");
    for (const [key, t] of totals) {
      const space = key.indexOf(" ");
      upsert.run(BigInt(key.slice(0, space)), key.slice(space + 1), t.white, t.draws, t.black);
    }
    db.exec("COMMIT");
    totals.clear();
  };

  const started = Date.now();
  let kept = 0;
  let skipped = 0;
  let rejected = 0;
  for (const file of files) {
    console.log(`Reading ${file}`);
    for await (const pgn of readGames(file)) {
      const tags = pgnTags(pgn);
      const result = tags.get("Result");
      const variant = (tags.get("Variant") ?? "standard").toLowerCase();
      if ((result !== "1-0" && result !== "0-1" && result !== "1/2-1/2") || !["standard", "from position"].includes(variant)) {
        skipped++;
        continue;
      }
      const fen = tags.get("SetUp") === "1" ? tags.get("FEN") : undefined;
      let positions;
      try {
        positions = replay(fen && !isStandardStart(fen) ? fen : undefined, pgnMoves(pgn).slice(0, MAX_PLY)).positions;
      } catch {
        rejected++;
        continue;
      }
      kept++;
      // A game counts once per position and move, even if it repeats them.
      const seen = new Set<string>();
      for (const { hash, next } of positions) {
        if (!next) continue;
        const key = `${hash} ${next}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let t = totals.get(key);
        if (!t) totals.set(key, (t = { white: 0, draws: 0, black: 0 }));
        if (result === "1-0") t.white++;
        else if (result === "0-1") t.black++;
        else t.draws++;
      }
      if (totals.size >= FLUSH_PAIRS) flush();
      if ((kept + skipped + rejected) % PROGRESS_GAMES === 0) {
        console.log(`  ${kept + skipped + rejected} games, ${((Date.now() - started) / 60000).toFixed(1)} min`);
      }
    }
  }
  flush();

  const pairs = Number((db.prepare("SELECT count(*) AS n FROM moves").get() as { n: number | bigint }).n);
  const meta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  for (const [key, value] of [
    ["schema_version", SCHEMA_VERSION],
    ["max_ply", String(MAX_PLY)],
    ["files", files.join("\n")],
    ["games", String(kept)],
    ["skipped", String(skipped)],
    ["rejected", String(rejected)],
    ["built_at", new Date().toISOString()],
  ]) {
    meta.run(key, value);
  }
  db.close();

  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  const megabytes = Math.round(statSync(TEMPORARY).size / 1_048_576);
  console.log(
    `Done in ${minutes} min: ${kept} games kept, ${skipped} skipped, ${rejected} rejected; ` +
      `${pairs} positions and moves, ${megabytes} MB.`,
  );

  try {
    renameSync(TEMPORARY, FINAL);
  } catch (error) {
    // Windows refuses to replace a file the running server holds open.
    console.error(
      `Could not replace games/master.sqlite (${error instanceof Error ? error.message : String(error)}).\n` +
        "The new build is kept in games/master.sqlite.tmp. If the server is running, stop it, then:\n" +
        "  mv games/master.sqlite.tmp games/master.sqlite",
    );
    process.exit(1);
  }
  console.log("games/master.sqlite is ready. Restart the server to use it.");
}

await main();
