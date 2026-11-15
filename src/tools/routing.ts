import { z } from "zod";
import { fetchPeers, fetchRouting, isPeerId, type Peer, type RoutingPolicy } from "../catalog";
import { clean, compactJson, num, table } from "../format";
import { defineTool, readOnly, ToolError } from "./tool";

const peerTable = (ids: string[], peers: Map<string, Peer>, mark?: (id: string) => string) =>
  table(
    [...(mark ? [""] : []), "продавец", "peerId", "trust", "в сети"],
    ids.map((id) => {
      const peer = peers.get(id.toLowerCase());
      return [...(mark ? [mark(id)] : []), clean(peer?.displayName, 40) || "?", id, peer ? num(peer.trustScore) + (peer.verified ? " ✓" : "") : "—", peer ? "да" : "НЕТ"];
    }),
  );

const byId = (peers: Peer[]) => new Map(peers.map((peer) => [peer.peerId.toLowerCase(), peer]));
const peerIdLists = (policy: RoutingPolicy) =>
  Object.entries(policy).filter((entry): entry is [string, string[]] => /PeerIds$/.test(entry[0]) && Array.isArray(entry[1]));

export const routing = defineTool({
  name: "routing",
  title: "Политика маршрутизации",
  description:
    "Текущая политика маршрутизации gateway (GET /routing): сортировка, allowedPeerIds и другие списки продавцов с именами и trust, остальные поля как есть. " +
    "Пустой allowedPeerIds разрешает всех.",
  inputSchema: {},
  annotations: readOnly("Политика маршрутизации"),
  async run(_args, { client }) {
    const [policy, peers] = await Promise.all([fetchRouting(client), fetchPeers(client)]);
    const index = byId(peers);
    const lists = peerIdLists(policy);
    const listKeys = new Set(lists.map(([key]) => key));
    const rest = Object.fromEntries(Object.entries(policy).filter(([key]) => !listKeys.has(key)));
    const lines = [`Политика маршрутизации gateway: ${compactJson(rest, 800)}`];
    if (!Array.isArray(policy.allowedPeerIds) || !policy.allowedPeerIds.length) lines.push("allowedPeerIds пуст или не задан: разрешены все продавцы.");
    for (const [key, ids] of lists) lines.push(`\n${key} (${ids.length}):`, peerTable(ids, index));
    return lines.join("\n");
  },
});

export const routing_allow_peers = defineTool({
  name: "routing_allow_peers",
  title: "Изменить разрешённых продавцов",
  description:
    "Меняет список разрешённых продавцов (allowedPeerIds) в политике gateway: читает политику, добавляет и убирает peerId, остальные поля сохраняет как есть. " +
    "По умолчанию dryRun: true — только показывает diff. Записывает (PUT /routing) лишь при dryRun: false; делайте это только по явному согласию пользователя. " +
    "Не даёт оставить список пустым: пустой allowedPeerIds разрешил бы всех.",
  inputSchema: {
    add: z.array(z.string()).default([]).describe("Полные peerId (40 hex), которые разрешить"),
    remove: z.array(z.string()).default([]).describe("Полные peerId, которые убрать из разрешённых"),
    dryRun: z.boolean().default(true).describe("true — только показать изменения; false — записать"),
  },
  annotations: { title: "Изменить разрешённых продавцов", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  async run(args, { client }) {
    const add = [...new Set(args.add.map((id) => id.trim().toLowerCase()))];
    const remove = [...new Set(args.remove.map((id) => id.trim().toLowerCase()))];
    if (!add.length && !remove.length) throw new ToolError("Нечего менять: передайте add и/или remove.");
    const invalid = [...add, ...remove].filter((id) => !isPeerId(id));
    if (invalid.length) throw new ToolError(`Не peerId (нужны 40 hex-символов): ${invalid.map((id) => clean(id, 50)).join(", ")}. Найти ID: find_peers или peer.`);
    const both = add.filter((id) => remove.includes(id));
    if (both.length) throw new ToolError(`peerId одновременно в add и remove: ${both.join(", ")}`);

    const [policy, peers] = await Promise.all([fetchRouting(client), fetchPeers(client)]);
    const index = byId(peers);
    const current = (Array.isArray(policy.allowedPeerIds) ? policy.allowedPeerIds : []).filter((id): id is string => typeof id === "string");
    const currentSet = new Set(current.map((id) => id.toLowerCase()));
    const added = add.filter((id) => !currentSet.has(id));
    const removed = current.filter((id) => remove.includes(id.toLowerCase()));
    const next = [...current.filter((id) => !remove.includes(id.toLowerCase())), ...added];

    const lines: string[] = [];
    const notAllowed = remove.filter((id) => !currentSet.has(id));
    const already = add.filter((id) => currentSet.has(id));
    if (already.length) lines.push(`Уже разрешены: ${already.join(", ")}`);
    if (notAllowed.length) lines.push(`Не были разрешены, убирать нечего: ${notAllowed.join(", ")}`);
    if (!added.length && !removed.length) return [...lines, "Изменений нет: политика не тронута."].join("\n");
    if (!next.length) throw new ToolError("После изменения allowedPeerIds стал бы пустым, а пустой список разрешает всех продавцов. Отказ.");

    if (!current.length) lines.push("ВНИМАНИЕ: сейчас allowedPeerIds пуст (разрешены все); после записи будут разрешены только перечисленные ниже.");
    const missing = added.filter((id) => !index.has(id));
    if (missing.length) lines.push(`ВНИМАНИЕ: этих продавцов сейчас нет в сети: ${missing.join(", ")}`);
    lines.push(`allowedPeerIds: ${current.length} → ${next.length} (+${added.length} −${removed.length})`);
    lines.push(peerTable([...added, ...removed], index, (id) => (added.includes(id) ? "+" : "−")));
    const kept = Object.keys(policy).filter((key) => key !== "allowedPeerIds");
    lines.push(`Остальные поля политики сохраняются как есть: ${kept.length ? kept.join(", ") : "(нет)"}`);

    if (args.dryRun) {
      lines.push("\ndryRun: ничего не записано. Чтобы применить, повторите с dryRun: false (только с согласия пользователя).");
      return lines.join("\n");
    }

    await client.put<RoutingPolicy>("/routing", { ...policy, allowedPeerIds: next });
    const stored = await fetchRouting(client);
    const storedIds = new Set((stored.allowedPeerIds ?? []).map((id) => id.toLowerCase()));
    const ok = storedIds.size === next.length && next.every((id) => storedIds.has(id.toLowerCase()));
    lines.push(ok ? `\nЗаписано: в политике ${storedIds.size} разрешённых продавцов.` : `\nЗаписано, но перечитанная политика отличается: ${compactJson(stored.allowedPeerIds, 2000)}`);
    return lines.join("\n");
  },
});
