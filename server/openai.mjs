const IMAGE_TIMEOUT = 420000;

export class ApiError extends Error {
  constructor(message, opts) {
    super(String(message || "请求失败"));
    this.name = "ApiError";
    const o = opts || {};
    this.status = o.status || 0;
    this.hint = o.hint || "";
    this.retryable = !!o.retryable;
    this.payload = o.payload || null;
  }
}

export function normalizeBaseUrl(input) {
  let s = String(input || "").trim();
  if (!s) return "";
  while (s.endsWith("/")) s = s.slice(0, -1);
  if (s.endsWith("/v1")) return s;
  if (s.indexOf("/v1/") !== -1) return s;
  return s + "/v1";
}

export function authHeaders(provider, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (provider && provider.authStyle === "api_key") headers["api-key"] = apiKey;
  else headers["Authorization"] = "Bearer " + apiKey;
  return headers;
}

export function hintFor(status) {
  if (status === 400) return "参数不合法：该模型可能不支持这个尺寸 / 画质 / 格式";
  if (status === 401) return "Key 无效或已过期：检查是否粘贴完整、是否被吊销";
  if (status === 403) return "没有权限：该 Key 未被授权访问此模型，或组织受限";
  if (status === 404) return "接口或模型不存在：检查 Base URL 是否以 /v1 结尾、模型名是否拼写正确";
  if (status === 413) return "请求体过大：参考图太大，压缩后再试";
  if (status === 429) return "限流或额度不足：稍后重试，或换一个 Key / 中转";
  if (status >= 500) return "上游服务异常：稍后重试，或联系中转方";
  return "";
}

function toApiError(res, text, payload) {
  let message = "";
  if (payload && payload.error) {
    message = typeof payload.error === "string" ? payload.error : payload.error.message || "";
  }
  if (!message) message = String(text || "").slice(0, 300) || res.statusText || "请求失败";
  const retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
  return new ApiError(message, { status: res.status, hint: hintFor(res.status), retryable: retryable, payload: payload });
}

export async function request(url, init, timeoutMs) {
  const ms = timeoutMs || IMAGE_TIMEOUT;
  let res;
  try {
    res = await fetch(url, Object.assign({}, init, { signal: AbortSignal.timeout(ms) }));
  } catch (e) {
    const name = e && e.name ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new ApiError("请求超时（" + Math.round(ms / 1000) + " 秒）", {
        hint: "高画质 / 大尺寸出图更慢：可降低 quality 或尺寸；若中转本身不可用，换一个 Base URL",
        retryable: false
      });
    }
    throw new ApiError("网络不可达：" + (e && e.message ? e.message : String(e)), {
      hint: "检查 Base URL 是否正确、本机能否访问该域名（代理 / 网络），或换第三方中转",
      retryable: false
    });
  }
  return res;
}

export async function probeModels(provider, apiKey) {
  const url = normalizeBaseUrl(provider.baseUrl) + "/models";
  const res = await request(url, { method: "GET", headers: authHeaders(provider, apiKey) }, 25000);
  const text = await res.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch (e) {}
  if (!res.ok) throw toApiError(res, text, payload);
  const data = payload && Array.isArray(payload.data) ? payload.data : [];
  return data
    .map(function (item) {
      return { id: String(item.id || item.name || ""), created: item.created || 0 };
    })
    .filter(function (m) { return !!m.id; });
}

export async function runTest(provider, apiKey, deep) {
  const started = Date.now();
  if (!deep) {
    try {
      const models = await probeModels(provider, apiKey);
      return { ok: true, mode: "models", latencyMs: Date.now() - started, models: models, message: "连接正常（模型列表可读）" };
    } catch (e) {
      const status = e && e.status ? e.status : 0;
      const base = {
        ok: false,
        mode: "models",
        latencyMs: Date.now() - started,
        message: e && e.message ? e.message : "连接失败",
        hint: e && e.hint ? e.hint : ""
      };
      if (status === 401 || status === 403 || status === 400 || status === 429) return base;
      return Object.assign(base, {
        unknown: true,
        hint: "该中转可能不提供 /models 接口。可点「深度测试」用一次真实出图来验证（会产生 1 张最低画质小图）"
      });
    }
  }
  const body = { model: provider.model || "gpt-image-1", prompt: "a small red dot on a white background", n: 1, size: "1024x1024", quality: "low" };
  try {
    const out = await generateImages(provider, apiKey, body, IMAGE_TIMEOUT);
    return {
      ok: true,
      mode: "generate",
      latencyMs: Date.now() - started,
      message: "出图成功，模型可用",
      bytes: out.images.length ? out.images[0].buf.length : 0
    };
  } catch (e) {
    return {
      ok: false,
      mode: "generate",
      latencyMs: Date.now() - started,
      message: e && e.message ? e.message : "出图失败",
      hint: e && e.hint ? e.hint : ""
    };
  }
}

export async function generateImages(provider, apiKey, body, timeoutMs) {
  const url = normalizeBaseUrl(provider.baseUrl) + "/images/generations";
  const res = await request(
    url,
    { method: "POST", headers: authHeaders(provider, apiKey), body: JSON.stringify(body) },
    timeoutMs || IMAGE_TIMEOUT
  );
  const text = await res.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch (e) {}
  if (!res.ok) throw toApiError(res, text, payload);
  if (!payload) {
    throw new ApiError("接口返回的不是 JSON（可能是 HTML 页面）", {
      hint: "Base URL 可能指向了网站首页而不是 API 地址，通常应以 /v1 结尾"
    });
  }
  return collectImages(payload);
}

export async function editImages(provider, apiKey, fields, imageBuf, imageMime, maskBuf, maskMime, timeoutMs) {
  const url = normalizeBaseUrl(provider.baseUrl) + "/images/edits";
  const form = new FormData();
  Object.keys(fields || {}).forEach(function (key) {
    if (fields[key] != null && fields[key] !== "") form.append(key, String(fields[key]));
  });
  form.append("image", new Blob([imageBuf], { type: imageMime || "image/png" }), "image.png");
  if (maskBuf) form.append("mask", new Blob([maskBuf], { type: maskMime || "image/png" }), "mask.png");

  const headers = authHeaders(provider, apiKey);
  delete headers["Content-Type"];
  const res = await request(url, { method: "POST", headers: headers, body: form }, timeoutMs || IMAGE_TIMEOUT);
  const text = await res.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch (e) {}
  if (!res.ok) throw toApiError(res, text, payload);
  if (!payload) throw new ApiError("接口返回的不是 JSON（可能是 HTML 页面）", { hint: "检查 Base URL 是否指向 API" });
  return collectImages(payload);
}

async function collectImages(payload) {
  const items = payload && Array.isArray(payload.data) ? payload.data : [];
  const images = [];
  for (const item of items) {
    if (item && item.b64_json) {
      images.push({ buf: Buffer.from(String(item.b64_json), "base64"), ext: "" });
    } else if (item && item.url) {
      const res = await request(item.url, { method: "GET" }, 120000);
      if (!res.ok) throw new ApiError("图片下载失败（HTTP " + res.status + "）", { hint: "中转返回的图片 URL 不可访问或已过期" });
      const ab = await res.arrayBuffer();
      images.push({ buf: Buffer.from(ab), ext: "" });
    }
  }
  if (!images.length) {
    throw new ApiError("接口调用成功，但没有返回图片数据", {
      hint: "该中转可能返回了非标准结构；可检查「高级参数」或联系中转方"
    });
  }
  return { images: images, usage: payload.usage || null, created: payload.created || null };
}
