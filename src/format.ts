/** Compact output helpers: markdown tables, money, truncation. */

/**
 * Text from the network (seller names, links, error messages) is untrusted: one line, no table breaks, capped.
 * It is shown as data, never followed as instructions.
 */
export function clean(value: unknown, max = 60): string {
  if (value === null || value === undefined) return "";
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g, " ")
    .replace(/\|/g, "¦")
    .replace(/`/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** USD with up to 4 significant digits: 0.005035485 → $0.005035, 2.837553 → $2.838. */
export function usd(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "—";
  return `$${Number(number.toPrecision(4))}`;
}

export const pct = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(digits)}%`;

export const num = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);

/** Large counts: 191017401 → 191.0M. */
export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
  return String(value);
}

/** Epoch ms → `2026-11-15 20:35:07Z`. */
export function time(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

export function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return "_(пусто)_";
  const line = (cells: string[]) => `| ${cells.map((cell) => cell || " ").join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

/** First `limit` items and a note about the rest. */
export function limited<T>(items: T[], limit: number): { shown: T[]; more: string } {
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  return { shown, more: rest > 0 ? `\n…ещё ${rest} (увеличьте limit или сузьте фильтр)` : "" };
}

/** Compact JSON for small nested values, with network strings cleaned. */
export function compactJson(value: unknown, maxLength = 1500): string {
  const text = JSON.stringify(value, (_key, item) => (typeof item === "string" ? clean(item, 200) : item));
  if (text === undefined) return "—";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
