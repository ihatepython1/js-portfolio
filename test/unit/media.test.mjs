import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { encodePng, crc32 } from "../../server/lib/png.mjs";
import { renderPattern, encodeWav } from "../../server/lib/wav.mjs";
import { process as pipeline, toneLut, convolve, sobel, KERNELS } from "../../server/lib/pixels.mjs";
import { readFrame } from "../../server/lib/ws.mjs";

/* ------------------------------- PNG encoder ------------------------------- */
test("crc32 matches the reference value for 'IEND'", () => {
  assert.equal(crc32(Buffer.from("IEND", "latin1")), 0xae426082);
});

test("PNG output has the right signature and chunk order", () => {
  const png = encodePng(new Uint8Array(2 * 2 * 4).fill(128), 2, 2);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(12, 16).toString("latin1"), "IHDR");
  assert.ok(png.includes(Buffer.from("IDAT", "latin1")));
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString("latin1"), "IEND");
});

test("PNG scanlines decode back to the original pixels", () => {
  const w = 4, h = 3;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = i % 251; rgba[i + 1] = (i * 7) % 253; rgba[i + 2] = (i * 13) % 249; rgba[i + 3] = 255;
  }
  const png = encodePng(rgba, w, h);
  const idatStart = png.indexOf(Buffer.from("IDAT", "latin1")) + 4;
  const idatLen = png.readUInt32BE(idatStart - 8);
  const raw = inflateSync(png.subarray(idatStart, idatStart + idatLen));

  // undo the "up" filter the encoder applied
  const stride = w * 4;
  const decoded = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (stride + 1)], 2, "every scanline should use filter type 2");
    for (let x = 0; x < stride; x++) {
      const up = y === 0 ? 0 : decoded[(y - 1) * stride + x];
      decoded[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + up) & 0xff;
    }
  }
  assert.deepEqual([...decoded], [...rgba]);
});

test("PNG encoder rejects a buffer that does not match its dimensions", () => {
  assert.throws(() => encodePng(new Uint8Array(10), 4, 4), /does not match/);
});

/* ------------------------------ WAV renderer ------------------------------ */
test("WAV header declares mono 16-bit 44.1k and the right data size", () => {
  const wav = encodeWav(new Float32Array(1000));
  assert.equal(wav.subarray(0, 4).toString("latin1"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("latin1"), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1, "PCM");
  assert.equal(wav.readUInt16LE(22), 1, "mono");
  assert.equal(wav.readUInt32LE(24), 44100);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 2000);
  assert.equal(wav.length, 44 + 2000);
});

test("an empty pattern renders silence, a kick does not", () => {
  const silent = renderPattern({ pattern: {}, bars: 1 });
  assert.ok(silent.every((s) => s === 0));

  const beat = renderPattern({ pattern: { kick: "1000100010001000" }, bpm: 120, bars: 1 });
  const peak = beat.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  assert.ok(peak > 0.5, `expected an audible kick, peak was ${peak}`);
  assert.ok(peak <= 1, "output must stay inside full scale");
});

test("render length tracks tempo and bar count", () => {
  const slow = renderPattern({ pattern: { kick: "1" }, bpm: 60, bars: 1 }).length;
  const fast = renderPattern({ pattern: { kick: "1" }, bpm: 120, bars: 1 }).length;
  assert.ok(slow > fast, "60 bpm should produce a longer bar than 120 bpm");
  const two = renderPattern({ pattern: { kick: "1" }, bpm: 120, bars: 2 }).length;
  assert.ok(two > fast);
});

test("silence never divides by zero when normalising", () => {
  const out = renderPattern({ pattern: { kick: "0000000000000000" }, bars: 1 });
  assert.ok(out.every((s) => Number.isFinite(s)));
});

/* ----------------------------- pixel pipeline ----------------------------- */
const solid = (w, h, r, g, b) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
  return d;
};

test("a neutral lookup table is the identity", () => {
  const lut = toneLut({ brightness: 0, contrast: 0, gamma: 1 });
  for (const v of [0, 1, 64, 128, 200, 255]) assert.equal(lut[v], v);
});

test("invert then invert returns the original pixels", () => {
  const src = solid(3, 3, 10, 120, 250);
  const once = pipeline(new Uint8ClampedArray(src), 3, 3, { maps: ["invert"] });
  const twice = pipeline(once, 3, 3, { maps: ["invert"] });
  assert.deepEqual([...twice], [...src]);
});

test("blur leaves a flat image unchanged", () => {
  const src = solid(5, 5, 90, 90, 90);
  const out = convolve(src, 5, 5, KERNELS.blur);
  assert.ok([...out].every((v, i) => Math.abs(v - src[i]) <= 1));
});

test("sobel reports no gradient on a flat image and a strong one at an edge", () => {
  const flat = sobel(solid(6, 6, 120, 120, 120), 6, 6);
  assert.ok([...flat].filter((_, i) => i % 4 !== 3).every((v) => v === 0));

  const w = 6, h = 6, d = solid(w, h, 0, 0, 0);
  for (let y = 0; y < h; y++) for (let x = 3; x < w; x++) {
    const i = (y * w + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255;
  }
  const edged = sobel(d, w, h);
  const atEdge = edged[(2 * w + 3) * 4];
  assert.ok(atEdge > 200, `expected a bright edge, got ${atEdge}`);
});

test("alpha is preserved through convolution", () => {
  const d = solid(4, 4, 30, 40, 50);
  for (let i = 3; i < d.length; i += 4) d[i] = 111;
  const out = convolve(d, 4, 4, KERNELS.sharpen);
  for (let i = 3; i < out.length; i += 4) assert.equal(out[i], 111);
});

test("threshold produces only black and white", () => {
  const src = solid(4, 4, 200, 30, 90);
  const out = pipeline(src, 4, 4, { maps: ["threshold"] });
  for (let i = 0; i < out.length; i += 4) assert.ok(out[i] === 0 || out[i] === 255);
});

/* ---------------------------- WebSocket framing ---------------------------- */
function clientFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  const head = Buffer.from([0x81, 0x80 | payload.length]);
  return Buffer.concat([head, mask, masked]);
}

test("a masked client text frame is unmasked correctly", () => {
  const f = readFrame(clientFrame('{"type":"ping"}'));
  assert.equal(f.opcode, 0x1);
  assert.equal(f.fin, true);
  assert.equal(f.payload.toString("utf8"), '{"type":"ping"}');
});

test("an incomplete frame returns null so the reader waits for more bytes", () => {
  const full = clientFrame("hello there");
  assert.equal(readFrame(full.subarray(0, 4)), null);
  assert.ok(readFrame(full));
});

test("frame size lets the caller consume exactly one frame from a stream", () => {
  const stream = Buffer.concat([clientFrame("one"), clientFrame("two")]);
  const first = readFrame(stream);
  assert.equal(first.payload.toString(), "one");
  const second = readFrame(stream.subarray(first.size));
  assert.equal(second.payload.toString(), "two");
});

test("a 16-bit extended length frame parses", () => {
  const payload = Buffer.alloc(300, 0x61);
  const mask = Buffer.from([9, 9, 9, 9]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  const head = Buffer.alloc(4);
  head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(300, 2);
  const f = readFrame(Buffer.concat([head, mask, masked]));
  assert.equal(f.payload.length, 300);
  assert.equal(f.payload[0], 0x61);
});
