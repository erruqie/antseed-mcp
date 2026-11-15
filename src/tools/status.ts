import { clean } from "../format";
import { defineTool, readOnly } from "./tool";

type Status = {
  version?: string;
  publicUrl?: string;
  buyer?: { reachable?: boolean; peers?: number; dhtNodes?: number; uptimeMs?: number };
  spendFeed?: string;
  exposure?: { mode?: string; reachableFromInternet?: boolean };
};

export const status = defineTool({
  name: "status",
  title: "Состояние AntSeed Gateway",
  description: "Состояние нашего AntSeed Gateway: версия, доступность покупателя (buyer), число видимых продавцов и DHT-узлов, режим доступа.",
  inputSchema: {},
  annotations: readOnly("Состояние AntSeed Gateway"),
  async run(_args, { client, config }) {
    const s = await client.get<Status>("/status");
    const uptimeH = typeof s.buyer?.uptimeMs === "number" ? `${(s.buyer.uptimeMs / 3_600_000).toFixed(1)} ч` : "—";
    return [
      `Gateway ${config.url}: версия ${clean(s.version) || "—"}, publicUrl ${clean(s.publicUrl, 120) || "—"}`,
      `Покупатель: ${s.buyer?.reachable ? "доступен" : "НЕДОСТУПЕН"}, продавцов ${s.buyer?.peers ?? "—"}, DHT-узлов ${s.buyer?.dhtNodes ?? "—"}, аптайм ${uptimeH}`,
      `Доступ: ${clean(s.exposure?.mode) || "—"}${s.exposure?.reachableFromInternet ? " (из интернета)" : ""}; spendFeed ${clean(s.spendFeed) || "—"}`,
    ].join("\n");
  },
});
