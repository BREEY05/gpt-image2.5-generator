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

// 用户经常会把完整接口地址粘进 Base URL，这里把已知的接口后缀去掉，避免拼出 /v1/images/generations/v1。
const ENDPOINT_SUFFIXES = [
  "/images/generations",
  "/images/edits",
  "/images/variations",
  "/chat/completions",
  "/responses",
  "/completions",
  "/embeddings"
];

export function normalizeBaseUrl(input) {
  let s = String(input || "").trim();
  if (!s) return "";
  while (s.endsWith("/")) s = s.slice(0, -1);
  const lower = s.toLowerCase();
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      s = s.slice(0, s.length - suffix.length);
      while (s.endsWith("/")) s = s.slice(0, -1);
      break;
    }
  }
  if (s.endsWith("/v1")) return s;
  if (s.indexOf("/v1/") !== -1) return s;
  return s + "/v1";
}

function looksLikeHtml(text) {
  const head = String(text || "").trim().slice(0, 300).toLowerCase();
  if (!head) return false;
  return head.indexOf("<!doctype") === 0 || head.indexOf("<html") === 0 || head.indexOf("<head") === 0 || head.indexOf("<?xml") === 0;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

// 把上游返回的 HTML 页面压成一句人话：标题 + 正文前若干字，而不是把整页标签糊到界面上。
function summarizeHtmlPage(text) {
  const raw = String(text || "");
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
  const title = decodeEntities((titleMatch ? titleMatch[1] : "").replace(/\s+/g, " ").trim()).slice(0, 120);
  const plain = decodeEntities(
    raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ).slice(0, 160);
  const cloudflare = /cloudflare|cf-error|cf-chl|attention required|just a moment|enable javascript and cookies/i.test(raw);
  return { title: title, plain: plain, cloudflare: cloudflare };
}

function htmlErrorHint(info, url, status) {
  const parts = [];
  const hay = (info.title + " " + info.plain).toLowerCase();
  if (/just a moment|attention required|cf-chl|enable javascript and cookies/.test(hay)) {
    parts.push("站点的人机验证拦下了这次请求：换一个网络 / 代理再试，或让中转方把你的出口 IP 放行");
  } else if (/bad gateway|gateway time|service unavailable|502|503|504/.test(hay) || (status >= 500)) {
    parts.push("这是中转站自己的网关错误，不是你的 Key 或参数问题：通常是它的后端挂了 / 超时，换一个中转或等它恢复");
  } else if (status === 404) {
    parts.push("地址 404 且返回网页：Base URL 很可能指到了网站首页，应填到 API，例如 https://域名/v1");
  } else {
    parts.push("上游返回的是网页而不是接口 JSON：常见于 Base URL 指到了网站首页、或中转网关直接报错");
  }
  if (url) parts.push("实际请求地址：" + url);
  return parts.join("；");
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

function toApiError(res, text, payload, url) {
  let message = "";
  if (payload && payload.error) {
    message = typeof payload.error === "string" ? payload.error : payload.error.message || "";
  }
  let hint = hintFor(res.status);
  if (!message && looksLikeHtml(text)) {
    const info = summarizeHtmlPage(text);
    message = "上游返回的是一个网页，不是接口数据（HTTP " + res.status + "）";
    if (info.title) message += " · 页面标题：" + info.title;
    else if (info.plain) message += " · " + info.plain.slice(0, 80);
    hint = [hint, htmlErrorHint(info, url, res.status)].filter(Boolean).join("；");
  }
  if (!message) message = String(text || "").slice(0, 300) || res.statusText || "请求失败";
  const retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
  return new ApiError(message, { status: res.status, hint: hint, retryable: retryable, payload: payload });
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
  if (!res.ok) throw toApiError(res, text, payload, url);
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
  if (!res.ok) throw toApiError(res, text, payload, url);
  if (!payload) throw notJsonError(text, url);
  return collectImages(payload);
}

export async function editImages(provider, apiKey, fields, images, maskBuf, maskMime, timeoutMs) {
  const url = normalizeBaseUrl(provider.baseUrl) + "/images/edits";
  const list = Array.isArray(images) ? images : [];
  if (!list.length) throw new ApiError("编辑模式需要至少一张参考图");

  const build = function (fieldName) {
    const form = new FormData();
    Object.keys(fields || {}).forEach(function (key) {
      if (fields[key] != null && fields[key] !== "") form.append(key, String(fields[key]));
    });
    list.forEach(function (item, index) {
      const buf = item && item.buf ? item.buf : item;
      const mime = (item && item.mime) || "image/png";
      const name = (item && item.name) || "image-" + (index + 1) + ".png";
      form.append(fieldName, new Blob([buf], { type: mime }), name);
    });
    if (maskBuf) form.append("mask", new Blob([maskBuf], { type: maskMime || "image/png" }), "mask.png");
    return form;
  };

  const headers = authHeaders(provider, apiKey);
  delete headers["Content-Type"];
  const send = async function (fieldName) {
    const res = await request(url, { method: "POST", headers: headers, body: build(fieldName) }, timeoutMs || IMAGE_TIMEOUT);
    const text = await res.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch (e) {}
    return { res: res, text: text, payload: payload };
  };

  // 单图沿用 image 字段（兼容全部中转）；多图按 OpenAI 官方 SDK 的数组编码用 image[]。
  // 个别中转只认重复的 image 字段，遇到 400 且错误提到 image 时自动回退重试一次。
  let fieldName = list.length === 1 ? "image" : "image[]";
  let out = await send(fieldName);
  if (!out.res.ok && list.length > 1 && out.res.status === 400) {
    const msg = String((out.payload && out.payload.error && out.payload.error.message) || out.text || "");
    if (/image/i.test(msg)) out = await send("image");
  }
  if (!out.res.ok) throw toApiError(out.res, out.text, out.payload, url);
  if (!out.payload) throw notJsonError(out.text, url);
  return collectImages(out.payload);
}

// 状态码是 2xx 但返回的不是 JSON（多为网站首页 / 维护页 / 网关页）
function notJsonError(text, url) {
  if (looksLikeHtml(text)) {
    const info = summarizeHtmlPage(text);
    let message = "接口返回的是一个网页，不是 JSON";
    if (info.title) message += " · 页面标题：" + info.title;
    return new ApiError(message, { status: 0, hint: htmlErrorHint(info, url, 200) });
  }
  return new ApiError("接口返回的不是 JSON（可能是 HTML 页面）", {
    hint: "Base URL 可能指向了网站首页而不是 API 地址，通常应以 /v1 结尾" + (url ? "；实际请求地址：" + url : "")
  });
}

async function collectImages(payload) {
  const items = payload && Array.isArray(payload.data) ? payload.data : [];
  const images = [];
  for (const item of items) {
    if (item && item.b64_json) {
      images.push({ buf: Buffer.from(String(item.b64_json), "base64"), ext: "" });
    } else if (item && item.url) {
      const res = await request(item.url, { method: "GET" }, 120000);
      if (!res.ok) {
        const text = await res.text().catch(function () { return ""; });
        if (looksLikeHtml(text)) {
          const info = summarizeHtmlPage(text);
          throw new ApiError("图片下载失败：地址返回的是网页（HTTP " + res.status + "）" + (info.title ? " · " + info.title : ""), {
            hint: "中转返回的图片 URL 可能已过期或被防盗链拦截" + (url ? "；实际地址：" + url : "")
          });
        }
        throw new ApiError("图片下载失败（HTTP " + res.status + "）", { hint: "中转返回的图片 URL 不可访问或已过期" });
      }
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
