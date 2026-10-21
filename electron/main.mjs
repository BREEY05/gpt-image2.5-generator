import { app, BrowserWindow, dialog, shell } from "electron";
import http from "node:http";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// GPT Image Studio desktop shell.
//
// The whole web app (React build + zero-dependency Node API) lives under
// resources/app. server/index.mjs is reused unchanged: it runs as a child
// Node process with DATA_DIR pointed at the per-user profile, so the installed
// directory is never written to.
// ---------------------------------------------------------------------------

const PRODUCT_NAME = "GPT Image Studio";
const APP_ID = "com.gptimagestudio.app";
const SERVER_ENTRY_REL = path.join("server", "index.mjs");
const HEALTH_TIMEOUT_MS = 45000;

const isHeadless = process.env.GIS_HEADLESS === "1" || process.env.GIS_HEADLESS === "true";

// Must run before app is ready so app.getPath("userData") uses our name.
app.setName(PRODUCT_NAME);
app.setAppUserModelId(APP_ID);

let mainWindow = null;
let serverChild = null;
let serverPort = 0;
let serverLog = null;
let quitting = false;

function log() {
  const parts = [];
  for (let i = 0; i < arguments.length; i += 1) {
    const value = arguments[i];
    if (value instanceof Error) parts.push(value.stack || value.message);
    else if (typeof value === "string") parts.push(value);
    else {
      try { parts.push(JSON.stringify(value)); } catch (e) { parts.push(String(value)); }
    }
  }
  const line = parts.join(" ");
  console.log("[gpt-image-studio] " + line);
  if (serverLog) {
    try { serverLog.write("[" + new Date().toISOString() + "] " + line + "\n"); } catch (e) {}
  }
}

function appRoot() {
  return app.getAppPath();
}

function isInside(parent, child) {
  if (!parent) return false;
  const p = path.resolve(parent);
  const c = path.resolve(child);
  return c === p || c.startsWith(p + path.sep);
}

function resolveDataDir() {
  const userData = app.getPath("userData");
  const candidate = path.join(userData, "data");
  const installRoot = appRoot();
  const resourcesRoot = process.resourcesPath || "";
  // Defensive: never write into the installation directory.
  if (isInside(installRoot, candidate) || isInside(resourcesRoot, candidate)) {
    return path.join(app.getPath("appData"), PRODUCT_NAME, "data");
  }
  return candidate;
}

function openLogFile(userDataDir) {
  try {
    const dir = path.join(userDataDir, "logs");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "server.log");
    try {
      if (fs.statSync(file).size > 4 * 1024 * 1024) fs.renameSync(file, file + ".old");
    } catch (e) {}
    return fs.createWriteStream(file, { flags: "a" });
  } catch (e) {
    return null;
  }
}

function getFreePort() {
  return new Promise(function (resolve, reject) {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", function () {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(function () { (port ? resolve(port) : reject(new Error("no free port"))); });
    });
  });
}

function serverExecutable() {
  // Preferred: Electron own binary running in Node mode.
  // Fallback: node.exe shipped via extraResources (only when Electron Node
  // cannot provide node:sqlite).
  const bundledNode = path.join(process.resourcesPath || "", "node", "node.exe");
  if (process.platform === "win32" && fs.existsSync(bundledNode)) {
    return { exe: bundledNode, asNode: false, bundled: true };
  }
  return { exe: process.execPath, asNode: true, bundled: false };
}

function startServer(dataDir, port) {
  const root = appRoot();
  const entry = path.join(root, SERVER_ENTRY_REL);
  if (!fs.existsSync(entry)) throw new Error("backend entry not found: " + entry);

  const target = serverExecutable();
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  if (target.asNode) env.ELECTRON_RUN_AS_NODE = "1";
  env.DATA_DIR = dataDir;
  env.PORT = String(port);
  env.HOST = "127.0.0.1";
  env.NODE_ENV = "production";

  log("starting server: " + target.exe + " " + entry + " (port " + port + ", data " + dataDir + ")");
  const child = spawn(target.exe, [entry], {
    cwd: root,
    env: env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: false,
  });
  child.stdout.on("data", function (buf) {
    const text = buf.toString("utf8").trimEnd();
    if (text) log(text);
  });
  child.stderr.on("data", function (buf) {
    const text = buf.toString("utf8").trimEnd();
    if (text) log("[server:stderr] " + text);
  });
  child.on("exit", function (code, signal) {
    log("server exited (code=" + code + ", signal=" + signal + ")");
    if (!quitting && !isHeadless && mainWindow && !mainWindow.isDestroyed()) {
      // Backend died unexpectedly: tell the user instead of showing a blank page.
      dialog.showErrorBox(
        PRODUCT_NAME,
        "本地服务意外退出，应用将关闭。\n\n详细信息见: " + path.join(app.getPath("userData"), "logs", "server.log")
      );
      app.quit();
    }
  });
  return child;
}

function probeHealth(port) {
  return new Promise(function (resolve) {
    const req = http.get(
      { host: "127.0.0.1", port: port, path: "/api/health", timeout: 1200 },
      function (res) {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", function (chunk) { body += chunk; });
        res.on("end", function () {
          if (res.statusCode !== 200) return resolve(null);
          try {
            const data = JSON.parse(body);
            resolve(data && data.ok ? data : null);
          } catch (e) {
            resolve(null);
          }
        });
      }
    );
    req.on("timeout", function () { req.destroy(); resolve(null); });
    req.on("error", function () { resolve(null); });
  });
}

async function waitForHealth(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!serverChild || serverChild.exitCode !== null) return null;
    const health = await probeHealth(port);
    if (health) return health;
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  return null;
}

function killServer() {
  return new Promise(function (resolve) {
    const child = serverChild;
    serverChild = null;
    if (!child || child.exitCode !== null || !child.pid) return resolve();
    let settled = false;
    const done = function () {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once("exit", done);
    try { child.kill(); } catch (e) {}
    const timer = setTimeout(function () {
      if (child.exitCode === null) {
        try {
          spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        } catch (e) {}
      }
      done();
    }, 2500);
    if (timer.unref) timer.unref();
  });
}

function writeRuntime(port, dataDir, health) {
  try {
    const file = path.join(app.getPath("userData"), "runtime.json");
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          app: PRODUCT_NAME,
          version: app.getVersion(),
          pid: process.pid,
          serverPid: serverChild ? serverChild.pid : null,
          port: port,
          dataDir: dataDir,
          health: health || null,
          headless: isHeadless,
          startedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch (e) {
    log("failed to write runtime.json:", e);
  }
}

async function bootstrap() {
  const userData = app.getPath("userData");
  const dataDir = resolveDataDir();
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    if (!isHeadless) dialog.showErrorBox(PRODUCT_NAME, "无法创建数据目录:\n" + dataDir + "\n\n" + e.message);
    app.exit(1);
    return;
  }
  serverLog = openLogFile(userData);
  log("app " + app.getVersion() + " starting; userData=" + userData + "; dataDir=" + dataDir);

  let health = null;
  for (let attempt = 0; attempt < 3 && !health; attempt += 1) {
    const port = await getFreePort();
    serverPort = port;
    serverChild = startServer(dataDir, port);
    health = await waitForHealth(port, HEALTH_TIMEOUT_MS);
    if (!health) {
      log("health check failed on port " + port + " (attempt " + (attempt + 1) + ")");
      await killServer();
    }
  }

  if (!health) {
    const message = "本地服务启动失败，请查看日志:\n" + path.join(userData, "logs", "server.log");
    log("FATAL " + message);
    if (!isHeadless) dialog.showErrorBox(PRODUCT_NAME, message);
    app.exit(1);
    return;
  }

  log("server healthy at http://127.0.0.1:" + serverPort + " dataDir=" + health.dataDir);
  writeRuntime(serverPort, dataDir, health);
  createWindow();
}

function createWindow() {
  const iconPath = path.join(appRoot(), "build", "icon.ico");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: "#0b0d12",
    title: PRODUCT_NAME,
    autoHideMenuBar: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", function () {
    if (!isHeadless && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.on("closed", function () {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(function (details) {
    try {
      if (details.url.startsWith("http://127.0.0.1:") || details.url.startsWith("file:")) {
        return { action: "allow" };
      }
      shell.openExternal(details.url);
    } catch (e) {}
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", function (event, url) {
    if (url.startsWith("http://127.0.0.1:" + serverPort)) return;
    event.preventDefault();
    try { shell.openExternal(url); } catch (e) {}
  });

  mainWindow.loadURL("http://127.0.0.1:" + serverPort + "/");
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", function () {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on("window-all-closed", function () {
    app.quit();
  });

  app.on("before-quit", function (event) {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    log("shutting down");
    killServer().finally(function () {
      try { if (serverLog) serverLog.end(); } catch (e) {}
      app.exit(0);
    });
  });

  app.whenReady().then(bootstrap).catch(function (error) {
    log("fatal:", error);
    if (!isHeadless) {
      try {
        dialog.showErrorBox(PRODUCT_NAME, "启动失败: " + (error && error.stack ? error.stack : String(error)));
      } catch (e) {}
    }
    app.exit(1);
  });
}
