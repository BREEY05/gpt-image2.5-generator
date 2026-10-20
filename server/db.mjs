import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
export const IMAGES_DIR = path.join(DATA_DIR, "images");
const KEY_FILE = path.join(DATA_DIR, ".secret");
const DB_FILE = path.join(DATA_DIR, "app.db");

for (const dir of [DATA_DIR, IMAGES_DIR]) fs.mkdirSync(dir, { recursive: true });

function loadSecret() {
  try {
    if (fs.existsSync(KEY_FILE)) {
      const hex = fs.readFileSync(KEY_FILE, "utf8").trim();
      if (hex.length === 64) return Buffer.from(hex, "hex");
    }
  } catch (e) {}
  const buf = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, buf.toString("hex"), { mode: 0o600 });
  return buf;
}

const secret = loadSecret();

export function encryptKey(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function decryptKey(payload) {
  try {
    const parts = String(payload || "").split(".");
    if (parts.length !== 3) return "";
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const ct = Buffer.from(parts[2], "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", secret, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e) {
    return "";
  }
}

export function maskKey(key) {
  const s = String(key || "");
  if (!s) return "";
  if (s.length <= 8) return "****";
  return s.slice(0, 3) + "..." + s.slice(-4);
}

export const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL, auth_style TEXT NOT NULL DEFAULT 'bearer', key_cipher TEXT, key_hint TEXT, model TEXT, last_test_ok INTEGER, last_test_msg TEXT, last_test_at INTEGER, created_at INTEGER NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS generations (id TEXT PRIMARY KEY, provider_id TEXT, provider_name TEXT, mode TEXT, prompt TEXT, params TEXT, files TEXT, status TEXT, error TEXT, latency_ms INTEGER, usage TEXT, created_at INTEGER NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)");

const DEFAULT_SETTINGS = { concurrency: 2, defaultProviderId: "" };

export function getSettings() {
  const rows = db.prepare("SELECT k, v FROM settings").all();
  const out = Object.assign({}, DEFAULT_SETTINGS);
  for (const row of rows) {
    try { out[row.k] = JSON.parse(row.v); } catch (e) { out[row.k] = row.v; }
  }
  return out;
}

export function setSettings(patch) {
  const stmt = db.prepare("INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v");
  for (const key of Object.keys(patch || {})) stmt.run(key, JSON.stringify(patch[key]));
  return getSettings();
}

export function rowToProvider(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    authStyle: row.auth_style,
    model: row.model || "",
    keyMasked: row.key_hint || "",
    hasKey: !!(row.key_cipher && row.key_cipher.length > 10),
    lastTest: row.last_test_at ? { ok: row.last_test_ok === 1, message: row.last_test_msg || "", at: row.last_test_at } : null,
    createdAt: row.created_at
  };
}

export function listProviders() {
  return db.prepare("SELECT * FROM providers ORDER BY created_at ASC").all().map(rowToProvider);
}

export function getProviderRow(id) {
  return db.prepare("SELECT * FROM providers WHERE id = ?").get(String(id || ""));
}

export function createProvider(data) {
  const id = crypto.randomUUID();
  const cipher = data.apiKey ? encryptKey(data.apiKey) : "";
  const hint = data.apiKey ? maskKey(data.apiKey) : data.keyMasked || "";
  db.prepare("INSERT INTO providers (id, name, base_url, auth_style, key_cipher, key_hint, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, data.name, data.baseUrl, data.authStyle || "bearer", cipher, hint, data.model || "", Date.now());
  return rowToProvider(getProviderRow(id));
}

export function updateProvider(id, data) {
  const row = getProviderRow(id);
  if (!row) return null;
  const cipher = data.apiKey ? encryptKey(data.apiKey) : row.key_cipher;
  const hint = data.apiKey ? maskKey(data.apiKey) : row.key_hint;
  db.prepare("UPDATE providers SET name = ?, base_url = ?, auth_style = ?, key_cipher = ?, key_hint = ?, model = ? WHERE id = ?")
    .run(
      data.name != null ? data.name : row.name,
      data.baseUrl != null ? data.baseUrl : row.base_url,
      data.authStyle != null ? data.authStyle : row.auth_style,
      cipher,
      hint,
      data.model != null ? data.model : row.model,
      id
    );
  return rowToProvider(getProviderRow(id));
}

export function deleteProvider(id) {
  db.prepare("DELETE FROM providers WHERE id = ?").run(id);
}

export function saveTestResult(id, ok, message) {
  db.prepare("UPDATE providers SET last_test_ok = ?, last_test_msg = ?, last_test_at = ? WHERE id = ?")
    .run(ok ? 1 : 0, String(message || "").slice(0, 300), Date.now(), id);
}

export function checkpoint() {
  try { db.exec("PRAGMA wal_checkpoint(PASSIVE)"); } catch (e) {}
}

export function closeDb() {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
  } catch (e) {}
}

export function insertGeneration(record) {
  db.prepare("INSERT INTO generations (id, provider_id, provider_name, mode, prompt, params, files, status, error, latency_ms, usage, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(record.id, record.providerId, record.providerName, record.mode, record.prompt, JSON.stringify(record.params || {}), JSON.stringify(record.files || []), record.status, record.error || "", record.latencyMs || 0, JSON.stringify(record.usage || null), record.createdAt);
  checkpoint();
}

function rowToGeneration(row) {
  if (!row) return null;
  let params = {};
  let files = [];
  let usage = null;
  try { params = JSON.parse(row.params || "{}"); } catch (e) {}
  try { files = JSON.parse(row.files || "[]"); } catch (e) {}
  try { usage = JSON.parse(row.usage || "null"); } catch (e) {}
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    mode: row.mode,
    prompt: row.prompt,
    params: params,
    files: files,
    status: row.status,
    error: row.error,
    latencyMs: row.latency_ms,
    usage: usage,
    createdAt: row.created_at
  };
}

export function listGenerations(limit) {
  const n = Math.max(1, Math.min(200, Number(limit) || 40));
  return db.prepare("SELECT * FROM generations ORDER BY created_at DESC LIMIT ?").all(n).map(rowToGeneration);
}

export function deleteGeneration(id) {
  const row = db.prepare("SELECT * FROM generations WHERE id = ?").get(String(id || ""));
  if (!row) return null;
  db.prepare("DELETE FROM generations WHERE id = ?").run(row.id);
  let files = [];
  try { files = JSON.parse(row.files || "[]"); } catch (e) {}
  for (const url of files) {
    const name = String(url).split("/").pop();
    const full = path.join(IMAGES_DIR, name);
    try { if (full.startsWith(IMAGES_DIR) && fs.existsSync(full)) fs.unlinkSync(full); } catch (e) {}
  }
  return rowToGeneration(row);
}
