export type AuthStyle = "bearer" | "api_key";

export type LastTest = { ok: boolean; message: string; at: number };

export type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  authStyle: AuthStyle;
  model: string;
  keyMasked: string;
  hasKey: boolean;
  lastTest: LastTest | null;
  createdAt: number;
};

export type Caps = {
  id: string;
  label: string;
  note?: string;
  family?: string;
  quality: string[];
  customSize: boolean;
  maxN: number;
  formats: string[];
  background: boolean;
  edit?: boolean;
};

export type Params = {
  model: string;
  size: string;
  quality: string;
  n: number;
  output_format: string;
  background: string;
  output_compression: number;
  moderation: string;
  extra?: Record<string, unknown>;
};

export type Tokens = { inputTokens: number; outputTokens: number; totalTokens: number };

export type Generation = {
  id: string;
  providerId: string;
  providerName: string;
  mode: "generate" | "edit";
  prompt: string;
  params: Params;
  files: string[];
  status: "ok" | "error";
  error: string;
  latencyMs: number;
  usage: unknown;
  tokens?: Tokens;
  costUsd?: number;
  imageCount?: number;
  createdAt: number;
};

export type Settings = {
  concurrency: number;
  defaultProviderId: string;
  priceInputPerM: number;
  priceOutputPerM: number;
};

export type UsageAgg = {
  requests: number;
  images: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type UsageSummary = {
  prices: { priceInputPerM: number; priceOutputPerM: number };
  today: UsageAgg;
  month: UsageAgg;
  total: UsageAgg;
};

export type Quota = {
  available: boolean;
  source?: string;
  label?: string;
  currency?: string;
  limit?: number | null;
  used?: number | null;
  remaining?: number | null;
  checkedAt: number;
  message?: string;
  hint?: string;
  tried?: string[];
};

export type AppState = {
  providers: Provider[];
  settings: Settings;
  presets: Caps[];
  sizePresets: string[];
  dataDir: string;
  version: string;
};

export type GeneratePayload = {
  providerId: string;
  prompt: string;
  mode: "generate" | "edit";
  params: Params;
  image?: string;
  mask?: string;
};

export const FALLBACK_CAPS: Caps = {
  id: "custom",
  label: "自定义模型",
  quality: ["low", "medium", "high", "auto"],
  customSize: true,
  maxN: 4,
  formats: ["png", "jpeg", "webp"],
  background: true,
  edit: true
};

export function capsForModel(presets: Caps[], model: string): Caps {
  const id = String(model || "").toLowerCase();
  if (!id) return presets[0] || FALLBACK_CAPS;
  const exact = presets.find((p) => p.id === id);
  if (exact) return exact;
  const prefix = presets.find((p) => id.indexOf(p.id) === 0);
  if (prefix) return prefix;
  const family = presets.find((p) => p.family && id.indexOf("image-" + p.family) !== -1);
  if (family) return family;
  const anyImage = presets.find((p) => id.indexOf("gpt-image") !== -1);
  return anyImage || FALLBACK_CAPS;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

export function formatMs(ms: number): string {
  if (!ms) return "";
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(1) + "s";
}

export function formatTokens(n: number): string {
  const value = Number(n) || 0;
  if (value >= 1000000) return (value / 1000000).toFixed(2) + "M";
  if (value >= 1000) return (value / 1000).toFixed(1) + "k";
  return String(value);
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const value = Number(n);
  if (value !== 0 && Math.abs(value) < 0.01) return "$" + value.toFixed(4);
  return "$" + value.toFixed(2);
}
