#!/usr/bin/env node
/**
 * One-command release pipeline for GPT Image Studio.
 *
 * Usage:
 *   node scripts/release.mjs                 # build + package + verify (no version change)
 *   node scripts/release.mjs patch           # 0.1.0 -> 0.1.1, then build/package/verify
 *   node scripts/release.mjs minor           # 0.1.0 -> 0.2.0
 *   node scripts/release.mjs 0.3.2           # explicit version
 *   node scripts/release.mjs --skip-build    # reuse existing server/public
 *   node scripts/release.mjs --skip-dist     # only build + verify (if release/ exists)
 *   node scripts/release.mjs --dry           # print the plan, change nothing
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const skipBuild = args.includes("--skip-build");
const skipDist = args.includes("--skip-dist");
const versionArg = args.find((a) => !a.startsWith("--"));

// Electron-based tooling breaks if this leaks in from a parent Electron process.
delete process.env.ELECTRON_RUN_AS_NODE;

// Default to domestic mirrors; a plain electron-builder run will otherwise try
// to download Electron / NSIS from GitHub and time out on many networks.
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/";
process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR || "https://npmmirror.com/mirrors/electron-builder-binaries/";

const pkgPath = path.join(root, "package.json");

function readPkg() {
  return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
}

function nextVersion(current, kind) {
  const parts = String(current).split(".").map((v) => Number(v) || 0);
  if (/^[0-9]+\.[0-9]+\.[0-9]+$/.test(kind)) return kind;
  if (kind === "major") return (parts[0] + 1) + ".0.0";
  if (kind === "minor") return parts[0] + "." + (parts[1] + 1) + ".0";
  if (kind === "patch") return parts[0] + "." + parts[1] + "." + (parts[2] + 1);
  return null;
}

function step(label, cmd, cmdArgs) {
  console.log("");
  console.log("==> " + label);
  console.log("    " + cmd + " " + cmdArgs.join(" "));
  if (dry) return;
  const result = spawnSync(cmd, cmdArgs, { cwd: root, stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    console.error("");
    console.error("[失败] " + label);
    console.error("提示：如果报 EBUSY/文件被占用，先结束所有 GPT Image Studio 进程再重试：");
    console.error("  Get-Process | Where-Object { $_.ProcessName -like '*GPT Image*' } | Stop-Process -Force");
    process.exit(result.status || 1);
  }
}

function main() {
  const pkg = readPkg();
  const target = versionArg ? nextVersion(pkg.version, versionArg) : null;
  if (versionArg && !target) {
    console.error("版本参数无效: " + versionArg + "（可用 patch / minor / major / x.y.z）");
    process.exit(1);
  }

  console.log("项目目录: " + root);
  console.log("当前版本: " + pkg.version + (target ? "  ->  " + target : "（不修改）"));
  console.log("Electron 镜像: " + process.env.ELECTRON_MIRROR);

  if (target && !dry) {
    pkg.version = target;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log("已更新 package.json version = " + target);
  }

  if (!skipBuild) {
    step("构建前端 (vite build)", process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build"]);
  } else {
    console.log("");
    console.log("==> 跳过前端构建（--skip-build）");
  }

  if (!skipDist) {
    step("打包 Windows 安装包 (electron-builder)", process.execPath, [
      path.join(root, "node_modules", "electron-builder", "cli.js"),
      "--win",
      "nsis"
    ]);
    step("验证安装产物 (verify-release)", process.execPath, [path.join(root, "scripts", "verify-release.mjs")]);
  } else {
    console.log("");
    console.log("==> 跳过打包（--skip-dist）");
  }

  const version = (target || pkg.version);
  const artifact = path.join(root, "release", "GPT-Image-Studio-" + version + "-Setup.exe");
  console.log("");
  if (fs.existsSync(artifact)) {
    const stat = fs.statSync(artifact);
    console.log("安装包: " + artifact);
    console.log("体积:   " + (stat.size / 1024 / 1024).toFixed(1) + " MB");
  } else if (!skipDist) {
    console.log("未找到预期安装包，请检查 release/ 目录");
  }

  console.log("");
  console.log("下一步：");
  console.log("  1. 双击安装包自己走一遍安装/启动流程");
  console.log("  2. git add -A && git commit -m \"release: v" + version + "\"");
  console.log("  3. git tag v" + version + " && git push origin main --tags");
  console.log("  4. 到 GitHub Releases 新建 v" + version + "，把上面的 Setup.exe 拖进 Assets");
}

main();
