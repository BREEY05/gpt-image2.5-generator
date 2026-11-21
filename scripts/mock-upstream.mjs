import http from "node:http";
import zlib from "node:zlib";

const PORT = Number(process.env.MOCK_PORT || 9911);
const HOST = "127.0.0.1";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function palette(t, phase) {
  const v = 127 + 118 * Math.cos(6.28318 * (t * 1.1 + phase));
  return Math.max(0, Math.min(255, Math.round(v)));
}

function makePng(width, height, seed) {
  let state = (seed % 2147483646) + 1;
  const rand = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const phaseA = rand();
  const phaseB = rand();
  const cx = 0.2 + rand() * 0.6;
  const cy = 0.2 + rand() * 0.6;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / height;
      const t = (u + v) * 0.5;
      const dx = u - cx;
      const dy = v - cy;
      const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 1.7);
      const r = palette(t, phaseA) * (0.55 + glow * 0.65);
      const g = palette(t, phaseB) * (0.5 + glow * 0.6);
      const b = palette(1 - t, phaseA * 0.5 + 0.25) * (0.6 + glow * 0.5);
      const idx = rowStart + 1 + x * 3;
      raw[idx] = Math.max(0, Math.min(255, Math.round(r)));
      raw[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      raw[idx + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

function sizeOf(value) {
  const parts = String(value || "1024x1024").split("x");
  const w = Math.max(64, Math.min(1536, Number(parts[0]) || 1024));
  const h = Math.max(64, Math.min(1536, Number(parts[1]) || 1024));
  return { w: w - (w % 16), h: h - (h % 16) };
}

function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function readJson(req) {
  return readRaw(req).then((buf) => {
    try {
      return JSON.parse(buf.toString("utf8") || "{}");
    } catch (e) {
      return {};
    }
  });
}

// 极简 multipart 解析：只取文本字段、图片 part 数量、image[] 字段数量、markup 字段数量
function parseMultipart(buf, contentType) {
  const match = /boundary=("?)([^";]+)\1/.exec(String(contentType || ""));
  if (!match) return { fields: {}, imageCount: 0, arrayCount: 0, markupCount: 0 };
  const marker = Buffer.from("--" + match[2]);
  const fields = {};
  let imageCount = 0;
  let arrayCount = 0;
  let markupCount = 0;
  let pos = buf.indexOf(marker);
  while (pos !== -1) {
    let start = pos + marker.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
    const next = buf.indexOf(marker, start);
    if (next === -1 || next < start) break;
    const part = buf.subarray(start, next - 2);
    const sep = part.indexOf("\r\n\r\n");
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString("utf8");
      const body = part.subarray(sep + 4);
      const nameMatch = /name="([^"]*)"/.exec(head);
      const name = nameMatch ? nameMatch[1] : "";
      const isFile = /filename=/.test(head);
      if (isFile && name.indexOf("image[]") === 0) arrayCount += 1;
      else if (isFile && name.indexOf("image") === 0) imageCount += 1;
      else if (isFile && name === "markup") markupCount += 1;
      else if (name) fields[name] = body.toString("utf8");
    }
    pos = next;
  }
  return { fields: fields, imageCount: imageCount, arrayCount: arrayCount, markupCount: markupCount };
}

// 1x1 透明 GIF89a 夹具（897 字节以内的最小合法动图占位，扩展名/魔数够用）
const GIF_FIXTURE = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const SVG_FIXTURE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#7c3aed"/></svg>';

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

// 模拟「上游返回 HTML 网页」：Cloudflare 网关报错页 / 网站首页
const HTML_GATEWAY = '<!DOCTYPE html>\n<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->\n<html class="no-js" lang="en-US">\n<head>\n<title>502 Bad Gateway</title>\n<meta charset="utf-8">\n</head>\n<body>\n<h1>502 Bad Gateway</h1>\n<p>cloudflare</p>\n<p>Ray ID: 8f1c2d3e4f5a6b7c</p>\n</body>\n</html>';
const HTML_HOME = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head><title>某中转站 - 首页</title></head>\n<body><h1>欢迎访问 API 中转站</h1><p>请登录后使用</p></body>\n</html>';
const HTML_CHALLENGE = '<!DOCTYPE html>\n<html lang="en-US">\n<head><title>Just a moment...</title></head>\n<body><h1>Enable JavaScript and cookies to continue</h1><p>Cloudflare</p></body>\n</html>';

function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(html) });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");

  if (req.method === "GET" && url.pathname.endsWith("/credits")) {
    return send(res, 200, { object: "credits", balance: 42.5, currency: "USD", total_granted: 60, total_used: 17.5 });
  }

  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    return send(res, 200, {
      object: "list",
      data: [
        { id: "gpt-image-2.6-flare", object: "model" },
        { id: "gpt-image-2.6-sunburst", object: "model" },
        { id: "gpt-image-2.5-flare", object: "model" },
        { id: "gpt-image-2.5-sunburst", object: "model" },
        { id: "gpt-image-2", object: "model" },
        { id: "gpt-image-1", object: "model" },
        { id: "gpt-image-1-mini", object: "model" },
        { id: "text-embedding-3-small", object: "model" }
      ]
    });
  }

  if (req.method === "POST" && (url.pathname.endsWith("/images/generations") || url.pathname.endsWith("/images/edits"))) {
    const isEdits = url.pathname.endsWith("/images/edits");
    const isMultipart = /multipart\/form-data/i.test(String(req.headers["content-type"] || ""));
    let body = {};
    let imageCount = 0;
    let arrayCount = 0;
    let markupCount = 0;
    if (isMultipart) {
      const parsed = parseMultipart(await readRaw(req), req.headers["content-type"]);
      body = parsed.fields;
      imageCount = parsed.imageCount;
      arrayCount = parsed.arrayCount;
      markupCount = parsed.markupCount;
    } else {
      body = await readJson(req);
    }
    const prompt = String(body.prompt || "");
    if (isEdits && prompt.indexOf("EXPECT2") !== -1 && imageCount !== 2) {
      return send(res, 400, { error: { message: "mock: expected 2 images, got " + imageCount } });
    }
    if (isEdits && prompt.indexOf("EXPECT1") !== -1 && imageCount !== 1) {
      return send(res, 400, { error: { message: "mock: expected 1 image, got " + imageCount } });
    }
    if (isEdits && prompt.indexOf("MOCKBADARRAY") !== -1 && arrayCount > 0) {
      return send(res, 400, { error: { message: "mock: unsupported image[] field, use repeated image field" } });
    }
    if (prompt.indexOf("MOCK401") !== -1) return send(res, 401, { error: { message: "Incorrect API key provided: sk-mock", type: "invalid_request_error" } });
    if (prompt.indexOf("MOCK429") !== -1) return send(res, 429, { error: { message: "Rate limit reached for images per min", type: "rate_limit_error" } });
    if (prompt.indexOf("MOCK500") !== -1) return send(res, 500, { error: { message: "The server had an error while processing your request", type: "server_error" } });
    if (prompt.indexOf("MOCKHTML502") !== -1) return sendHtml(res, 502, HTML_GATEWAY);
    if (prompt.indexOf("MOCKHTML200") !== -1) return sendHtml(res, 200, HTML_HOME);
    if (prompt.indexOf("MOCKHTMLCF") !== -1) return sendHtml(res, 403, HTML_CHALLENGE);

    if (prompt.indexOf("EXPECTCOMPLEXITY") !== -1 && String(body.complexity || "") !== "low") {
      return send(res, 400, { error: { message: "mock: expected complexity=low, got " + String(body.complexity) } });
    }
    if (
      prompt.indexOf("EXPECTGIF") !== -1 &&
      (String(body.output_format) !== "gif" || Number(body.frame_count) !== 4 || Number(body.frame_duration_ms) !== 350)
    ) {
      return send(res, 400, {
        error: { message: "mock: expected gif frame_count=4 frame_duration_ms=350, got " + JSON.stringify({ output_format: body.output_format, frame_count: body.frame_count, frame_duration_ms: body.frame_duration_ms }) }
      });
    }
    if (prompt.indexOf("EXPECTSVG") !== -1 && String(body.output_format) !== "svg") {
      return send(res, 400, { error: { message: "mock: expected output_format=svg, got " + String(body.output_format) } });
    }
    if (isEdits && prompt.indexOf("EXPECTMARKUP") !== -1 && markupCount !== 1) {
      return send(res, 400, { error: { message: "mock: expected 1 markup part, got " + markupCount } });
    }

    const count = Math.max(1, Math.min(4, Number(body.n) || 1));
    const dims = sizeOf(body.size);
    const base = Math.floor(Math.random() * 100000);
    const requestedFormat = String(body.output_format || "png");
    // MOCKNOFMT 模拟「中转忽略请求格式，永远返回 PNG」
    const effectiveFormat = prompt.indexOf("MOCKNOFMT") !== -1 ? "png" : requestedFormat;
    const delay = 700 + Math.random() * 900;
    await new Promise((r) => setTimeout(r, delay));

    const data = [];
    for (let i = 0; i < count; i += 1) {
      let buf;
      if (effectiveFormat === "gif") buf = GIF_FIXTURE;
      else if (effectiveFormat === "svg") buf = Buffer.from(SVG_FIXTURE, "utf8");
      else buf = makePng(dims.w, dims.h, base + i * 7919);
      data.push({ b64_json: buf.toString("base64") });
    }
    return send(res, 200, {
      created: Math.floor(Date.now() / 1000),
      data: data,
      usage: { input_tokens: 24, output_tokens: 1024 * count, total_tokens: 1024 * count + 24 }
    });
  }

  if (req.method === "GET" && url.pathname === "/website") return sendHtml(res, 200, HTML_HOME);

  return send(res, 404, { error: { message: "mock: not found " + req.method + " " + url.pathname } });
});

server.listen(PORT, HOST, () => {
  console.log("[mock] OpenAI-compatible mock listening on http://" + HOST + ":" + PORT + "/v1");
});
