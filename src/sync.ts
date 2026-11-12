import { AccountDb } from "./db.js";
import { SyncError, type SyncCounts } from "./http.js";
import { logLine } from "./log.js";
import type { Parsed, Site } from "./record.js";
import { parseChesscom, syncChesscom } from "./sync-chesscom.js";
import { parseLichess, syncLichess } from "./sync-lichess.js";

/**
 * The accounts in .env and their sync. A sync is always asynchronous: it
 * runs in the background, one account after another, and the widget polls
 * its status. Only one runs at a time. One account's failure never stops
 * the others.
 */

export interface Account {
  site: Site;
  username: string;
}

/** Both sites allow letters, digits, `_` and `-` in usernames. */
const USERNAME = /^[A-Za-z0-9_-]{2,30}$/;

/** The accounts listed in LICHESS_USERS and CHESSCOM_USERS (comma-separated). */
export function accountsFromEnv(): Account[] {
  const list = (variable: string, site: Site): Account[] =>
    (process.env[variable] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .map((username) => {
        if (!USERNAME.test(username)) throw new Error(`${variable}: "${username}" is not a valid username`);
        return { site, username };
      });
  return [...list("LICHESS_USERS", "lichess"), ...list("CHESSCOM_USERS", "chesscom")];
}

function reparse(site: Site, source: string): Parsed {
  return site === "lichess" ? parseLichess(source) : parseChesscom(source);
}

const databases = new Map<string, AccountDb>();

/** The account's database, opened once and kept. */
export function accountDb(account: Account): AccountDb {
  const key = `${account.site}/${account.username.toLowerCase()}`;
  let db = databases.get(key);
  if (!db) {
    db = new AccountDb(account.site, account.username, reparse);
    databases.set(key, db);
  }
  return db;
}

export interface AccountSummary extends SyncCounts {
  account: string;
  error?: string;
}

/** What the widget sees through sync_status. Server memory only. */
export const syncStatus: {
  running: boolean;
  progress: string;
  summary: AccountSummary[];
  finishedAt?: number;
} = { running: false, progress: "", summary: [] };

/** Starts a sync of every account in the background. */
export function startSync(accounts: Account[]): "started" | "already running" {
  if (syncStatus.running) return "already running";
  syncStatus.running = true;
  syncStatus.progress = "starting";
  syncStatus.summary = [];
  void runSync(accounts);
  return "started";
}

async function runSync(accounts: Account[]): Promise<void> {
  const progress = (text: string) => {
    syncStatus.progress = text;
    logLine(`sync  ${text}`);
  };
  try {
    for (const account of accounts) {
      const db = accountDb(account);
      progress(`${db.label}: starting`);
      try {
        const counts =
          account.site === "lichess" ? await syncLichess(db, progress) : await syncChesscom(db, progress);
        syncStatus.summary.push({ account: db.label, ...counts });
        progress(
          `${db.label}: ${counts.added} new, ${counts.skipped} skipped, ${counts.rejected} rejected; ` +
            `${db.countGames()} stored`,
        );
      } catch (error) {
        const message =
          error instanceof SyncError ? error.message : `unexpected error: ${error instanceof Error ? error.message : String(error)}`;
        syncStatus.summary.push({ account: db.label, added: 0, skipped: 0, rejected: 0, error: message });
        progress(`${db.label}: ${message}`);
      }
    }
  } finally {
    syncStatus.running = false;
    syncStatus.finishedAt = Date.now();
    syncStatus.progress = "done";
  }
}
