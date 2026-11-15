import { describe, expect, test } from "bun:test";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { normalizeModelId, resolveModel, type Model, type Peer } from "../src/catalog";
import { createClient, type Fetch } from "../src/client";
import type { Config } from "../src/config";
import { createServer, READ_TOOLS, WRITE_TOOLS } from "../src/server";
import { model_sellers, modelSellers } from "../src/tools/sellers";
import { routing_allow_peers } from "../src/tools/routing";
import { callTool, type Context } from "../src/tools/tool";

const peers: Peer[] = await Bun.file(new URL("../fixtures/peers.json", import.meta.url)).json();
const models: Model[] = await Bun.file(new URL("../fixtures/models.json", import.meta.url)).json();

const TOKEN = "antseed_admin_TESTSECRET_0123456789";
const APEX = "73b4c9335fa239f9c6df3d28d5bf5d3cdf4de736";
const SUPER = "d19ffae0e85b5230422019926b2f37ec0f1f41f3";
const GESUND = "983e9de990b9ac8d36d373db5d0b49a4d7f7d826";

const config = (overrides: Partial<Config> = {}): Config => ({
  url: "https://gw.test",
  token: TOKEN,
  allowWrites: false,
  timeoutMs: 1000,
  ...overrides,
});

type Call = { method: string; path: string; auth: string | null; body?: unknown };

/** Fake gateway: fixtures for GET, the stored policy for /routing, and `override` for anything special. */
function gateway(override?: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  let policy: Record<string, unknown> = { allowedPeerIds: [APEX, SUPER], sort: "price", minTrust: 60 };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  const fetch: Fetch = async (input, init) => {
    const url = new URL(input);
    const call: Call = {
      method: init.method ?? "GET",
      path: url.pathname.replace("/console/api", "") + url.search,
      auth: new Headers(init.headers).get("authorization"),
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    };
    calls.push(call);
    const special = override?.(call);
    if (special) return special;
    if (call.path === "/peers") return json(peers);
    if (call.path === "/models") return json(models);
    if (call.path === "/routing" && call.method === "PUT") return json((policy = call.body as Record<string, unknown>));
    if (call.path === "/routing") return json(policy);
    if (call.path === "/status") return json({ version: "0.1.248", buyer: { reachable: true, peers: 9, dhtNodes: 10 } });
    if (call.path.startsWith("/usage")) return json({ from: 0, to: 1, totals: { requests: 1, spent: "0.5" }, groups: [{ group: APEX, label: APEX, requests: 1, spent: "0.5" }] });
    if (call.path.startsWith("/requests"))
      return json({ requests: [{ tag: "gw_1", startedAt: 1, path: "/v1/chat/completions", model: "gpt-6-luna", status: 502, sellerPeerId: APEX, errorCode: "peer_error" }], nextBefore: null });
    return json({ error: { code: "not_found", message: "No such console API route" } }, 404);
  };
  return { fetch, calls, policy: () => policy };
}

const contextWith = (fake: ReturnType<typeof gateway>, overrides: Partial<Config> = {}): Context => {
  const cfg = config(overrides);
  return { client: createClient(cfg, fake.fetch), config: cfg, now: () => 1_794_760_000_000 };
};
const text = (result: CallToolResult) => result.content.map((item) => (item.type === "text" ? item.text : "")).join("\n");

describe("model IDs", () => {
  test("grok-4.7, grok-4-7 and xai/grok-4.7 normalize to one ID", () => {
    expect(new Set(["grok-4.7", "grok-4-7", "xai/grok-4.7", "x-ai/grok-4.7", "GROK-4.7"].map(normalizeModelId))).toEqual(new Set(["grok47"]));
    for (const query of ["grok-4.7", "grok-4-7", "xai/grok-4.7"]) expect(resolveModel(models, query).model?.id).toBe("grok-4-7");
  });

  test("model_sellers merges a seller's services under both spellings", () => {
    const { rows } = modelSellers({ peers, models, allowed: new Set(), query: "xai/grok-4.7", now: 0 });
    expect(rows.find((row) => row.peerId === SUPER)?.services.sort()).toEqual(["grok-4-7", "grok-4.7"]);
    expect(rows.some((row) => row.services.includes("x-ai/grok-4.7"))).toBe(true);
  });
});

describe("model_sellers", () => {
  test("sorts by input + output, marks policy and share of the official price", () => {
    const { rows } = modelSellers({ peers, models, allowed: new Set([APEX, SUPER]), query: "gpt-6-luna", official: { input: 0.1, output: 0.5 }, now: 0 });
    const totals = rows.map((row) => (row.input ?? 0) + (row.output ?? 0));
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    const byId = new Map(rows.map((row) => [row.peerId, row]));
    expect(byId.get(APEX)).toMatchObject({ allowed: true, health: "healthy", ofOfficial: { input: 0.6, output: 0.62 } });
    expect(byId.get(GESUND)!.allowed).toBe(false);
    expect(byId.get(SUPER)!.ofOfficial!.input).toBeGreaterThan(1);
    expect(rows.some((row) => row.health === "failing")).toBe(true);
  });

  test("tool output lists sellers with the % of official column", async () => {
    const result = await callTool(model_sellers, { model: "gpt-6-luna", officialInput: 0.1, officialOutput: 0.5 }, contextWith(gateway()));
    expect(result.isError).toBeUndefined();
    expect(text(result)).toContain("% офиц.");
    expect(text(result)).toContain(`| Apex Ant | ${APEX} |`);
  });

  test("one official price without the other is an error", async () => {
    const result = await callTool(model_sellers, { model: "gpt-6-luna", officialInput: 0.1 }, contextWith(gateway()));
    expect(result.isError).toBe(true);
  });
});

describe("routing_allow_peers", () => {
  test("dryRun (default) shows the diff and writes nothing", async () => {
    const fake = gateway();
    const result = await callTool(routing_allow_peers, { add: [GESUND] }, contextWith(fake, { allowWrites: true }));
    expect(text(result)).toContain("dryRun");
    expect(fake.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  test("a write changes only allowedPeerIds and keeps the other fields", async () => {
    const fake = gateway();
    const result = await callTool(routing_allow_peers, { add: [GESUND.toUpperCase()], remove: [SUPER], dryRun: false }, contextWith(fake, { allowWrites: true }));
    expect(result.isError).toBeUndefined();
    expect(fake.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
    expect(fake.policy()).toEqual({ allowedPeerIds: [APEX, GESUND], sort: "price", minTrust: 60 });
  });

  test("refuses to leave the allow list empty", async () => {
    const fake = gateway();
    const result = await callTool(routing_allow_peers, { remove: [APEX, SUPER], dryRun: false }, contextWith(fake, { allowWrites: true }));
    expect(result.isError).toBe(true);
    expect(fake.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  test("is not registered without ANTSEED_ALLOW_WRITES", async () => {
    const names = async (allowWrites: boolean) => {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await createServer(contextWith(gateway(), { allowWrites })).connect(serverSide);
      const client = new McpClient({ name: "test", version: "0" });
      await client.connect(clientSide);
      const { tools } = await client.listTools();
      await client.close();
      return tools.map((tool) => tool.name);
    };
    expect(await names(false)).not.toContain("routing_allow_peers");
    expect(await names(true)).toContain("routing_allow_peers");
  });
});

describe("errors and the token", () => {
  test("API errors become isError results", async () => {
    const fake = gateway((call) => (call.path === "/peers" ? new Response(JSON.stringify({ error: { code: "forbidden", message: "Token lacks scope" } }), { status: 403 }) : undefined));
    const result = await callTool(model_sellers, { model: "gpt-6-luna" }, contextWith(fake));
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("403 forbidden: Token lacks scope");
  });

  test("network failures become isError results", async () => {
    const context: Context = { client: createClient(config(), async () => { throw new TypeError("fetch failed"); }), config: config() };
    const result = await callTool(READ_TOOLS[0]!, {}, context);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("fetch failed");
  });

  test("the token is sent as a bearer header and never appears in any output", async () => {
    const args: Record<string, unknown> = {
      model_sellers: { model: "gpt-6-luna", officialInput: 0.1, officialOutput: 0.5 },
      find_peers: { model: "grok-4.7" },
      peer: { peer: "apex" },
      search_models: { query: "grok" },
      usage: { groupBy: "peer" },
      recent_requests: { failedOnly: true },
      routing_allow_peers: { add: [GESUND] },
    };
    const outputs: string[] = [];
    for (const echo of [false, true]) {
      // The second pass has the API echo the token back in every error.
      const fake = gateway(echo ? () => new Response(JSON.stringify({ error: { code: "bad", message: `bad token ${TOKEN}` } }), { status: 401 }) : undefined);
      const context = contextWith(fake, { allowWrites: true });
      for (const tool of [...READ_TOOLS, ...WRITE_TOOLS]) outputs.push(text(await callTool(tool, args[tool.name] ?? {}, context)));
      expect(fake.calls.every((call) => call.auth === `Bearer ${TOKEN}`)).toBe(true);
    }
    expect(outputs.length).toBe(18);
    for (const output of outputs) expect(output).not.toContain("TESTSECRET");
    expect(outputs.at(-1)).toContain("<redacted>");
  });
});
