import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  ROOT, DATA_DIR, IMAGES_DIR, decryptKey, listProviders, getProviderRow,
  createProvider, updateProvider, deleteProvider, saveTestResult,
  getSettings, setSettings, insertGeneration, listGenerations, deleteGeneration, closeDb, checkpoint,
  usageSummary, normalizeUsage, estimateCost
} from "./db.mjs";
import { getQuota } from "./quota.mjs";
import { PRESET_MODELS, SIZE_PRESETS } from "./models.mjs";
import { normalizeBaseUrl, probeModels, runTest, generateImages, editImages, ApiError } from "./openai.mjs";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(ROOT, "server", "public");

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    return String(pkg.version || "0.0.0");
  } catch (e) {
    return "0.0.0";
  }
}

const VERSION = readVersion();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8"
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req, limit) {
  const max = limit || 64 * 1024 * 1024;
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > max) {
        reject(new ApiError("请求体过大（超过 " + Math.round(max / 1024 / 1024) + "MB）"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      if (!chunks.length) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(new ApiError("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function decodeDataUrl(input) {
  const s = String(input || "");
  if (s.indexOf("data:") !== 0) return null;
  const comma = s.indexOf(",");
  if (comma === -1) return null;
  const head = s.slice(5, comma);
  const mime = head.split(";")[0] || "image/png";
  const buf = Buffer.from(s.slice(comma + 1), "base64");
  if (!buf.length) return null;
  return { buf: buf, mime: mime };
}

const queue = { active: 0, waiting: [] };
async function withLimit(limit, fn) {
  if (queue.active >= limit) {
    await new Promise(function (resolve) { queue.waiting.push(resolve); });
  }
  queue.active += 1;
  try {
    return await fn();
  } finally {
    queue.active -= 1;
    const next = queue.waiting.shift();
    if (next) next();
  }
}

async function retry(fn, times) {
  let lastError = null;
  for (let i = 0; i < times; i += 1) {
    try {
      return await fn(i);
    } catch (e) {
      lastError = e;
      if (!(e && e.retryable) || i === times - 1) throw e;
      await new Promise(function (r) { setTimeout(r, 1500 * (i + 1)); });
    }
  }
  throw lastError;
}

function saveImages(images, format) {
  const ext = format === "jpeg" ? "jpg" : format === "webp" ? "webp" : "png";
  const files = [];
  for (const image of images) {
    const name = crypto.randomUUID() + "." + ext;
    fs.writeFileSync(path.join(IMAGES_DIR, name), image.buf);
    files.push("/files/" + name);
  }
  return files;
}

function buildState() {
  return {
    providers: listProviders(),
    settings: getSettings(),
    presets: PRESET_MODELS,
    sizePresets: SIZE_PRESETS,
    dataDir: DATA_DIR,
    version: VERSION
  };
}

function sendFile(res, file, status) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const stat = fs.statSync(file);
  res.writeHead(status || 200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
  });
  fs.createReadStream(file).pipe(res);
}

function serveImage(res, pathname) {
  const name = pathname.slice("/files/".length);
  if (!name || name.indexOf("/") !== -1 || name.indexOf("..") !== -1) {
    return json(res, 403, { error: { message: "非法文件名" } });
  }
  const full = path.join(IMAGES_DIR, name);
  if (!full.startsWith(IMAGES_DIR) || !fs.existsSync(full)) {
    return json(res, 404, { error: { message: "图片不存在或已删除" } });
  }
  return sendFile(res, full);
}

function serveStatic(res, pathname) {
  const publicRoot = path.resolve(PUBLIC_DIR);
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const full = path.resolve(publicRoot, rel);
  if (!full.startsWith(publicRoot)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("forbidden");
  }
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return sendFile(res, full);
  const indexFile = path.join(publicRoot, "index.html");
  if (fs.existsSync(indexFile)) return sendFile(res, indexFile);
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  return res.end("前端还没有构建：请在项目目录执行 pnpm build（开发模式用 pnpm dev）");
}

async function handleGenerate(req, res) {
  const body = (await readBody(req)) || {};
  const row = getProviderRow(body.providerId);
  if (!row) return json(res, 404, { error: { message: "Provider 不存在，请先在左侧添加一个" } });
  const apiKey = decryptKey(row.key_cipher);
  if (!apiKey) return json(res, 400, { error: { message: "这个 Provider 还没有填写 API Key" } });

  const params = body.params && typeof body.params === "object" ? body.params : {};
  const model = String(params.model || row.model || PRESET_MODELS[0].id);
  const prompt = String(body.prompt || "").trim();
  const mode = body.mode === "edit" ? "edit" : "generate";
  if (!prompt) return json(res, 400, { error: { message: "提示词不能为空" } });

  const n = Math.max(1, Math.min(10, Number(params.n) || 1));
  const size = String(params.size || "1024x1024");
  const dims = size.split("x").map(function (v) { return Number(v); });
  if (dims.length !== 2 || !dims[0] || !dims[1] || dims[0] % 1 !== 0 || dims[1] % 1 !== 0) {
    return json(res, 400, { error: { message: "尺寸格式应为 宽x高，例如 1024x1024" } });
  }

  let format = ["png", "jpeg", "webp"].indexOf(String(params.output_format)) !== -1 ? String(params.output_format) : "png";
  let background = String(params.background || "auto");
  if (background === "transparent" && format === "jpeg") {
    format = "png";
    background = "auto";
  }

  const fields = { model: model, prompt: prompt, n: n, size: size };
  if (params.quality) fields.quality = String(params.quality);
  fields.output_format = format;
  if (background !== "auto") fields.background = background;
  if ((format === "jpeg" || format === "webp") && params.output_compression != null) {
    fields.output_compression = Math.max(0, Math.min(100, Number(params.output_compression) || 100));
  }
  if (params.moderation && params.moderation !== "auto") fields.moderation = String(params.moderation);
  if (params.extra && typeof params.extra === "object") {
    Object.keys(params.extra).forEach(function (key) { fields[key] = params.extra[key]; });
  }

  const provider = { baseUrl: normalizeBaseUrl(row.base_url), authStyle: row.auth_style, model: model };
  const started = Date.now();
  const limit = Math.max(1, Math.min(8, Number(getSettings().concurrency) || 2));

  let imageBuf = null;
  let imageMime = "image/png";
  let maskBuf = null;
  let maskMime = "image/png";
  if (mode === "edit") {
    const image = decodeDataUrl(body.image);
    if (!image) return json(res, 400, { error: { message: "编辑模式需要先上传一张参考图" } });
    imageBuf = image.buf;
    imageMime = image.mime;
    const mask = decodeDataUrl(body.mask);
    if (mask) {
      maskBuf = mask.buf;
      maskMime = mask.mime;
    }
  }

  try {
    const out = await withLimit(limit, function () {
      return retry(function () {
        if (mode === "edit") return editImages(provider, apiKey, fields, imageBuf, imageMime, maskBuf, maskMime);
        return generateImages(provider, apiKey, fields);
      }, 3);
    });
    const files = saveImages(out.images, format);
    const tokens = normalizeUsage(out.usage);
    const record = {
      id: crypto.randomUUID(),
      providerId: row.id,
      providerName: row.name,
      mode: mode,
      prompt: prompt,
      params: fields,
      files: files,
      status: "ok",
      error: "",
      latencyMs: Date.now() - started,
      usage: out.usage,
      tokens: tokens,
      costUsd: estimateCost(tokens, getSettings()),
      imageCount: files.length,
      createdAt: Date.now()
    };
    insertGeneration(record);
    return json(res, 200, { generation: record });
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(e && e.message ? e.message : String(e));
    const record = {
      id: crypto.randomUUID(),
      providerId: row.id,
      providerName: row.name,
      mode: mode,
      prompt: prompt,
      params: fields,
      files: [],
      status: "error",
      error: err.message,
      latencyMs: Date.now() - started,
      usage: null,
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costUsd: 0,
      imageCount: 0,
      createdAt: Date.now()
    };
    insertGeneration(record);
    return json(res, err.status || 502, {
      error: { message: err.message, hint: err.hint },
      generation: record
    });
  }
}

async function handleApi(req, res, url, pathname) {
  const seg = pathname.split("/").filter(Boolean);
  const method = req.method || "GET";
  const resource = seg[1] || "";
  const id = seg[2] || "";
  const action = seg[3] || "";

  if (resource === "health") {
    return json(res, 200, { ok: true, version: VERSION, dataDir: DATA_DIR, concurrency: getSettings().concurrency });
  }

  if (resource === "state" && method === "GET") {
    return json(res, 200, buildState());
  }

  if (resource === "usage" && method === "GET") {
    const providerId = url.searchParams.get("providerId") || "";
    return json(res, 200, usageSummary(providerId));
  }

  if (resource === "providers") {
    if (!id && method === "GET") return json(res, 200, { providers: listProviders() });

    if (!id && method === "POST") {
      const body = (await readBody(req, 1024 * 1024)) || {};
      const name = String(body.name || "").trim();
      const baseUrl = String(body.baseUrl || "").trim();
      if (!name) return json(res, 400, { error: { message: "请填写名称" } });
      if (!baseUrl) return json(res, 400, { error: { message: "请填写 Base URL" } });
      const provider = createProvider({
        name: name,
        baseUrl: normalizeBaseUrl(baseUrl),
        authStyle: body.authStyle === "api_key" ? "api_key" : "bearer",
        apiKey: String(body.apiKey || "").trim(),
        model: String(body.model || "").trim()
      });
      return json(res, 201, { provider: provider });
    }

    if (id && !action && method === "PATCH") {
      const body = (await readBody(req, 1024 * 1024)) || {};
      const provider = updateProvider(id, {
        name: body.name != null ? String(body.name).trim() : null,
        baseUrl: body.baseUrl != null ? normalizeBaseUrl(body.baseUrl) : null,
        authStyle: body.authStyle != null ? (body.authStyle === "api_key" ? "api_key" : "bearer") : null,
        apiKey: body.apiKey != null ? String(body.apiKey).trim() : null,
        model: body.model != null ? String(body.model).trim() : null
      });
      if (!provider) return json(res, 404, { error: { message: "Provider 不存在" } });
      return json(res, 200, { provider: provider });
    }

    if (id && !action && method === "DELETE") {
      deleteProvider(id);
      return json(res, 200, { ok: true });
    }

    if (id && action === "test" && method === "POST") {
      const row = getProviderRow(id);
      if (!row) return json(res, 404, { error: { message: "Provider 不存在" } });
      const apiKey = decryptKey(row.key_cipher);
      if (!apiKey) return json(res, 400, { error: { message: "请先填写 API Key" } });
      const body = (await readBody(req, 1024 * 1024)) || {};
      const provider = {
        baseUrl: normalizeBaseUrl(row.base_url),
        authStyle: row.auth_style,
        model: String(body.model || row.model || "")
      };
      const result = await runTest(provider, apiKey, !!body.deep);
      saveTestResult(id, !!result.ok, result.message);
      return json(res, 200, result);
    }

    if (id && action === "quota" && method === "GET") {
      const row = getProviderRow(id);
      if (!row) return json(res, 404, { error: { message: "Provider 不存在" } });
      const apiKey = decryptKey(row.key_cipher);
      if (!apiKey) return json(res, 400, { error: { message: "请先填写 API Key" } });
      const provider = { id: row.id, baseUrl: normalizeBaseUrl(row.base_url), authStyle: row.auth_style };
      const result = await getQuota(provider, apiKey, { force: url.searchParams.get("force") === "1" });
      return json(res, 200, result);
    }

    if (id && action === "models" && method === "GET") {
      const row = getProviderRow(id);
      if (!row) return json(res, 404, { error: { message: "Provider 不存在" } });
      const apiKey = decryptKey(row.key_cipher);
      if (!apiKey) return json(res, 400, { error: { message: "请先填写 API Key" } });
      try {
        const all = await probeModels(
          { baseUrl: normalizeBaseUrl(row.base_url), authStyle: row.auth_style },
          apiKey
        );
        const imageModels = all.filter(function (m) {
          const key = m.id.toLowerCase();
          return key.indexOf("image") !== -1 || key.indexOf("dall") !== -1;
        });
        return json(res, 200, { models: imageModels.length ? imageModels : all, total: all.length });
      } catch (e) {
        return json(res, e.status || 502, { error: { message: e.message, hint: e.hint } });
      }
    }
  }

  if (resource === "generate" && method === "POST") {
    return handleGenerate(req, res);
  }

  if (resource === "generations") {
    if (!id && method === "GET") {
      return json(res, 200, { generations: listGenerations(url.searchParams.get("limit")) });
    }
    if (id && method === "DELETE") {
      const removed = deleteGeneration(id);
      if (!removed) return json(res, 404, { error: { message: "记录不存在" } });
      return json(res, 200, { ok: true });
    }
  }

  if (resource === "settings") {
    if (method === "GET") return json(res, 200, { settings: getSettings() });
    if (method === "PUT") {
      const body = (await readBody(req, 1024 * 1024)) || {};
      const patch = {};
      if (body.concurrency != null) patch.concurrency = Math.max(1, Math.min(8, Number(body.concurrency) || 2));
      if (body.defaultProviderId != null) patch.defaultProviderId = String(body.defaultProviderId);
      if (body.priceInputPerM != null) patch.priceInputPerM = Math.max(0, Number(body.priceInputPerM) || 0);
      if (body.priceOutputPerM != null) patch.priceOutputPerM = Math.max(0, Number(body.priceOutputPerM) || 0);
      return json(res, 200, { settings: setSettings(patch) });
    }
  }

  if (resource === "reveal" && method === "POST") {
    try {
      if (process.platform === "win32") spawn("explorer.exe", [IMAGES_DIR], { detached: true, stdio: "ignore" }).unref();
      else if (process.platform === "darwin") spawn("open", [IMAGES_DIR], { detached: true, stdio: "ignore" }).unref();
      else spawn("xdg-open", [IMAGES_DIR], { detached: true, stdio: "ignore" }).unref();
      return json(res, 200, { ok: true, dir: IMAGES_DIR });
    } catch (e) {
      return json(res, 500, { error: { message: "无法打开目录：" + e.message } });
    }
  }

  return json(res, 404, { error: { message: "未知接口 " + method + " " + pathname } });
}

async function handle(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  let pathname = url.pathname;
  try { pathname = decodeURIComponent(pathname); } catch (e) {}
  try {
    if (pathname === "/api" || pathname.indexOf("/api/") === 0) return await handleApi(req, res, url, pathname);
    if (pathname.indexOf("/files/") === 0) return serveImage(res, pathname);
    return serveStatic(res, pathname);
  } catch (e) {
    console.error("[error]", e);
    if (!res.headersSent) {
      return json(res, 500, { error: { message: e && e.message ? e.message : "服务器内部错误" } });
    }
    try { res.end(); } catch (err) {}
  }
}

if (listProviders().length === 0 && process.env.OPENAI_API_KEY) {
  try {
    createProvider({
      name: "OpenAI 官方",
      baseUrl: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
      model: "gpt-image-1"
    });
    console.log("[init] 已用环境变量 OPENAI_API_KEY 创建默认 Provider");
  } catch (e) {}
}

const server = http.createServer(handle);

// 每 15 秒把 WAL 落回主库，避免异常关机后数据只存在 -wal 文件里
const checkpointTimer = setInterval(function () { checkpoint(); }, 15000);
checkpointTimer.unref();
server.listen(PORT, HOST, function () {
  console.log("");
  console.log("  GPT Image Studio  v" + VERSION);
  console.log("  ->  http://" + HOST + ":" + PORT);
  console.log("  数据目录: " + DATA_DIR);
  if (!fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
    console.log("  [提示] 前端还没有构建。执行 pnpm build，或开发模式 pnpm dev");
  }
  console.log("");
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("");
  console.log("[shutdown] 收到 " + signal + "，正在保存数据并退出...");
  server.close(function () {
    closeDb();
    console.log("[shutdown] 已安全退出");
    process.exit(0);
  });
  setTimeout(function () {
    closeDb();
    process.exit(0);
  }, 3000);
}

process.on("SIGINT", function () { shutdown("SIGINT"); });
process.on("SIGTERM", function () { shutdown("SIGTERM"); });
process.on("SIGHUP", function () { shutdown("SIGHUP"); });

server.on("error", function (e) {
  if (e && e.code === "EADDRINUSE") {
    console.error("[error] 端口 " + PORT + " 已被占用，可用 PORT=8790 换一个端口启动");
    process.exit(1);
  }
  throw e;
});
