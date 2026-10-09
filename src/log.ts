import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The request log: one line per tool call, with its time, duration and an
 * outcome note set by the code that handled it ("cached", "depth 20",
 * "ERROR ..."). Protocol traffic and the widget's viewer_status checks are
 * not logged.
 */
const current = new AsyncLocalStorage<{ note?: string }>();

/** Sets the outcome note of the tool call being handled, if any. */
export function note(text: string): void {
  const context = current.getStore();
  if (context) context.note = text;
}

/** Runs one request with its own note. */
export function withNote<T>(run: () => T): { result: T; note: () => string | undefined } {
  const context: { note?: string } = {};
  const result = current.run(context, run);
  return { result, note: () => context.note };
}

function time(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function logLine(text: string): void {
  console.log(`${time()}  ${text}`);
}

export function logCall(tool: string, ms: number | undefined, outcome?: string): void {
  const duration = ms === undefined ? "-" : `${ms} ms`;
  logLine(`${tool.padEnd(18)} ${duration.padStart(8)}${outcome ? `  ${outcome}` : ""}`);
}
