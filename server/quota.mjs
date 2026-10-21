import { normalizeBaseUrl, authHeaders } from "./openai.mjs";

const TTL_OK = 60000;
const TTL_FAIL = 20000;
const cache = new Map();

function cacheKey(provider) {
  return String(provider.id || provider.baseUrl);
}

async function fetchJson(url, headers, timeoutMs) {
  const res = await fetch(url, { method: "GET", headers: headers, signal: AbortSignal.timeout(timeoutMs || 8000) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    json = null;
  }
  return { status: res.status, ok: res.ok, json: json, text: text };
}

function firstNumber() {
  for (let i = 0; i < arguments.length; i += 1) {
    const value = arguments[i];
    if (value == null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readCredits(json) {
  if (!json || typeof json !== "object") return null;
  const data = json.data && typeof json.data === "object" ? json.data : json;
  return firstNumber(data.balance, data.total_available, data.remaining, data.credits, data.amount, json.balance);
}

function readUsageLike(json) {
  if (!json || typeof json !== "object") return null;
  const data = json.data && typeof json.data === "object" ? json.data : json;
  const remaining = firstNumber(data.remaining, data.balance, data.available);
  const used = firstNumber(data.used, data.total_used, data.consumed, data.usage);
  if (remaining == null && used == null) return null;
  return { remaining: remaining, used: used };
}

function startOfMonthSeconds() {
  const now = new Date();
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
}

function monthStartDateString() {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), 1);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + mm + "-" + dd;
}

function todayDateString() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + mm + "-" + dd;
}

async function probe(provider, apiKey) {
  const base = normalizeBaseUrl(provider.baseUrl);
  const headers = authHeaders(provider, apiKey);
  const tried = [];

  try {
    const res = await fetchJson(base + "/credits", headers, 8000);
    if (res.status === 200) {
      const balance = readCredits(res.json);
      if (balance != null) {
        return {
          available: true,
          source: "credits",
          label: "余额接口 /credits",
          currency: "USD",
          limit: null,
          used: null,
          remaining: balance,
          checkedAt: Date.now(),
          message: "余额来自服务商的 /credits 接口"
        };
      }
    }
    tried.push("/credits " + res.status);
  } catch (e) {
    tried.push("/credits 不可用");
  }

  try {
    const sub = await fetchJson(base + "/dashboard/billing/subscription", headers, 8000);
    if (sub.status === 200 && sub.json) {
      const data = sub.json.data && typeof sub.json.data === "object" ? sub.json.data : sub.json;
      const limit = firstNumber(data.hard_limit_usd, data.system_hard_limit_usd, data.soft_limit_usd);
      const usage = await fetchJson(
        base + "/dashboard/billing/usage?start_date=" + monthStartDateString() + "&end_date=" + todayDateString(),
        headers,
        8000
      );
      let used = null;
      if (usage.status === 200 && usage.json) {
        const cents = firstNumber(usage.json.total_usage);
        if (cents != null) used = cents / 100;
      }
      if (limit != null || used != null) {
        return {
          available: true,
          source: "billing",
          label: "账单接口 /dashboard/billing",
          currency: "USD",
          limit: limit,
          used: used,
          remaining: limit != null && used != null ? Math.max(0, limit - used) : null,
          checkedAt: Date.now(),
          message: "额度来自服务商的账单接口"
        };
      }
    }
    tried.push("/dashboard/billing " + sub.status);
  } catch (e) {
    tried.push("/dashboard/billing 不可用");
  }

  try {
    const res = await fetchJson(base + "/usage", headers, 8000);
    if (res.status === 200) {
      const parsed = readUsageLike(res.json);
      if (parsed) {
        return {
          available: true,
          source: "usage",
          label: "用量接口 /usage",
          currency: "USD",
          limit: null,
          used: parsed.used,
          remaining: parsed.remaining,
          checkedAt: Date.now(),
          message: "额度来自服务商的 /usage 接口"
        };
      }
    }
    tried.push("/usage " + res.status);
  } catch (e) {
    tried.push("/usage 不可用");
  }

  if (String(apiKey).indexOf("sk-admin") === 0) {
    try {
      const res = await fetchJson(
        base + "/organization/costs?start_time=" + startOfMonthSeconds() + "&bucket_width=1d&limit=31",
        headers,
        10000
      );
      if (res.status === 200 && res.json && Array.isArray(res.json.data)) {
        let sum = 0;
        let currency = "USD";
        for (const bucket of res.json.data) {
          const results = Array.isArray(bucket.results) ? bucket.results : [];
          for (const item of results) {
            const amount = item.amount || {};
            const value = Number(amount.value);
            if (Number.isFinite(value)) sum += value;
            if (amount.currency) currency = amount.currency;
          }
        }
        return {
          available: true,
          source: "admin",
          label: "管理员用量 /organization/costs",
          currency: currency,
          limit: null,
          used: sum,
          remaining: null,
          checkedAt: Date.now(),
          message: "本月至今消耗（来自管理员接口），无法得知剩余额度"
        };
      }
      tried.push("/organization/costs " + res.status);
    } catch (e) {
      tried.push("/organization/costs 不可用");
    }
  }

  return {
    available: false,
    checkedAt: Date.now(),
    message: "这个服务商没有开放额度查询接口",
    hint: "OpenAI 官方 API Key 本身不提供余额查询。可以看下方的本地用量统计，或登录服务商后台查看余额。",
    tried: tried
  };
}

export async function getQuota(provider, apiKey, options) {
  const force = !!(options && options.force);
  const key = cacheKey(provider);
  const cached = cache.get(key);
  const ttl = cached && cached.value && cached.value.available ? TTL_OK : TTL_FAIL;
  if (!force && cached && Date.now() - cached.at < ttl) return cached.value;
  let value = null;
  try {
    value = await probe(provider, apiKey);
  } catch (e) {
    value = {
      available: false,
      checkedAt: Date.now(),
      message: "查询额度失败：" + (e && e.message ? e.message : String(e)),
      hint: "检查网络或服务商接口"
    };
  }
  cache.set(key, { at: Date.now(), value: value });
  return value;
}
