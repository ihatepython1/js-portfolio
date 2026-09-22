// One zero-dependency Node server for all four apps: static hosting, a small
// router, a worker pool for the heavy endpoints and a hand-rolled WebSocket hub.
//
//   node server/index.mjs            → http://localhost:8080
//   PORT=3000 node server/index.mjs
//
// Every front end works without this server. When it is reachable they light up
// extra features instead: shared state, server-side rendering, benchmarks.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { availableParallelism, hostname } from "node:os";
import { createPool } from "./lib/pool.mjs";
import { openStore, FIELDS } from "./lib/store.mjs";
import { WsHub } from "./lib/ws.mjs";
import { productsFromCsv, toCsv } from "./lib/csv.mjs";
import { renderPattern, encodeWav, VOICES } from "./lib/wav.mjs";
import { ALGORITHMS } from "./lib/pathfind.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(HERE, "..");
const PORT = +(process.env.PORT || 8080);
const MAX_BODY = 32 * 1024 * 1024;          // 32 MB, enough for a large image pass
const started = Date.now();

const store = await openStore(process.env.DATA_DIR || join(ROOT, "data"));
const solvePool = createPool(new URL("./lib/workers/solve.worker.mjs", import.meta.url));
const pixelPool = createPool(new URL("./lib/workers/pixels.worker.mjs", import.meta.url));
const hub = new WsHub();

/* --------------------------------- routing --------------------------------- */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, parts: pattern.split("/"), handler });
const get = (p, h) => route("GET", p, h);
const post = (p, h) => route("POST", p, h);
const put = (p, h) => route("PUT", p, h);
const del = (p, h) => route("DELETE", p, h);

function match(method, pathname) {
  const parts = pathname.split("/");
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (r.parts[i].startsWith(":")) params[r.parts[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (r.parts[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

const json = (res, status, obj) => {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.length });
  res.end(body);
};

async function readBody(req, limit = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) { const e = new Error("payload too large"); e.status = 413; throw e; }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const readJson = async (req) => {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString("utf8")); }
  catch { const e = new Error("body is not valid JSON"); e.status = 400; throw e; }
};

/* ------------------------------ rate limiting ------------------------------ */
// token bucket per address, so the expensive endpoints cannot be hammered
const buckets = new Map();
const LIMIT_OFF = process.env.RATE_LIMIT === "off";
function allow(ip, cost = 1, capacity = 240, refillPerSec = 40) {
  if (LIMIT_OFF) return true;
  const now = Date.now();
  const b = buckets.get(ip) || { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSec);
  b.at = now;
  if (b.tokens < cost) { buckets.set(ip, b); return false; }
  b.tokens -= cost;
  buckets.set(ip, b);
  return true;
}
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [ip, b] of buckets) if (b.at < cutoff) buckets.delete(ip);
}, 60000).unref();

/* ------------------------------ shared routes ------------------------------ */
get("/api/health", (req, res) => json(res, 200, {
  ok: true,
  node: process.version,
  host: hostname(),
  uptimeSec: Math.round((Date.now() - started) / 1000),
  storage: store.driver,
  cores: availableParallelism(),
  workers: { solve: solvePool.size, pixels: pixelPool.size },
  websocketRooms: hub.stats(),
  features: ["shelf.sync", "shelf.audit", "pathfinder.benchmark", "imagelab.render", "sequencer.wav", "sequencer.share"]
}));

/* --------------------------------- Shelf ---------------------------------- */
get("/api/products", (req, res) => json(res, 200, { products: store.listProducts() }));

put("/api/products/:sku", async (req, res, { params }) => {
  const body = await readJson(req);
  const p = { ...body, sku: params.sku.toUpperCase() };
  for (const f of ["cost", "price", "qty", "reorder"]) p[f] = Math.max(0, +p[f] || 0);
  if (!p.name) return json(res, 400, { error: "name is required" });
  p.qty = Math.round(p.qty); p.reorder = Math.round(p.reorder);
  p.category = p.category || "Uncategorised";
  store.upsertProduct(Object.fromEntries(FIELDS.map((f) => [f, p[f] ?? ""])));
  hub.broadcast("shelf", { type: "product", product: store.getProduct(p.sku) }, null);
  return json(res, 200, { product: store.getProduct(p.sku) });
});

del("/api/products/:sku", (req, res, { params }) => {
  const ok = store.deleteProduct(params.sku.toUpperCase());
  if (ok) hub.broadcast("shelf", { type: "removed", sku: params.sku.toUpperCase() }, null);
  return json(res, ok ? 200 : 404, { ok });
});

post("/api/products/:sku/move", async (req, res, { params }) => {
  const { delta = 0, reason = "manual" } = await readJson(req);
  const p = store.adjust(params.sku.toUpperCase(), Math.round(+delta || 0), String(reason).slice(0, 40));
  if (!p) return json(res, 404, { error: "unknown SKU" });
  hub.broadcast("shelf", { type: "product", product: p }, null);
  return json(res, 200, { product: p });
});

get("/api/movements", (req, res, { url }) =>
  json(res, 200, { movements: store.movements(+url.searchParams.get("limit") || 60) }));

post("/api/import", async (req, res) => {
  const text = (await readBody(req, 4 * 1024 * 1024)).toString("utf8");
  const { products, skipped } = productsFromCsv(text);
  if (!products.length) return json(res, 400, { error: "no usable rows found", skipped });
  const mode = new URL(req.url, "http://x").searchParams.get("mode");
  if (mode === "replace") store.replaceAll(products);
  else for (const p of products) store.upsertProduct(p);
  hub.broadcast("shelf", { type: "reload" }, null);
  return json(res, 200, { imported: products.length, skipped, mode: mode || "merge" });
});

get("/api/export.csv", (req, res) => {
  const csv = "\uFEFF" + toCsv(store.listProducts(), FIELDS);
  res.writeHead(200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": 'attachment; filename="shelf-stock.csv"'
  });
  res.end(csv);
});

/* ------------------------------- Pathfinder ------------------------------- */
post("/api/solve", async (req, res) => {
  const body = await readJson(req);
  const { cols, rows, grid, start, goal, algorithm = "astar" } = body;
  if (!ALGORITHMS.includes(algorithm)) return json(res, 400, { error: "unknown algorithm" });
  if (!Array.isArray(grid) || grid.length !== cols * rows) return json(res, 400, { error: "grid does not match cols x rows" });
  const out = await solvePool.run({ task: "solve", algorithm, grid: { cols, rows, grid, start, goal } });
  return json(res, out.ok ? 200 : 500, out);
});

post("/api/benchmark", async (req, res, { ip }) => {
  if (!allow(ip, 8)) return json(res, 429, { error: "too many benchmark runs, try again shortly" });
  const b = await readJson(req);
  const job = {
    task: "benchmark",
    cols: Math.min(121, Math.max(21, (b.cols | 0) || 61)),
    rows: Math.min(81, Math.max(11, (b.rows | 0) || 31)),
    trials: Math.min(60, Math.max(1, (b.trials | 0) || 20)),
    seed: (b.seed | 0) || Math.floor(Math.random() * 1e9)
  };
  const t0 = performance.now();
  const out = await solvePool.run(job);
  return json(res, out.ok ? 200 : 500, { ...out, wallMs: +(performance.now() - t0).toFixed(1), pool: solvePool.size });
});

/* -------------------------------- Image Lab ------------------------------- */
// body: { width, height, ops, pixels: base64 RGBA }  →  image/png
post("/api/render", async (req, res, { ip }) => {
  if (!allow(ip, 4)) return json(res, 429, { error: "too many render requests" });
  const body = await readJson(req);
  const { width, height, ops = {}, pixels } = body;
  if (!width || !height || !pixels) return json(res, 400, { error: "width, height and pixels are required" });
  if (width * height > 40e6) return json(res, 413, { error: "image is too large to render" });

  const buf = Buffer.from(pixels, "base64");
  if (buf.length !== width * height * 4) return json(res, 400, { error: "pixel buffer length does not match dimensions" });

  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const out = await pixelPool.run({ width, height, ops, buffer: ab }, [ab]);
  if (!out.ok) return json(res, 500, { error: out.error });

  res.writeHead(200, {
    "content-type": "image/png",
    "content-length": out.bytes,
    "content-disposition": 'attachment; filename="imagelab-server.png"',
    "x-process-ms": out.processMs,
    "x-encode-ms": out.encodeMs,
    "x-encoder": "hand-rolled PNG"
  });
  res.end(Buffer.from(out.png));
});

/* -------------------------------- Pulse-16 -------------------------------- */
post("/api/render-wav", async (req, res, { ip }) => {
  if (!allow(ip, 6)) return json(res, 429, { error: "too many renders" });
  const { pattern = {}, bpm = 104, swing = 14, bars = 2 } = await readJson(req);
  for (const v of Object.keys(pattern)) {
    if (!VOICES.includes(v) || typeof pattern[v] !== "string" || pattern[v].length > 16)
      return json(res, 400, { error: `bad pattern row: ${v}` });
  }
  const t0 = performance.now();
  const wav = encodeWav(renderPattern({ pattern, bpm, swing: +swing / 100, bars }));
  res.writeHead(200, {
    "content-type": "audio/wav",
    "content-length": wav.length,
    "content-disposition": 'attachment; filename="pulse16.wav"',
    "x-render-ms": (performance.now() - t0).toFixed(1)
  });
  res.end(wav);
});

post("/api/patterns", async (req, res) => {
  const { pattern, bpm = 104, swing = 14 } = await readJson(req);
  if (!pattern || typeof pattern !== "object") return json(res, 400, { error: "pattern is required" });
  const code = store.savePattern(pattern, bpm, swing);
  return json(res, 201, { code });
});

get("/api/patterns/:code", (req, res, { params }) => {
  const row = store.getPattern(params.code.toLowerCase());
  return row ? json(res, 200, row) : json(res, 404, { error: "no pattern with that code" });
});

get("/api/patterns", (req, res) => json(res, 200, { patterns: store.recentPatterns(8) }));

/* ------------------------------ static files ------------------------------ */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8", ".wav": "audio/wav", ".webmanifest": "application/manifest+json"
};

async function serveStatic(pathname, res) {
  let rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  if (rel.endsWith("/")) rel += "index.html";
  let file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("Forbidden"); return; }

  try {
    const info = await stat(file);
    // Windows normalizes trailing slashes to backslashes. Resolve a directory's
    // index directly instead of recursing with the same URL indefinitely.
    if (info.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "content-length": body.length,
      "cache-control": extname(file) === ".html" ? "no-cache" : "public, max-age=300"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found: " + rel);
  }
}

/* --------------------------------- server --------------------------------- */
const server = createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || "unknown";
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  const hit = match(req.method, url.pathname);
  if (!hit) {
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "no such endpoint" });
    if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
    return serveStatic(url.pathname === "/" ? "/index.html" : url.pathname, res);
  }

  if (!allow(ip)) return json(res, 429, { error: "slow down" });

  const t0 = performance.now();
  try {
    await hit.handler(req, res, { params: hit.params, url, ip });
  } catch (err) {
    if (!res.headersSent) json(res, err.status || 500, { error: err.message });
    else res.end();
  }
  if (url.pathname.startsWith("/api/"))
    console.log(`${req.method} ${url.pathname} ${res.statusCode} ${(performance.now() - t0).toFixed(1)}ms`);
});

/* --------------------------- websocket behaviour --------------------------- */
// Shelf: relay stock edits to every other open tab.
hub.on("shelf", (msg, conn) => {
  if (msg.type === "product" && msg.product?.sku) {
    store.upsertProduct(msg.product);
    hub.broadcast("shelf", { type: "product", product: msg.product }, conn);
  } else if (msg.type === "removed" && msg.sku) {
    store.deleteProduct(msg.sku);
    hub.broadcast("shelf", { type: "removed", sku: msg.sku }, conn);
  } else {
    hub.broadcast("shelf", msg, conn);
  }
});
// Pulse-16 jam room: whoever edits a step, everyone hears it.
hub.on("jam", (msg, conn) => hub.broadcast("jam", { ...msg, from: conn.id }, conn));
hub.attach(server, { path: "/ws" });

server.listen(PORT, () => {
  console.log(`\n  Four browser apps · http://localhost:${PORT}`);
  console.log(`  storage: ${store.driver}${store.note ? ` (sqlite unavailable: ${store.note})` : ""}`);
  console.log(`  workers: ${solvePool.size} solve · ${pixelPool.size} pixels`);
  console.log(`  websocket: ws://localhost:${PORT}/ws?room=shelf\n`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    console.log("\nshutting down");
    server.close();
    await Promise.all([solvePool.close(), pixelPool.close()]);
    process.exit(0);
  });
}

export { server, hub, store };
