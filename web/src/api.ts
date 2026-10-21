import type { AppState, Generation, GeneratePayload, Provider, Quota, Settings, UsageSummary } from "./types";

export class ApiError extends Error {
  hint: string;
  status: number;
  constructor(message: string, hint: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.hint = hint;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const res = await fetch(path, Object.assign({}, init, { headers: Object.assign(headers, (init && init.headers) || {}) }));
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    const message = data && data.error && data.error.message ? data.error.message : "请求失败（HTTP " + res.status + "）";
    const hint = data && data.error && data.error.hint ? data.error.hint : "";
    throw new ApiError(message, hint, res.status);
  }
  return data as T;
}

export const api = {
  state: () => request<AppState>("/api/state"),

  createProvider: (body: { name: string; baseUrl: string; authStyle: string; apiKey: string; model: string }) =>
    request<{ provider: Provider }>("/api/providers", { method: "POST", body: JSON.stringify(body) }),

  updateProvider: (id: string, body: Record<string, unknown>) =>
    request<{ provider: Provider }>("/api/providers/" + id, { method: "PATCH", body: JSON.stringify(body) }),

  deleteProvider: (id: string) => request<{ ok: boolean }>("/api/providers/" + id, { method: "DELETE" }),

  testProvider: (id: string, deep: boolean, model?: string) =>
    request<{ ok: boolean; mode: string; latencyMs: number; message: string; hint?: string; unknown?: boolean; models?: { id: string }[] }>(
      "/api/providers/" + id + "/test",
      { method: "POST", body: JSON.stringify({ deep, model }) }
    ),

  models: (id: string) => request<{ models: { id: string }[]; total: number }>("/api/providers/" + id + "/models"),

  quota: (id: string, force?: boolean) =>
    request<Quota>("/api/providers/" + id + "/quota" + (force ? "?force=1" : "")),

  usage: (providerId: string) => request<UsageSummary>("/api/usage?providerId=" + encodeURIComponent(providerId)),

  generate: (payload: GeneratePayload) =>
    request<{ generation: Generation }>("/api/generate", { method: "POST", body: JSON.stringify(payload) }),

  generations: (limit: number) => request<{ generations: Generation[] }>("/api/generations?limit=" + limit),

  deleteGeneration: (id: string) => request<{ ok: boolean }>("/api/generations/" + id, { method: "DELETE" }),

  saveSettings: (patch: Partial<Settings>) =>
    request<{ settings: Settings }>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),

  reveal: () => request<{ ok: boolean; dir: string }>("/api/reveal", { method: "POST" })
};
