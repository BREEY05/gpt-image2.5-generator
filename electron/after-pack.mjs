/**
 * electron-builder afterPack hook.
 *
 * server/index.mjs only uses Node built-ins and server/public is prebuilt, so
 * no production npm dependencies are needed at runtime. electron-builder still
 * collects package.json "dependencies"; drop them so the installed payload is
 * just our own code and the static frontend.
 *
 * Note: resources/elevate.exe (~100 KB) is added by electron-builder during the
 * NSIS step, i.e. after this hook runs, so it cannot be removed from here.
 */
import fs from "node:fs";
import path from "node:path";

export default async function afterPack(context) {
  const appDir = path.join(context.appOutDir, "resources", "app");
  const nodeModules = path.join(appDir, "node_modules");
  if (fs.existsSync(nodeModules)) {
    fs.rmSync(nodeModules, { recursive: true, force: true });
    console.log("[after-pack] removed unused node_modules from " + appDir);
  }
}
