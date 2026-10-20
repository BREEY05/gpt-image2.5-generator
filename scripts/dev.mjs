import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const isWin = process.platform === "win32";

function run(label, args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", shell: false });
  child.on("exit", (code) => {
    console.log("[" + label + "] exited with " + code);
    shutdown();
  });
  return child;
}

const children = [];
children.push(run("server", [path.join(root, "server", "index.mjs")]));
children.push(run("vite", [path.join(root, "node_modules", "vite", "bin", "vite.js")]));

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try { child.kill(); } catch (e) {}
  }
  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("");
console.log("  开发模式：前端 http://127.0.0.1:5173  →  代理到本地服务 8787");
console.log("  按 Ctrl+C 同时停止两个进程");
console.log("");
