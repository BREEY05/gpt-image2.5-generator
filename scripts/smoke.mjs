import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".tmp", "smoke-data");
fs.rmSync(dataDir, { recursive: true, force: true });

let APP = "http://127.0.0.1:8790";
let MOCK = "http://127.0.0.1:9911";

// Windows 可能把一段端口保留给 Hyper-V/WinNAT，此时 bind 会 EACCES，
// 所以测试也不能写死端口，从基准端口往后找第一个能监听的。
function canBind(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function pickPort(start, count) {
  for (let p = start; p < start + (count || 400); p += 1) {
    if (await canBind(p)) return p;
  }
  return 0;
}
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const failures = [];
const children = [];

function start(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: Object.assign({}, process.env, env),
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (d) => console.log("  [" + name + "] " + d.toString().trimEnd()));
  child.stderr.on("data", (d) => console.log("  [" + name + "] " + d.toString().trimEnd()));
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    try { child.kill(); } catch (e) {}
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert(cond, label, extra) {
  if (cond) {
    console.log("PASS  " + label);
  } else {
    failures.push(label);
    console.log("FAIL  " + label + (extra ? "  ::  " + JSON.stringify(extra).slice(0, 400) : ""));
  }
}

async function req(pathname, init) {
  const res = await fetch(APP + pathname, Object.assign({ headers: { "Content-Type": "application/json" } }, init));
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) {}
  return { status: res.status, json: json, text: text, headers: res.headers };
}

async function fetchFile(url) {
  const res = await fetch(APP + url);
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type"), buf: buf };
}

async function waitFor(check, tries, gap) {
  for (let i = 0; i < tries; i += 1) {
    try {
      if (await check()) return true;
    } catch (e) {}
    await sleep(gap || 250);
  }
  return false;
}

async function main() {
  const mockPort = await pickPort(9911);
  const appPort = await pickPort(8790);
  if (!mockPort || !appPort) {
    console.log("FAIL  找不到可用端口（mock/app）");
    process.exit(1);
  }
  APP = "http://127.0.0.1:" + appPort;
  MOCK = "http://127.0.0.1:" + mockPort;
  start("mock", [path.join(root, "scripts", "mock-upstream.mjs")], { MOCK_PORT: String(mockPort) });
  start("app", [path.join(root, "server", "index.mjs")], { PORT: String(appPort), DATA_DIR: dataDir });

  const up = await waitFor(async () => (await req("/api/health")).status === 200, 40, 250);
  assert(up, "服务启动 /api/health");
  if (!up) return;

  let r = await req("/api/state");
  assert(r.status === 200 && Array.isArray(r.json.providers) && r.json.providers.length === 0, "初始 state 为空", r.json);
  assert(r.status === 200 && Array.isArray(r.json.presets) && r.json.presets.length >= 5, "返回模型能力预设", r.json && r.json.presets && r.json.presets.length);

  r = await req("/api/providers", {
    method: "POST",
    body: JSON.stringify({
      name: "Mock 上游",
      baseUrl: MOCK + "/v1",
      authStyle: "bearer",
      apiKey: "sk-mock-secret-1234",
      model: "gpt-image-2.5-flare"
    })
  });
  assert(r.status === 201 && r.json.provider && r.json.provider.hasKey, "创建 Provider", r.json);
  assert(r.json.provider.keyMasked === "sk-...1234", "Key 只返回掩码", r.json.provider && r.json.provider.keyMasked);
  assert(!JSON.stringify(r.json).includes("sk-mock-secret"), "响应中不含明文 Key");
  const providerId = r.json.provider.id;

  r = await req("/api/providers/" + providerId + "/test", { method: "POST", body: JSON.stringify({ deep: false }) });
  assert(r.status === 200 && r.json.ok === true, "连通性测试（/models）", r.json);
  assert(r.json.models && r.json.models.length >= 5, "连通性测试返回模型列表", r.json && r.json.models && r.json.models.length);

  r = await req("/api/providers/" + providerId + "/models");
  const ids = (r.json.models || []).map((m) => m.id);
  assert(r.status === 200 && ids.indexOf("gpt-image-1") !== -1, "拉取模型列表", ids);
  assert(ids.indexOf("text-embedding-3-small") === -1, "过滤掉非图片模型", ids);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      providerId: providerId,
      prompt: "a calm gradient poster, minimal",
      mode: "generate",
      params: {
        model: "gpt-image-2.5-flare",
        size: "1024x1024",
        quality: "medium",
        n: 2,
        output_format: "png",
        background: "auto",
        output_compression: 90,
        moderation: "auto"
      }
    })
  });
  assert(r.status === 200 && r.json.generation && r.json.generation.files.length === 2, "生成 2 张图片", r.json && r.json.error);
  const files = (r.json.generation && r.json.generation.files) || [];
  const firstFile = files[0];
  const diskPath = firstFile ? path.join(dataDir, "images", path.basename(firstFile)) : "";
  assert(!!firstFile && fs.existsSync(diskPath), "图片已落盘", diskPath);
  assert(!!firstFile && fs.statSync(diskPath).size > 5000, "图片文件非空", firstFile);

  const imgRes = await fetch(APP + firstFile);
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  assert(imgRes.status === 200 && imgRes.headers.get("content-type") === "image/png", "静态图片可访问", imgRes.status);
  assert(imgBuf.length > 5000 && imgBuf[0] === 0x89 && imgBuf[1] === 0x50, "返回的是合法 PNG", imgBuf.length);

  r = await req("/api/generations?limit=10");
  assert(r.status === 200 && r.json.generations.length >= 1, "历史记录可读", r.json && r.json.generations && r.json.generations.length);

  const newest = r.json.generations[0];
  assert(!!newest && !!newest.tokens && newest.tokens.totalTokens > 0, "生成记录带 token 统计", newest && newest.tokens);
  assert(!!newest && newest.imageCount === 2, "生成记录带图片数量", newest && newest.imageCount);

  r = await req("/api/providers/" + providerId + "/quota");
  assert(
    r.status === 200 && r.json.available === true && Math.abs(Number(r.json.remaining) - 42.5) < 0.001,
    "额度接口读取 /credits",
    r.json
  );

  r = await req("/api/usage?providerId=" + providerId);
  assert(r.status === 200 && r.json.today.images === 2 && r.json.today.totalTokens > 0, "用量统计聚合", r.json && r.json.today);

  r = await req("/api/settings", { method: "PUT", body: JSON.stringify({ priceInputPerM: 10, priceOutputPerM: 40 }) });
  assert(r.status === 200 && r.json.settings.priceOutputPerM === 40, "保存 token 单价", r.json);
  r = await req("/api/usage?providerId=" + providerId);
  assert(r.status === 200 && r.json.today.costUsd > 0, "按单价估算花费", r.json && r.json.today);

  const tiny = "data:image/png;base64," + TINY_PNG;
  const editParams = { model: "gpt-image-2.5-sunburst", size: "1024x1024", quality: "low", n: 1, output_format: "png", background: "auto" };

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "EXPECT2 two references", mode: "edit", images: [tiny, tiny], params: editParams })
  });
  assert(r.status === 200 && r.json.generation && r.json.generation.mode === "edit" && r.json.generation.files.length === 1, "多参考图编辑（2 张）", r.json && r.json.error);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "EXPECT1 legacy single", mode: "edit", image: tiny, params: editParams })
  });
  assert(r.status === 200 && r.json.generation && r.json.generation.mode === "edit", "旧版单图字段 image 兼容", r.json && r.json.error);

  r = await req("/api/generate", { method: "POST", body: JSON.stringify({ providerId: providerId, prompt: "no image", mode: "edit", params: editParams }) });
  assert(r.status === 400 && r.json.error.message.indexOf("参考图") !== -1, "编辑模式无参考图被拦截", r.json && r.json.error);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "too many", mode: "edit", images: new Array(17).fill(tiny), params: editParams })
  });
  assert(r.status === 400 && r.json.error.message.indexOf("16") !== -1, "超过 16 张参考图被拦截", r.json && r.json.error);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "MOCKBADARRAY fallback", mode: "edit", images: [tiny, tiny], params: editParams })
  });
  assert(r.status === 200 && r.json.generation, "image[] 不被接受时回退为重复 image 字段", r.json && r.json.error);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      providerId: providerId,
      prompt: "MOCK401 should fail",
      mode: "generate",
      params: { model: "gpt-image-2.5-flare", size: "1024x1024", quality: "low", n: 1, output_format: "png", background: "auto", output_compression: 90, moderation: "auto" }
    })
  });
  assert(r.status === 401 && r.json.error && r.json.error.message.indexOf("Incorrect API key") !== -1, "上游 401 透传为可读错误", r.json && r.json.error);
  assert(r.json.error.hint && r.json.error.hint.length > 0, "401 附带修复提示", r.json && r.json.error && r.json.error.hint);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "MOCKHTML502 gateway page", mode: "generate", params: { model: "gpt-image-2.5-flare", size: "1024x1024", quality: "low", n: 1, output_format: "png", background: "auto", output_compression: 90, moderation: "auto" } })
  });
  assert(r.status === 502, "HTML 网关页判为 502", r.status);
  const htmlErr = (r.json && r.json.error) || {};
  assert(!!htmlErr.message && htmlErr.message.indexOf("网页") !== -1, "HTML 错误翻译成人话（不是整页标签）", htmlErr.message);
  assert(!!htmlErr.message && htmlErr.message.indexOf("502 Bad Gateway") !== -1, "HTML 错误带出页面标题", htmlErr.message);
  assert(!!htmlErr.message && htmlErr.message.indexOf("<!DOCTYPE") === -1 && htmlErr.message.length < 400, "HTML 错误不把原始标签糊到界面", (htmlErr.message || "").length);
  assert(!!htmlErr.hint && htmlErr.hint.indexOf("网关错误") !== -1, "网关 502 页提示「中转站自己挂了」", htmlErr.hint);
  assert(!!htmlErr.hint && htmlErr.hint.indexOf(MOCK + "/v1/images/generations") !== -1, "提示里带出实际请求地址", htmlErr.hint);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "MOCKHTMLCF challenge", mode: "generate", params: { model: "gpt-image-2.5-flare", size: "1024x1024", quality: "low", n: 1, output_format: "png", background: "auto", output_compression: 90, moderation: "auto" } })
  });
  const cfErr = (r.json && r.json.error) || {};
  assert(r.status === 403 && !!cfErr.hint && cfErr.hint.indexOf("人机验证") !== -1, "Cloudflare 人机验证给出专属提示", cfErr.hint);
  assert(r.json.generation && r.json.generation.errorHint === cfErr.hint, "错误提示持久化到记录", r.json && r.json.generation && r.json.generation.errorHint);


  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "MOCKHTML200 homepage", mode: "generate", params: { model: "gpt-image-2.5-flare", size: "1024x1024", quality: "low", n: 1, output_format: "png", background: "auto", output_compression: 90, moderation: "auto" } })
  });
  const homeErr = (r.json && r.json.error) || {};
  assert(r.status === 502 && !!homeErr.message && homeErr.message.indexOf("某中转站") !== -1, "200 但返回网页时识别为「不是 JSON」", homeErr.message);

  // Base URL 误粘成完整接口地址时，应自动剥掉后缀而不是拼出 /v1/images/generations/v1
  r = await req("/api/providers", {
    method: "POST",
    body: JSON.stringify({ name: "粘了完整接口地址", baseUrl: MOCK + "/v1/images/generations/", authStyle: "bearer", apiKey: "sk-mock-other-9999", model: "gpt-image-2.5-flare" })
  });
  const gluedId = r.json.provider.id;
  r = await req("/api/providers/" + gluedId + "/test", { method: "POST", body: JSON.stringify({ deep: false }) });
  assert(r.status === 200 && r.json.ok === true, "完整接口地址粘贴到 Base URL 也能连通", r.json);
  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: gluedId, prompt: "base url with endpoint suffix", mode: "generate", params: { model: "gpt-image-2.5-flare", size: "1024x1024", quality: "low", n: 1, output_format: "png", background: "auto", output_compression: 90, moderation: "auto" } })
  });
  assert(r.status === 200 && r.json.generation && r.json.generation.files.length === 1, "完整接口地址粘贴到 Base URL 也能出图", r.json && r.json.error);
  await req("/api/providers/" + gluedId, { method: "DELETE" });

  r = await req("/api/generate", { method: "POST", body: JSON.stringify({ providerId: providerId, prompt: "   ", params: {} }) });
  assert(r.status === 400, "空提示词被拦截", r.json);

  r = await req("/api/providers/" + providerId, { method: "PATCH", body: JSON.stringify({ name: "Mock 上游（改名）" }) });
  assert(r.status === 200 && r.json.provider.name === "Mock 上游（改名）", "编辑 Provider", r.json);

  r = await req("/api/settings", { method: "PUT", body: JSON.stringify({ concurrency: 3, defaultProviderId: providerId }) });
  assert(r.status === 200 && r.json.settings.concurrency === 3, "保存设置", r.json);
  r = await req("/api/settings");
  assert(r.json.settings.defaultProviderId === providerId, "设置持久化", r.json);

  // ---- 2.6 / 新格式 / 新参数 ----
  r = await req("/api/state");
  const presets = (r.json && r.json.presets) || [];
  const pSun = presets.find((p) => p.id === "gpt-image-2.6-sunburst");
  const pFla = presets.find((p) => p.id === "gpt-image-2.6-flare");
  assert(!!pSun && !!pFla, "预设包含 2.6 sunburst / flare", presets.map((p) => p.id));
  assert(!!pSun && pSun.formats.indexOf("gif") !== -1 && pSun.formats.indexOf("svg") !== -1, "2.6 预设支持 GIF / SVG", pSun && pSun.formats);
  assert(!!pSun && pSun.complexity === true && pSun.gif === true && pSun.svg === true && pSun.markup === true, "2.6 预设声明新能力", pSun);

  const p26 = { model: "gpt-image-2.6-sunburst", size: "1024x1024", quality: "low", n: 1, output_format: "png", background: "auto", moderation: "auto" };

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "EXPECTCOMPLEXITY complexity passthrough", mode: "generate", params: Object.assign({}, p26, { complexity: "low" }) })
  });
  assert(r.status === 200 && r.json.generation && r.json.generation.params.complexity === "low", "complexity 透传到上游", r.json && r.json.error);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      providerId: providerId,
      prompt: "EXPECTGIF animation frames",
      mode: "generate",
      params: Object.assign({}, p26, { n: 3, output_format: "gif", background: "transparent", frame_count: 4, frame_duration_ms: 350 })
    })
  });
  const gifGen = (r.json && r.json.generation) || null;
  assert(r.status === 200 && !!gifGen && gifGen.files.length === 1, "GIF 生成（强制 1 张）", r.json && r.json.error);
  assert(
    !!gifGen && gifGen.params.n === 1 && (gifGen.params.background === undefined || gifGen.params.background === "auto"),
    "GIF 时 n/background 被收敛",
    gifGen && gifGen.params
  );
  assert(!!gifGen && /\.gif$/.test(gifGen.files[0]), "GIF 落盘扩展名为 .gif", gifGen && gifGen.files);
  const gifFile = gifGen ? await fetchFile(gifGen.files[0]) : { status: 0, type: "", buf: Buffer.alloc(0) };
  assert(gifFile.status === 200 && String(gifFile.type).indexOf("image/gif") !== -1, "GIF content-type 正确", gifFile.type);
  assert(gifFile.buf.slice(0, 6).toString("ascii") === "GIF89a", "GIF 魔数正确", gifFile.buf.slice(0, 6).toString("ascii"));
  assert(!!gifGen && gifGen.params.frame_count === 4 && gifGen.params.frame_duration_ms === 350, "GIF 帧参数写入记录", gifGen && gifGen.params);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "EXPECTSVG vector output", mode: "generate", params: Object.assign({}, p26, { output_format: "svg" }) })
  });
  const svgGen = (r.json && r.json.generation) || null;
  assert(r.status === 200 && !!svgGen && /\.svg$/.test(svgGen.files[0]), "SVG 落盘扩展名为 .svg", r.json && r.json.error);
  const svgFile = svgGen ? await fetchFile(svgGen.files[0]) : { status: 0, type: "", buf: Buffer.alloc(0) };
  assert(svgFile.status === 200 && String(svgFile.type).indexOf("svg") !== -1, "SVG content-type 正确", svgFile.type);
  assert(svgFile.buf.slice(0, 500).toString("utf8").indexOf("<svg") !== -1, "SVG 内容是矢量文本", svgFile.buf.slice(0, 80).toString("utf8"));

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "bad frames", mode: "generate", params: Object.assign({}, p26, { output_format: "gif", frame_count: 1 }) })
  });
  assert(r.status === 400 && r.json.error.message.indexOf("帧数") !== -1, "GIF 帧数越界被拦截", r.json && r.json.error);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "bad duration", mode: "generate", params: Object.assign({}, p26, { output_format: "gif", frame_duration_ms: 0 }) })
  });
  assert(r.status === 400 && r.json.error.message.indexOf("帧间隔") !== -1, "GIF 帧间隔非法被拦截", r.json && r.json.error);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({
      providerId: providerId,
      prompt: "gif with mask",
      mode: "edit",
      images: [tiny],
      mask: tiny,
      params: Object.assign({}, p26, { output_format: "gif" })
    })
  });
  assert(r.status === 400 && r.json.error.message.indexOf("GIF") !== -1, "GIF 编辑带遮罩被拦截", r.json && r.json.error);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "EXPECTMARKUP guide layer", mode: "edit", images: [tiny], markup: tiny, params: p26 })
  });
  assert(r.status === 200 && r.json.generation && r.json.generation.mode === "edit", "markup 标记图层编辑", r.json && r.json.error);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "mask and markup", mode: "edit", images: [tiny], mask: tiny, markup: tiny, params: p26 })
  });
  assert(r.status === 400 && r.json.error.message.indexOf("不能同时") !== -1, "遮罩与标记图层互斥", r.json && r.json.error);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "markup jpeg", mode: "edit", images: [tiny], markup: "data:image/jpeg;base64," + TINY_PNG, params: p26 })
  });
  assert(r.status === 400 && r.json.error.message.indexOf("PNG") !== -1, "标记图层必须 PNG", r.json && r.json.error);

  r = await req("/api/generate", {
    method: "POST",
    body: JSON.stringify({ providerId: providerId, prompt: "MOCKNOFMT ignore requested gif", mode: "generate", params: Object.assign({}, p26, { output_format: "gif" }) })
  });
  const nofmtGen = (r.json && r.json.generation) || null;
  assert(r.status === 200 && !!nofmtGen && /\.png$/.test(nofmtGen.files[0]), "中转忽略格式时按真实 PNG 落盘", r.json && r.json.error);
  assert(!!nofmtGen && nofmtGen.outputFormatActual === "png", "记录真实输出格式", nofmtGen && nofmtGen.outputFormatActual);
  assert(!!nofmtGen && typeof nofmtGen.formatNote === "string" && nofmtGen.formatNote.length > 0, "格式不符时给出提示", nofmtGen && nofmtGen.formatNote);

  const longPrompt = "很长的提示词：" + "雪山、湖泊与极光的电影感画面，".repeat(20);
  r = await req("/api/generate", { method: "POST", body: JSON.stringify({ providerId: providerId, prompt: longPrompt, mode: "generate", params: p26 }) });
  const longId = r.json && r.json.generation && r.json.generation.id;
  r = await req("/api/generations?limit=100");
  const longRow = ((r.json && r.json.generations) || []).find((g) => g.id === longId);
  assert(!!longRow && longRow.prompt === longPrompt, "历史记录保存完整提示词（不截断）", longRow && longRow.prompt && longRow.prompt.length);

  const rawDb = fs.readFileSync(path.join(dataDir, "app.db"));
  assert(rawDb.indexOf("sk-mock-secret-1234") === -1, "数据库中没有明文 Key");

  const deep = await req("/api/providers/" + providerId + "/test", { method: "POST", body: JSON.stringify({ deep: true }) });
  assert(deep.status === 200 && deep.json.ok === true, "深度测试（真实出图）", deep.json);

  r = await req("/api/generations/" + deep.json.generation?.id, { method: "DELETE" });
  assert(r.status === 200 || r.status === 404, "删除记录接口可用", r.status);

  r = await req("/");
  const indexFile = path.join(root, "server", "public", "index.html");
  assert(fs.existsSync(indexFile) && r.status === 200 && r.text.length > 100, "前端静态页可访问", r.status);

  r = await req("/files/..%2F..%2Fapp.db");
  assert(r.status === 403 || r.status === 404, "路径穿越被拦截", r.status);
}

main()
  .catch((e) => {
    failures.push("exception");
    console.log("EXCEPTION " + (e && e.stack ? e.stack : e));
  })
  .finally(async () => {
    await sleep(200);
    stopAll();
    console.log("");
    if (failures.length) {
      console.log("SMOKE FAILED: " + failures.length + " 项失败 -> " + failures.join(" | "));
      process.exit(1);
    }
    console.log("SMOKE PASSED: 全部断言通过");
    process.exit(0);
  });
