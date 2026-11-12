import { closeSync, createReadStream, openSync, readSync } from "node:fs";
import { createInterface } from "node:readline";
import { createZstdDecompress } from "node:zlib";

/**
 * PGN reading, shared by the Chess.com sync (one game's PGN) and the
 * master build (whole collections, possibly gigabytes, read as a stream).
 */

/** The PGN's tag values, by name. */
export function pgnTags(pgn: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const match of pgn.matchAll(/^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) tags.set(match[1], match[2]);
  return tags;
}

/** The PGN's moves as SAN: tags, comments, variations, NAGs, move numbers
 * and the result removed. */
export function pgnMoves(pgn: string): string[] {
  const body = pgn
    .replace(/^\[.*\]\s*$/gm, "")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;[^\n]*/g, " ")
    .replace(/\$\d+/g, " ");
  return removeVariations(body)
    .split(/\s+/)
    .map((token) => token.replace(/^\d+\.(\.\.)?/, "").replace(/[!?]+$/, ""))
    .filter((token) => token && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token));
}

/** Movetext without its variations, nested ones included. */
function removeVariations(text: string): string {
  // Most games have none: skip the character walk (millions of games).
  if (!text.includes("(")) return text;
  let depth = 0;
  let out = "";
  for (const c of text) {
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  return out;
}

/** Every zstd frame starts with these four bytes (RFC 8878). */
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function isZstd(path: string): boolean {
  const head = Buffer.alloc(4);
  const fd = openSync(path, "r");
  try {
    const read = readSync(fd, head, 0, 4, 0);
    return read === 4 && ZSTD_MAGIC.every((byte, i) => head[i] === byte);
  } finally {
    closeSync(fd);
  }
}

/**
 * The games of a PGN file, one text each, read line by line so that a
 * collection of any size fits in memory. A game ends where the next one's
 * tags begin. A leading byte order mark is ignored. A zstd-compressed file
 * is detected from its content, whatever its name, and decompressed as it
 * is read (collections are often shipped compressed), so no decompressed
 * copy is ever written; a plain PGN is read as is.
 */
export async function* readGames(path: string): AsyncGenerator<string> {
  const file = createReadStream(path);
  const input = isZstd(path) ? file.pipe(createZstdDecompress()) : file;
  input.setEncoding("utf8");
  const lines = createInterface({ input, crlfDelay: Infinity });
  let game: string[] = [];
  let inMoves = false;
  let first = true;
  for await (let line of lines) {
    if (first) {
      line = line.replace(/^﻿/, "");
      first = false;
    }
    if (line.startsWith("[") && inMoves) {
      yield game.join("\n");
      game = [];
      inMoves = false;
    }
    if (line.trim() && !line.startsWith("[")) inMoves = true;
    game.push(line);
  }
  if (game.some((line) => line.trim())) yield game.join("\n");
}
