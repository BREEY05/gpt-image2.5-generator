import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "data", "server/public", ".tmp", "dist"]);
const BINARY = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff2", ".zip", ".pdf", ".mp4"]);
const MAX_BYTES = 2 * 1024 * 1024;

const RULES = [
  { id: "OpenAI 风格 Key（sk-...）", test: (line) => /sk-[A-Za-z0-9_-]{24,}/.test(line) },
  { id: "Authorization: Bearer 长串", test: (line) => /Bearer [A-Za-z0-9._-]{32,}/.test(line) },
  { id: "疑似硬编码密钥赋值", test: (line) => /(API_KEY|SECRET|TOKEN)[ \t]*=[ \t]*["']?[A-Za-z0-9._-]{24,}/.test(line) }
];

const SENSITIVE_PATHS = [
  { id: "运行数据目录", test: (p) => p === "data" || p.indexOf("data/") === 0 },
  { id: "SQLite 数据库", test: (p) => p.endsWith(".db") || p.endsWith(".db-wal") || p.endsWith(".db-shm") },
  { id: "加密密钥文件", test: (p) => p.endsWith(".secret") },
  { id: "环境变量文件", test: (p) => path.basename(p).indexOf(".env") === 0 },
  { id: "私钥/证书", test: (p) => p.endsWith(".pem") || p.endsWith(".key") || p.endsWith(".p12") }
];

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, acc);
    } else {
      acc.push(rel);
    }
  }
  return acc;
}

function listFiles() {
  try {
    const out = execSync("git ls-files -z --cached --others --exclude-standard", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const files = out.split(String.fromCharCode(0)).filter(Boolean);
    if (files.length) return files;
  } catch (e) {}
  return walk(root, []);
}

const files = listFiles();
const findings = [];

for (const rel of files) {
  if (rel === "pnpm-lock.yaml") continue;
  const full = path.join(root, rel);
  for (const rule of SENSITIVE_PATHS) {
    if (rule.test(rel)) findings.push({ file: rel, line: 0, rule: rule.id, sample: "" });
  }
  if (BINARY.has(path.extname(rel).toLowerCase())) continue;
  let stat = null;
  try { stat = fs.statSync(full); } catch (e) { continue; }
  if (!stat.isFile() || stat.size > MAX_BYTES) continue;
  const text = fs.readFileSync(full, "utf8");
  if (text.indexOf(String.fromCharCode(0)) !== -1) continue;
  const lines = text.split(String.fromCharCode(10));
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of RULES) {
      if (rule.test(line)) {
        findings.push({ file: rel, line: i + 1, rule: rule.id, sample: line.trim().slice(0, 60) });
      }
    }
  }
}

console.log("扫描文件数: " + files.length);
if (!findings.length) {
  console.log("未发现泄漏迹象（Key、data/ 目录、数据库、.env 均不在提交范围内）");
  process.exit(0);
}

console.log("");
console.log("发现 " + findings.length + " 处需要人工确认：");
for (const f of findings) {
  const where = f.line ? f.file + ":" + f.line : f.file;
  console.log("  [" + f.rule + "] " + where + (f.sample ? "   " + f.sample : ""));
}
console.log("");
console.log("如果确实是密钥：立刻到服务商后台吊销并重建，然后再提交。");
process.exit(1);
