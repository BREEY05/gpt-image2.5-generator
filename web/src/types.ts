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
  createdAt: number;
};

export type Settings = { concurrency: number; defaultProviderId: string };

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
