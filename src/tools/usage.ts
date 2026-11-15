import { z } from "zod";
import { fetchPeers, nameIndex } from "../catalog";
import { clean, count, limited, table, time, usd } from "../format";
import { defineTool, readOnly } from "./tool";

type Totals = { requests?: number; failedRequests?: number; spent?: string; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number };
type Usage = { from?: number; to?: number; totals?: Totals; groups?: Array<Totals & { group?: string; label?: string }> };
type Request = {
  tag?: string;
  startedAt?: number;
  keyLabel?: string;
  method?: string;
  path?: string;
  model?: string | null;
  status?: number;
  sellerPeerId?: string | null;
  latencyMs?: number | null;
  spent?: string | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
};

const GROUPS = ["hour", "day", "model", "key", "member", "peer", "workspace", "user"] as const;
const when = z.union([z.number().int().nonnegative(), z.string().min(1)]).optional();
const tokens = (t: Pick<Totals, "inputTokens" | "cachedInputTokens" | "outputTokens">) => `${count(t.inputTokens)} / ${count(t.cachedInputTokens)} / ${count(t.outputTokens)}`;

export const usage = defineTool({
  name: "usage",
  title: "Расход",
  description:
    "Расход gateway (GET /usage) с группировкой: hour, day, model, key, member, peer, workspace, user. " +
    "from/to — epoch ms или ISO-дата (по умолчанию последние 30 дней). Для peer рядом с ID показывается имя продавца.",
  inputSchema: {
    groupBy: z.enum(GROUPS).describe("Группировка"),
    from: when.describe("Начало: epoch ms или ISO-дата"),
    to: when.describe("Конец: epoch ms или ISO-дата"),
    limit: z.number().int().positive().max(500).default(30),
  },
  annotations: readOnly("Расход"),
  async run(args, { client }) {
    const [data, peers] = await Promise.all([
      client.get<Usage>("/usage", { groupBy: args.groupBy, from: args.from, to: args.to }),
      args.groupBy === "peer" ? fetchPeers(client) : Promise.resolve([]),
    ]);
    const names = nameIndex(peers);
    const t = data.totals ?? {};
    const groups = [...(data.groups ?? [])].sort((a, b) => Number(b.spent ?? 0) - Number(a.spent ?? 0));
    const { shown, more } = limited(groups, args.limit);
    return [
      `Период ${time(data.from)} — ${time(data.to)}: запросов ${t.requests ?? 0} (ошибок ${t.failedRequests ?? 0}), потрачено ${usd(t.spent)}, токены вход/кэш/выход ${tokens(t)}`,
      "",
      table(
        [args.groupBy, "запросов", "ошибок", "потрачено", "вход/кэш/выход"],
        shown.map((g) => {
          const name = args.groupBy === "peer" ? names.get((g.group ?? "").toLowerCase()) : undefined;
          return [`${clean(g.label ?? g.group, 80)}${name ? ` (${clean(name, 40)})` : ""}`, String(g.requests ?? 0), String(g.failedRequests ?? 0), usd(g.spent), tokens(g)];
        }),
      ) + more,
    ].join("\n");
  },
});

const PAGE = 200;
const MAX_PAGES = 5;
const failed = (r: Request) => (r.status ?? 0) >= 400 || Boolean(r.errorCode);

export const recent_requests = defineTool({
  name: "recent_requests",
  title: "Журнал запросов",
  description:
    "Последние запросы через gateway (GET /requests), новые сверху: ключ, путь, модель, статус, продавец, задержка, цена, токены, ошибка. " +
    "failedOnly оставляет только ошибки (просматривает до 1000 последних запросов).",
  inputSchema: {
    limit: z.number().int().positive().max(200).default(20),
    failedOnly: z.boolean().default(false),
  },
  annotations: readOnly("Журнал запросов"),
  async run(args, { client }) {
    const found: Request[] = [];
    let before: string | undefined;
    for (let page = 0; page < (args.failedOnly ? MAX_PAGES : 1); page++) {
      const data = await client.get<{ requests?: Request[]; nextBefore?: string | null }>("/requests", { limit: args.failedOnly ? PAGE : args.limit, before });
      found.push(...(data.requests ?? []).filter((r) => !args.failedOnly || failed(r)));
      before = data.nextBefore ?? undefined;
      if (found.length >= args.limit || !before) break;
    }
    const rows = found.slice(0, args.limit);
    if (!rows.length) return args.failedOnly ? "Ошибочных запросов среди последних не найдено." : "Журнал пуст.";
    const names = rows.some((r) => r.sellerPeerId) ? nameIndex(await fetchPeers(client)) : new Map<string, string>();
    return table(
      ["время", "ключ", "запрос", "модель", "статус", "продавец", "мс", "цена", "вход/кэш/выход", "ошибка"],
      rows.map((r) => [
        time(r.startedAt),
        clean(r.keyLabel, 30),
        `${clean(r.method, 8)} ${clean(r.path, 40)}`,
        clean(r.model, 40) || "—",
        String(r.status ?? "—"),
        r.sellerPeerId ? `${clean(names.get(r.sellerPeerId.toLowerCase()), 30) || "?"} ${r.sellerPeerId}` : "—",
        String(r.latencyMs ?? "—"),
        usd(r.spent),
        tokens(r),
        r.errorCode || r.errorMessage ? `${clean(r.errorCode, 30)} ${clean(r.errorMessage, 120)}`.trim() : "",
      ]),
    );
  },
});
