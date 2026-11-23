import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_PORT = Number(process.env.PORT || 8787);
// 8787 起往后找。Windows 有时会把一段端口「保留」给 Hyper-V/WinNAT
// （netsh interface ipv4 show excludedportrange protocol=tcp 可以查到），
// 这时 bind 会直接 EACCES，所以不能写死端口。
const SCAN = 400;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function origin(port) {
  return "http://127.0.0.1:" + port;
}

async function isUp(port) {
  try {
    const res = await fetch(origin(port) + "/api/health", { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function canBind(port) {
  return new Promise(function (resolve) {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", function () { resolve(false); });
    srv.listen(port, "127.0.0.1", function () {
      srv.close(function () { resolve(true); });
    });
  });
}

async function findRunning() {
  for (let p = BASE_PORT; p < BASE_PORT + SCAN; p += 1) {
    if (await isUp(p)) return p;
  }
  return 0;
}

async function findFree() {
  for (let p = BASE_PORT; p < BASE_PORT + SCAN; p += 1) {
    if (await canBind(p)) return p;
  }
  return 0;
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
  const running = await findRunning();
  if (running) {
    console.log("      服务已经在运行：" + origin(running));
    openBrowser(origin(running));
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
  const port = await findFree();
  if (!port) {
    console.error("从 " + BASE_PORT + " 往后 " + SCAN + " 个端口都不可用，请检查防火墙 / 端口保留设置");
    process.exit(1);
  }
  if (port !== BASE_PORT) {
    console.log("      端口 " + BASE_PORT + " 被系统保留或占用，改用 " + port);
  }
  const url = origin(port);
  const server = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: Object.assign({}, process.env, { PORT: String(port) })
  });

  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    await sleep(250);
    if (await isUp(port)) {
      ready = true;
      break;
    }
  }
  if (!ready) {
    console.error("服务没有正常启动，请看上面的日志");
    process.exit(1);
  }

  console.log("");
  console.log("  已启动: " + url);
  console.log("  关闭这个窗口或按 Ctrl+C 即可停止服务");
  console.log("  下次再打开：双击 start.bat");
  console.log("");
  openBrowser(url);

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
