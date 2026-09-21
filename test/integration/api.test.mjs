// Boots the real server in a child process and talks to it over the network:
// REST for all four apps, plus a raw WebSocket handshake done by hand.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let child, dataDir;

const api = (path, init) => fetch(BASE + path, init);

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "shelf-test-"));
  child = spawn(process.execPath, [join(ROOT, "server/index.mjs")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, RATE_LIMIT: "off" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.on("data", (d) => {
    const s = d.toString();
    if (!s.includes("ExperimentalWarning")) process.stderr.write("[server] " + s);
  });

  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const r = await api("/api/health");
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error("server did not come up");
    await new Promise((r) => setTimeout(r, 120));
  }
});

after(async () => {
  child?.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 250));
  child?.kill("SIGKILL");
  try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

/* --------------------------------- basics --------------------------------- */
test("health reports storage driver and worker pools", async () => {
  const h = await (await api("/api/health")).json();
  assert.equal(h.ok, true);
  assert.ok(["sqlite", "json"].includes(h.storage));
  assert.ok(h.workers.solve >= 1 && h.workers.pixels >= 1);
});

test("the front ends are served as static files", async () => {
  for (const path of ["/", "/shelf/", "/pathfinder/", "/imagelab/", "/sequencer/"]) {
    const r = await api(path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get("content-type"), /text\/html/);
    assert.match(await r.text(), /<\/html>/);
  }
});

test("path traversal outside the project is refused", async () => {
  const r = await api("/../../etc/passwd");
  assert.ok([403, 404].includes(r.status), `got ${r.status}`);
});

test("an unknown API path is a JSON 404, not an HTML page", async () => {
  const r = await api("/api/nope");
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, "no such endpoint");
});

/* ---------------------------------- Shelf --------------------------------- */
test("products seed, update, adjust and delete", async () => {
  const first = await (await api("/api/products")).json();
  assert.ok(first.products.length >= 1);

  const put = await api("/api/products/TEST-1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Test widget", category: "Test", supplier: "None", cost: 10, price: 20, qty: 5, reorder: 2 })
  });
  assert.equal(put.status, 200);
  assert.equal((await put.json()).product.qty, 5);

  const moved = await (await api("/api/products/TEST-1/move", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ delta: -3, reason: "sold" })
  })).json();
  assert.equal(moved.product.qty, 2);

  const floored = await (await api("/api/products/TEST-1/move", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ delta: -99 })
  })).json();
  assert.equal(floored.product.qty, 0, "stock never goes negative");

  const log = await (await api("/api/movements")).json();
  assert.ok(log.movements.length >= 2);
  assert.equal(log.movements[0].sku, "TEST-1");

  assert.equal((await api("/api/products/TEST-1", { method: "DELETE" })).status, 200);
  assert.equal((await api("/api/products/TEST-1", { method: "DELETE" })).status, 404);
});

test("a product with no name is rejected", async () => {
  const r = await api("/api/products/BAD-1", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ cost: 1, price: 2 })
  });
  assert.equal(r.status, 400);
});

test("moving an unknown SKU is a 404", async () => {
  const r = await api("/api/products/NOPE/move", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delta: 1 })
  });
  assert.equal(r.status, 404);
});

test("CSV import merges rows and export round-trips them", async () => {
  const csv = "sku,name,category,supplier,cost,price,qty,reorder\nIMP-1,Imported item,Test,Acme,5,9,11,3\n";
  const imp = await (await api("/api/import", { method: "POST", headers: { "content-type": "text/csv" }, body: csv })).json();
  assert.equal(imp.imported, 1);

  const res = await api("/api/export.csv");
  assert.match(res.headers.get("content-disposition"), /shelf-stock\.csv/);
  const bytes = Buffer.from(await res.arrayBuffer());
  // Excel needs the byte-order mark to read Thai product names correctly.
  // fetch's text() strips it when decoding, so assert on the raw bytes.
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const out = bytes.toString("utf8");
  assert.match(out, /IMP-1/);
  assert.match(out, /Imported item/);
});

test("malformed JSON produces a 400 rather than a crash", async () => {
  const r = await api("/api/products/X-1", {
    method: "PUT", headers: { "content-type": "application/json" }, body: "{not json"
  });
  assert.equal(r.status, 400);
});

/* ------------------------------- Pathfinder ------------------------------- */
test("solve runs in a worker and agrees with the browser's expectations", async () => {
  const cols = 7, rows = 5;
  const grid = new Array(cols * rows).fill(0);
  for (let y = 0; y < rows; y++) if (y !== 2) grid[y * cols + 3] = 1;
  const body = { cols, rows, grid, start: { x: 0, y: 2 }, goal: { x: 6, y: 2 }, algorithm: "astar" };
  const r = await (await api("/api/solve", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  })).json();
  assert.equal(r.ok, true);
  assert.equal(r.result.pathLength, 7);
});

test("solve validates the algorithm name and grid size", async () => {
  const bad = await api("/api/solve", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cols: 2, rows: 2, grid: [0, 0, 0, 0], start: { x: 0, y: 0 }, goal: { x: 1, y: 1 }, algorithm: "magic" })
  });
  assert.equal(bad.status, 400);

  const mismatched = await api("/api/solve", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cols: 4, rows: 4, grid: [0, 0], start: { x: 0, y: 0 }, goal: { x: 1, y: 1 } })
  });
  assert.equal(mismatched.status, 400);
});

test("benchmark returns one row per algorithm with A* no worse than Dijkstra", async () => {
  const r = await (await api("/api/benchmark", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ cols: 41, rows: 21, trials: 4, seed: 99 })
  })).json();
  assert.equal(r.results.length, 5);
  assert.equal(r.rows, 21, "the grid height is still reported as rows");
  const by = Object.fromEntries(r.results.map((x) => [x.algorithm, x]));
  assert.equal(by.astar.avgCost, by.dijkstra.avgCost);
  assert.ok(by.astar.avgVisited <= by.dijkstra.avgVisited);
  assert.equal(r.seed, 99, "the seed comes back so a run can be repeated");
});

/* -------------------------------- Image Lab ------------------------------- */
test("render returns a PNG produced by the hand-written encoder", async () => {
  const w = 24, h = 16;
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 200; px[i + 1] = 90; px[i + 2] = 40; px[i + 3] = 255; }
  const r = await api("/api/render", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: w, height: h, pixels: px.toString("base64"), ops: { kernel: "sharpen", maps: ["grayscale"] } })
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(r.headers.get("x-encoder"), "hand-rolled PNG");
  const out = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...out.subarray(1, 4)], [0x50, 0x4e, 0x47]);
});

test("render rejects a pixel buffer of the wrong length", async () => {
  const r = await api("/api/render", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 10, height: 10, pixels: Buffer.alloc(8).toString("base64"), ops: {} })
  });
  assert.equal(r.status, 400);
});

/* -------------------------------- Pulse-16 -------------------------------- */
test("render-wav returns a playable WAV of the right shape", async () => {
  const r = await api("/api/render-wav", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pattern: { kick: "1000100010001000", hat: "0010001000100010" }, bpm: 120, swing: 10, bars: 1 })
  });
  assert.equal(r.status, 200);
  const wav = Buffer.from(await r.arrayBuffer());
  assert.equal(wav.subarray(0, 4).toString("latin1"), "RIFF");
  assert.equal(wav.readUInt32LE(24), 44100);
  assert.ok(wav.length > 44 + 44100, "one bar at 120bpm is longer than a second");
});

test("render-wav refuses an unknown voice", async () => {
  const r = await api("/api/render-wav", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pattern: { cowbell: "1000" } })
  });
  assert.equal(r.status, 400);
});

test("patterns are saved under a short code and read back", async () => {
  const pattern = { kick: "1000100010001000", clap: "0000100000001000" };
  const saved = await api("/api/patterns", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pattern, bpm: 96, swing: 20 })
  });
  assert.equal(saved.status, 201);
  const { code } = await saved.json();
  assert.match(code, /^[a-z0-9_-]{4,8}$/);

  const back = await (await api("/api/patterns/" + code)).json();
  assert.deepEqual(back.data, pattern);
  assert.equal(back.bpm, 96);

  assert.equal((await api("/api/patterns/zzzzzz")).status, 404);
});

/* ------------------------------- WebSocket -------------------------------- */
/** Hand-rolled client: handshake, one masked text frame out, one frame in. */
function wsRoundTrip(room, message) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64");
    const expect = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    const sock = createConnection({ host: "127.0.0.1", port: PORT }, () => {
      sock.write(
        `GET /ws?room=${room} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n` +
        `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    let buf = Buffer.alloc(0), upgraded = false;
    const frames = [];
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("websocket timeout")); }, 6000);

    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) return;
        const head = buf.subarray(0, end).toString("latin1");
        if (!head.includes("101")) { clearTimeout(timer); sock.destroy(); return reject(new Error("no upgrade: " + head)); }
        if (!head.includes(expect)) { clearTimeout(timer); sock.destroy(); return reject(new Error("bad Sec-WebSocket-Accept")); }
        upgraded = true;
        buf = buf.subarray(end + 4);
        if (message) {
          const payload = Buffer.from(JSON.stringify(message));
          const mask = randomBytes(4);
          const masked = Buffer.from(payload);
          for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
          // anything over 125 bytes needs the 16-bit extended length field
          let head;
          if (payload.length < 126) {
            head = Buffer.from([0x81, 0x80 | payload.length]);
          } else {
            head = Buffer.alloc(4);
            head[0] = 0x81;
            head[1] = 0x80 | 126;
            head.writeUInt16BE(payload.length, 2);
          }
          sock.write(Buffer.concat([head, mask, masked]));
        }
      }
      // read whatever complete server frames are buffered (never masked)
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + len) break;
        const opcode = buf[0] & 0x0f;
        const payload = buf.subarray(off, off + len);
        if (opcode === 0x1) frames.push(JSON.parse(payload.toString("utf8")));
        buf = buf.subarray(off + len);
      }
      if (frames.length >= 1) {
        clearTimeout(timer);
        setTimeout(() => { sock.destroy(); resolve(frames); }, 120);
      }
    });
    sock.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

test("the handshake computes a correct Sec-WebSocket-Accept and sends a welcome", async () => {
  const frames = await wsRoundTrip("jam", null);
  assert.equal(frames[0].type, "welcome");
  assert.equal(frames[0].room, "jam");
  assert.ok(frames[0].peers >= 1);
});

test("a shelf message over the socket is persisted by the server", async () => {
  const product = { sku: "WS-1", name: "Socket item", category: "Test", supplier: "", cost: 3, price: 6, qty: 9, reorder: 1 };
  await wsRoundTrip("shelf", { type: "product", product });
  const { products } = await (await api("/api/products")).json();
  const found = products.find((p) => p.sku === "WS-1");
  assert.ok(found, "the product sent over the websocket should be stored");
  assert.equal(+found.qty, 9);
});

/** Raw upgrade attempt; resolves with the status line, or "closed" if dropped. */
function rawUpgrade(path, headers) {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host: "127.0.0.1", port: PORT }, () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n${headers}\r\n`);
    });
    let out = "";
    const timer = setTimeout(() => { sock.destroy(); resolve(out || "timeout"); }, 3000);
    sock.on("data", (c) => { out += c.toString("latin1"); });
    sock.on("close", () => { clearTimeout(timer); resolve(out.split("\r\n")[0] || "closed"); });
    sock.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

test("an upgrade on a path other than /ws is dropped", async () => {
  const line = await rawUpgrade("/not-the-socket",
    "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n");
  assert.ok(!line.includes("101"), `expected no upgrade, got: ${line}`);
});

test("an upgrade with no Sec-WebSocket-Key is answered with 400", async () => {
  const line = await rawUpgrade("/ws", "Upgrade: websocket\r\nConnection: Upgrade\r\n");
  assert.match(line, /400/);
});
