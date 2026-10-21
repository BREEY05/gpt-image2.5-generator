#!/usr/bin/env node
/**
 * Release artifact verifier for GPT Image Studio.
 *
 * Scans release/win-unpacked/resources/app (the exact directory that gets
 * installed on the user's machine) and fails with exit code 1 when it finds
 * data that must never ship:
 *   - data/ directories (local database / generated images)
 *   - *.db (and -wal / -shm siblings)
 *   - *.secret, .secret
 *   - .env (and .env.* variants)
 *   - hard-coded API keys matching sk-[A-Za-z0-9_-]{24,}
 *
 * It also asserts that the mandatory runtime pieces are present:
 *   - server/public/index.html (built frontend)
 *   - the Electron entry declared by package.json "main"
 *   - server/index.mjs
 *
 * Usage: node scripts/verify-release.mjs [appDir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const appDir = path.resolve(process.argv[2] || path.join(repoRoot, "release", "win-unpacked", "resources", "app"));

const failures = [];
const warnings = [];
const stats = { files: 0, dirs: 0, bytes: 0, scannedForSecrets: 0 };

function fail(message) {
  failures.push(message);
  console.error("FAIL  " + message);
}

function warn(message) {
  warnings.push(message);
  console.warn("WARN  " + message);
}

function isBinary(buf) {
  const limit = Math.min(buf.length, 1024);
  for (let i = 0; i < limit; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

const TEXT_EXT = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".json", ".html", ".htm",
  ".css", ".map", ".txt", ".md", ".yml", ".yaml", ".toml", ".ini", ".cfg",
  ".svg", ".xml", ".env", ".sh", ".bat", ".ps1", ".py", ".log",
]);

function looksTextual(file) {
  const ext = path.extname(file).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  const base = path.basename(file).toLowerCase();
  return base === "package.json" || base.startsWith(".env") || base === ".secret";
}

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    fail("无法读取目录 " + dir + ": " + error.message);
    return;
  }
  entries.sort(function (a, b) { return a.name.localeCompare(b.name); });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(appDir, full).replaceAll(path.sep, "/");
    if (entry.isSymbolicLink()) {
      warn("跳过符号链接: " + rel);
      continue;
    }
    if (entry.isDirectory()) {
      stats.dirs += 1;
      if (entry.name === "data" || rel === "data" || rel.startsWith("data/")) {
        fail("发现数据目录: resources/app/" + rel + "/");
      }
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    stats.files += 1;
    let size = 0;
    try { size = fs.statSync(full).size; } catch (e) { size = 0; }
    stats.bytes += size;

    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".db") || lower.endsWith(".db-wal") || lower.endsWith(".db-shm") || lower.endsWith(".sqlite")) {
      fail("发现数据库文件: resources/app/" + rel + " (" + size + " bytes)");
    }
    if (lower === ".secret" || lower.endsWith(".secret")) {
      fail("发现密钥文件: resources/app/" + rel);
    }
    if (lower === ".env" || lower.startsWith(".env.")) {
      fail("发现环境变量文件: resources/app/" + rel);
    }
    if (size <= 4 * 1024 * 1024 && looksTextual(full)) {
      let buf;
      try { buf = fs.readFileSync(full); } catch (e) { continue; }
      if (!isBinary(buf)) {
        stats.scannedForSecrets += 1;
        const text = buf.toString("utf8");
        const match = /sk-[A-Za-z0-9_-]{24,}/.exec(text);
        if (match) {
          fail("发现疑似 API Key: resources/app/" + rel + " -> " + match[0].slice(0, 8) + "...");
        }
      }
    }
  }
}

function requireFile(relPath, label) {
  const full = path.join(appDir, relPath);
  if (!fs.existsSync(full)) return fail("缺少" + label + ": resources/app/" + relPath);
  const stat = fs.statSync(full);
  if (!stat.isFile() || stat.size === 0) return fail(label + "为空或不是文件: resources/app/" + relPath);
  console.log("OK    " + label + ": resources/app/" + relPath + " (" + stat.size + " bytes)");
  return full;
}

console.log("扫描目录: " + appDir);
if (!fs.existsSync(appDir) || !fs.statSync(appDir).isDirectory()) {
  console.error("FAIL  目录不存在，请先执行构建：pnpm dist，或 electron-builder --win --dir（" + appDir + "）");
  process.exit(1);
}

walk(appDir);

const packageFile = requireFile("package.json", "应用 manifest");
let mainRel = "";
if (packageFile) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    mainRel = String(pkg.main || "");
    if (!mainRel) fail("package.json 缺少 main 字段");
  } catch (error) {
    fail("package.json 无法解析: " + error.message);
  }
}
if (mainRel) {
  const mainFile = requireFile(mainRel.replaceAll("\\", "/"), "Electron 入口");
  if (mainFile && !mainRel.replaceAll("\\", "/").startsWith("electron/")) {
    warn("Electron 入口不在 electron/ 下: " + mainRel);
  }
}
requireFile("server/index.mjs", "后端入口");
requireFile("server/public/index.html", "前端构建产物");

if (!fs.existsSync(path.join(appDir, "server", "public", "assets"))) {
  warn("server/public/assets 不存在，前端可能没有构建（仅 index.html 不够）");
}

// Packaged data must live in userData, never inside the install dir.
const resourcesRoot = path.dirname(appDir);
for (const suspect of ["data", ".secret", "app.db"]) {
  if (fs.existsSync(path.join(resourcesRoot, suspect))) fail("安装资源根目录出现运行时数据: " + suspect);
}

console.log("");
console.log("files=" + stats.files + ", dirs=" + stats.dirs + ", size=" + (stats.bytes / 1024 / 1024).toFixed(2) + " MB" +
  ", text scanned=" + stats.scannedForSecrets);
if (warnings.length) console.warn("WARN 共 " + warnings.length + " 条警告（见上）。");

if (failures.length) {
  console.error("\n发布物验证失败：发现 " + failures.length + " 个问题。");
  process.exit(1);
}
console.log("发布物验证通过：无数据目录、无数据库/密钥/环境变量文件、无硬编码 API Key。");