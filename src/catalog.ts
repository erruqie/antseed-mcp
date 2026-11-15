/** Management API shapes (only the fields this server reads) and model/peer matching. */
import type { Client } from "./client";

export type ServiceHealth = {
  status?: string;
  reason?: string | null;
  consecutiveFailures?: number | null;
  failingSince?: number | null;
  checkedAt?: number | null;
};

export type Service = {
  provider?: string;
  service: string;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  cachedInputUsdPerMillion?: number;
  apiProtocols?: string[];
  categories?: string[];
  health?: ServiceHealth;
  modelCheck?: { verdict?: string; auditUrl?: string };
  performance?: { requests?: number; successRate?: number | null; firstTokenMsP50?: number | null; tokensPerSecondP50?: number | null };
};

export type Peer = {
  peerId: string;
  displayName?: string;
  services?: Service[];
  trustScore?: number;
  reputationScore?: number;
  verified?: boolean;
  verificationLinks?: Array<{ kind?: string; label?: string; href?: string }>;
  tee?: boolean;
  teeScope?: string | null;
  stakeAnts?: string;
  washFlagged?: boolean;
  trustBreakdown?: Record<string, unknown> & { verification?: { sameCount?: number; diffCount?: number } };
  sameServices?: string[];
  diffServices?: string[];
  verificationUrls?: Record<string, string>;
  lastSeen?: number;
  health?: { failureStreak?: number; coolingDownUntil?: number | null };
  latencyMsP50?: number | null;
  firstTokenMsP50?: number | null;
  tokensPerSecondP50?: number | null;
  requests24h?: number;
};

export type Offer = {
  peerId: string;
  displayName?: string;
  serviceId: string;
  provider?: string;
  protocols?: string[];
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  cachedInputUsdPerMillion?: number;
  trustScore?: number;
  verified?: boolean;
  health?: ServiceHealth;
  latencyMsP50?: number | null;
};

export type Model = {
  id: string;
  name?: string;
  aliases?: string[];
  type?: string;
  sellers?: number;
  verifiedSellers?: number;
  inputUsdPerMillion?: { min?: number; max?: number };
  outputUsdPerMillion?: { min?: number; max?: number };
  offers?: Offer[];
};

/** `PUT /routing` replaces the whole policy, so unknown fields are kept as they are. */
export type RoutingPolicy = Record<string, unknown> & { allowedPeerIds?: string[]; sort?: string };

const asArray = <T>(value: unknown, key: string): T[] => {
  if (Array.isArray(value)) return value as T[];
  const inner = (value as Record<string, unknown> | null)?.[key] ?? (value as Record<string, unknown> | null)?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
};

export const fetchPeers = async (client: Client) => asArray<Peer>(await client.get("/peers"), "peers").filter((peer) => typeof peer?.peerId === "string");
export const fetchModels = async (client: Client) => asArray<Model>(await client.get("/models"), "models").filter((model) => typeof model?.id === "string");
export const fetchRouting = (client: Client) => client.get<RoutingPolicy>("/routing");

/**
 * Model IDs compared across sellers: lower case, without the first
 * `vendor/` segment, letters and digits only, without a `claude` prefix. `grok-4.7`, `grok-4-7` and `xai/grok-4.7`
 * are all `grok47`.
 */
export const normalizeModelId = (id: string) =>
  id.toLowerCase().replace(/^[^/]*\//, "").replace(/[^a-z0-9]/g, "").replace(/^claude/, "");

/** The `/models` entry for `query` (exact ID, then normalized ID or alias) and every normalized name it goes by. */
export function resolveModel(models: Model[], query: string): { model?: Model; names: Set<string> } {
  const wanted = normalizeModelId(query);
  const lower = query.trim().toLowerCase();
  const namesOf = (model: Model) => [model.id, ...(model.aliases ?? [])].filter((name): name is string => typeof name === "string");
  const model =
    models.find((item) => item.id.toLowerCase() === lower) ??
    models.find((item) => item.type === "text" && namesOf(item).some((name) => normalizeModelId(name) === wanted)) ??
    models.find((item) => namesOf(item).some((name) => normalizeModelId(name) === wanted));
  const names = new Set([wanted, ...(model ? namesOf(model).map(normalizeModelId) : [])].filter(Boolean));
  return { ...(model ? { model } : {}), names };
}

export const allowedSet = (policy: RoutingPolicy) =>
  new Set((Array.isArray(policy.allowedPeerIds) ? policy.allowedPeerIds : []).filter((id): id is string => typeof id === "string").map((id) => id.toLowerCase()));

/** Allowed by the gateway policy: an empty or missing allow list allows everyone. */
export const policyAllows = (allowed: ReadonlySet<string>, peerId: string) => allowed.size === 0 || allowed.has(peerId.toLowerCase());

/** Finds peers by full ID, ID prefix, exact name or name substring, in that order of preference. */
export function findPeers(peers: Peer[], query: string): Peer[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const byId = peers.filter((peer) => peer.peerId.toLowerCase() === q);
  if (byId.length) return byId;
  const byPrefix = /^[0-9a-f]{4,}$/.test(q) ? peers.filter((peer) => peer.peerId.toLowerCase().startsWith(q)) : [];
  if (byPrefix.length) return byPrefix;
  const byName = peers.filter((peer) => (peer.displayName ?? "").toLowerCase() === q);
  if (byName.length) return byName;
  return peers.filter((peer) => (peer.displayName ?? "").toLowerCase().includes(q));
}

export const isPeerId = (value: string) => /^[0-9a-f]{40}$/i.test(value);

/** Peer ID → display name, for tables that only get IDs. */
export const nameIndex = (peers: Peer[]) => new Map(peers.map((peer) => [peer.peerId.toLowerCase(), peer.displayName ?? ""]));
