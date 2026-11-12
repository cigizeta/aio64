/**
 * HTTP helpers shared by the two syncs. Every request is a GET of public
 * data (or Lichess's export by IDs, a POST that only reads); requests go one
 * at a time, as both sites ask.
 */

/** Generic on purpose: never a personal name or address. */
export const USER_AGENT = "Aio64 (personal chess analysis server)";

/** What one account's sync did. */
export interface SyncCounts {
  added: number;
  /** Aborted games, variants: not stored, not an error. */
  skipped: number;
  /** Illegal moves, malformed games: not stored, worth reporting. */
  rejected: number;
}

/** A sync failure whose message is shown to the developer as is. */
export class SyncError extends Error {}

/** Throws a SyncError for a response that is not OK (304 counts as OK). */
export function checkResponse(response: Response, site: string, notFound: string): void {
  if (response.ok || response.status === 304) return;
  if (response.status === 404) throw new SyncError(notFound);
  if (response.status === 429) throw new SyncError(`${site} rate limit: try again in a minute.`);
  throw new SyncError(`${site} answered HTTP ${response.status}.`);
}

/** The lines of an NDJSON response, read as they arrive. */
export async function* ndjsonLines(response: Response): AsyncGenerator<string> {
  if (!response.body) return;
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
      if (line) yield line;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}
