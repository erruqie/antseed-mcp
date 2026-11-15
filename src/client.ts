import type { Config } from "./config";

/** An error from the Management API or the way to it; its message never holds the token. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Query = Record<string, string | number | undefined>;

export type Client = {
  get<T>(path: string, query?: Query): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
};

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const API_PREFIX = "/console/api";

/** Replaces every occurrence of `secret` in `text`. */
export const redact = (text: string, secret: string) => (secret ? text.split(secret).join("<redacted>") : text);

/**
 * The only place that knows the gateway URL and the token. Only `/console/api/*` is reachable: model calls (`/v1/*`)
 * are out of scope for this server.
 */
export function createClient(config: Pick<Config, "url" | "token" | "timeoutMs">, fetchImpl: Fetch = fetch): Client {
  async function request<T>(method: "GET" | "PUT", path: string, query?: Query, body?: unknown): Promise<T> {
    if (!path.startsWith("/") || path.includes("..")) throw new ApiError(`Invalid API path: ${path}`);
    const url = new URL(config.url + API_PREFIX + path);
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    const where = `${method} ${API_PREFIX}${path}`;

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${config.token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      const reason = name === "TimeoutError" || name === "AbortError" ? `timed out after ${config.timeoutMs} ms` : String((error as Error)?.message ?? error);
      throw new ApiError(redact(`${where}: ${reason}`, config.token));
    }

    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    if (!response.ok) {
      const error = (json as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
      const code = typeof error?.code === "string" ? error.code : undefined;
      const detail = typeof error?.message === "string" ? error.message : text.slice(0, 200) || response.statusText;
      throw new ApiError(redact(`${where} → ${response.status}${code ? ` ${code}` : ""}: ${detail}`, config.token), response.status, code);
    }
    if (json === undefined) throw new ApiError(`${where}: response is not JSON`, response.status);
    return json as T;
  }

  return {
    get: (path, query) => request("GET", path, query),
    put: (path, body) => request("PUT", path, undefined, body),
  };
}
