import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || "8787";
const ORIGIN = "http://127.0.0.1:" + PORT;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function isUp() {
  try {
    const res = await fetch(ORIGIN + "/api/health", { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function openBrowser(url) {
  if (process.env.GIS_NO_OPEN === "1") return;
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch (e) {}
}

async function main() {
  console.log("[1/3] 检查本地服务...");
  if (await isUp()) {
    console.log("      服务已经在运行：" + ORIGIN);
    openBrowser(ORIGIN);
    console.log("      已打开浏览器，这个窗口可以直接关闭");
    await sleep(1500);
    return;
  }

  const indexFile = path.join(root, "server", "public", "index.html");
  if (!fs.existsSync(indexFile)) {
    console.log("[2/3] 首次启动：构建前端（大约 20 秒）...");
    const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
    const result = spawnSync(process.execPath, [viteBin, "build"], { cwd: root, stdio: "inherit" });
    if (result.status !== 0) {
      console.error("构建失败，请把上面的报错发给开发者");
      process.exit(1);
    }
  } else {
    console.log("[2/3] 前端已构建，跳过");
  }

  console.log("[3/3] 启动服务...");
  const server = spawn(process.execPath, [path.join(root, "server", "index.mjs")], { cwd: root, stdio: "inherit" });

  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    if (await isUp()) {
      ready = true;
      break;
    }
  }
  if (!ready) {
    console.error("服务没有正常启动，请看上面的日志");
    process.exit(1);
  }

  console.log("");
  console.log("  已启动: " + ORIGIN);
  console.log("  关闭这个窗口或按 Ctrl+C 即可停止服务");
  console.log("  下次再打开：双击 start.bat");
  console.log("");
  openBrowser(ORIGIN);

  const shutdown = function () {
    try { server.kill(); } catch (e) {}
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  server.on("exit", function (code) {
    console.log("服务已停止（exit " + code + "）");
    process.exit(code || 0);
  });
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
