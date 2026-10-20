import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, ".tmp", "smoke-data");
fs.rmSync(dataDir, { recursive: true, force: true });

const APP = "http://127.0.0.1:8790";
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
  start("mock", [path.join(root, "scripts", "mock-upstream.mjs")], { MOCK_PORT: "9911" });
  start("app", [path.join(root, "server", "index.mjs")], { PORT: "8790", DATA_DIR: dataDir });

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
      baseUrl: "http://127.0.0.1:9911/v1",
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

  r = await req("/api/generate", { method: "POST", body: JSON.stringify({ providerId: providerId, prompt: "   ", params: {} }) });
  assert(r.status === 400, "空提示词被拦截", r.json);

  r = await req("/api/providers/" + providerId, { method: "PATCH", body: JSON.stringify({ name: "Mock 上游（改名）" }) });
  assert(r.status === 200 && r.json.provider.name === "Mock 上游（改名）", "编辑 Provider", r.json);

  r = await req("/api/settings", { method: "PUT", body: JSON.stringify({ concurrency: 3, defaultProviderId: providerId }) });
  assert(r.status === 200 && r.json.settings.concurrency === 3, "保存设置", r.json);
  r = await req("/api/settings");
  assert(r.json.settings.defaultProviderId === providerId, "设置持久化", r.json);

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
