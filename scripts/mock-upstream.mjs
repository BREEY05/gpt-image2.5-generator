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

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        resolve({});
      }
    });
  });
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
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
    const body = await readJson(req);
    const prompt = String(body.prompt || "");
    if (prompt.indexOf("MOCK401") !== -1) return send(res, 401, { error: { message: "Incorrect API key provided: sk-mock", type: "invalid_request_error" } });
    if (prompt.indexOf("MOCK429") !== -1) return send(res, 429, { error: { message: "Rate limit reached for images per min", type: "rate_limit_error" } });
    if (prompt.indexOf("MOCK500") !== -1) return send(res, 500, { error: { message: "The server had an error while processing your request", type: "server_error" } });

    const count = Math.max(1, Math.min(4, Number(body.n) || 1));
    const dims = sizeOf(body.size);
    const base = Math.floor(Math.random() * 100000);
    const delay = 700 + Math.random() * 900;
    await new Promise((r) => setTimeout(r, delay));

    const data = [];
    for (let i = 0; i < count; i += 1) {
      const png = makePng(dims.w, dims.h, base + i * 7919);
      data.push({ b64_json: png.toString("base64") });
    }
    return send(res, 200, {
      created: Math.floor(Date.now() / 1000),
      data: data,
      usage: { input_tokens: 24, output_tokens: 1024 * count, total_tokens: 1024 * count + 24 }
    });
  }

  return send(res, 404, { error: { message: "mock: not found " + req.method + " " + url.pathname } });
});

server.listen(PORT, HOST, () => {
  console.log("[mock] OpenAI-compatible mock listening on http://" + HOST + ":" + PORT + "/v1");
});
