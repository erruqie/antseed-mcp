import { readFile } from "node:fs/promises";

export type Config = {
  /** Gateway base URL without a trailing slash. */
  url: string;
  /** Management token (`antseed_admin_…`). Never print it. */
  token: string;
  allowWrites: boolean;
  timeoutMs: number;
};

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

async function readToken(env: Env): Promise<string> {
  const file = env.ANTSEED_ADMIN_TOKEN_FILE?.trim();
  if (file) {
    // node:fs instead of Bun.file: the npm build runs under Node (npx).
    const token = (await readFile(file, "utf8").catch(() => { throw new ConfigError(`ANTSEED_ADMIN_TOKEN_FILE is not readable: ${file}`); })).trim();
    if (!token) throw new ConfigError(`ANTSEED_ADMIN_TOKEN_FILE is empty: ${file}`);
    return token;
  }
  const token = env.ANTSEED_ADMIN_TOKEN?.trim();
  if (token) return token;
  throw new ConfigError("Set ANTSEED_ADMIN_TOKEN (or ANTSEED_ADMIN_TOKEN_FILE)");
}

export async function loadConfig(env: Env = process.env): Promise<Config> {
  const rawUrl = env.ANTSEED_URL?.trim();
  if (!rawUrl) throw new ConfigError("Set ANTSEED_URL to your gateway, e.g. https://gateway.example.com");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError(`ANTSEED_URL is not a URL: ${rawUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ConfigError("ANTSEED_URL must be http(s)");

  const timeoutMs = Number(env.ANTSEED_TIMEOUT_MS?.trim() || 30_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ConfigError("ANTSEED_TIMEOUT_MS must be a positive number");

  return {
    url: url.toString().replace(/\/+$/, ""),
    token: await readToken(env),
    allowWrites: env.ANTSEED_ALLOW_WRITES?.trim().toLowerCase() === "true",
    timeoutMs,
  };
}
