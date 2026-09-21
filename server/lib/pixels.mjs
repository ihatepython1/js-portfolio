// The pixel pipeline from Image Lab, extracted so the server can run it at full
// resolution inside a worker thread instead of blocking the browser's main thread.

export const KERNELS = {
  blur:    [1, 2, 1, 2, 4, 2, 1, 2, 1],
  sharpen: [0, -1, 0, -1, 5, -1, 0, -1, 0],
  edges:   [-1, -1, -1, -1, 8, -1, -1, -1, -1],
  emboss:  [-2, -1, 0, -1, 1, 1, 0, 1, 2],
  unsharp: [-1, -1, -1, -1, 17, -1, -1, -1, -1]
};

export function toneLut({ brightness = 0, contrast = 0, gamma = 1 }) {
  const b = brightness * 2.55;
  const c = contrast / 100;
  const factor = (259 * (c * 255 + 255)) / (255 * (259 - c * 255));
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = factor * (i - 128) + 128 + b;
    v = 255 * Math.pow(Math.max(0, Math.min(255, v)) / 255, 1 / gamma);
    lut[i] = v;
  }
  return lut;
}

export function pointOps(d, ops) {
  const lut = toneLut(ops);
  const sat = 1 + (ops.saturation || 0) / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
    if (sat !== 1) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = lum + (r - lum) * sat;
      g = lum + (g - lum) * sat;
      b = lum + (b - lum) * sat;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return d;
}

export function convolve(d, w, h, k) {
  const out = new Uint8ClampedArray(d.length);
  const sum = k.reduce((a, b) => a + b, 0) || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -1; ky <= 1; ky++) {
        const sy = Math.min(h - 1, Math.max(0, y + ky));
        for (let kx = -1; kx <= 1; kx++) {
          const sx = Math.min(w - 1, Math.max(0, x + kx));
          const wgt = k[(ky + 1) * 3 + (kx + 1)], i = (sy * w + sx) * 4;
          r += d[i] * wgt; g += d[i + 1] * wgt; b += d[i + 2] * wgt;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / sum; out[o + 1] = g / sum; out[o + 2] = b / sum; out[o + 3] = d[o + 3];
    }
  }
  return out;
}

export function sobel(d, w, h) {
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1], gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++)
    lum[p] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = 0, sy = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const p = Math.min(h - 1, Math.max(0, y + ky)) * w + Math.min(w - 1, Math.max(0, x + kx));
          const wgt = (ky + 1) * 3 + (kx + 1);
          sx += lum[p] * gx[wgt]; sy += lum[p] * gy[wgt];
        }
      }
      const o = (y * w + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = Math.hypot(sx, sy);
      out[o + 3] = d[o + 3];
    }
  }
  return out;
}

export function colourMaps(d, maps = []) {
  if (!maps.length) return d;
  const set = new Set(maps);
  const step = 255 / 4;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (set.has("grayscale")) { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; r = g = b = l; }
    if (set.has("sepia")) {
      const nr = r * 0.393 + g * 0.769 + b * 0.189;
      const ng = r * 0.349 + g * 0.686 + b * 0.168;
      const nb = r * 0.272 + g * 0.534 + b * 0.131;
      r = nr; g = ng; b = nb;
    }
    if (set.has("posterize")) {
      r = Math.round(r / step) * step; g = Math.round(g / step) * step; b = Math.round(b / step) * step;
    }
    if (set.has("threshold")) { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b > 128 ? 255 : 0; r = g = b = l; }
    if (set.has("invert")) { r = 255 - r; g = 255 - g; b = 255 - b; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return d;
}

/** Run the whole pipeline. `ops.kernel` may be a KERNELS key or "sobel". */
export function process(pixels, width, height, ops = {}) {
  let d = pixels instanceof Uint8ClampedArray ? pixels : new Uint8ClampedArray(pixels);
  pointOps(d, ops);
  const amount = ops.amount === undefined ? 1 : Math.min(1, Math.max(0, ops.amount));
  if (ops.kernel === "sobel" || KERNELS[ops.kernel]) {
    const conv = ops.kernel === "sobel" ? sobel(d, width, height) : convolve(d, width, height, KERNELS[ops.kernel]);
    if (amount < 1) for (let i = 0; i < d.length; i++) d[i] = d[i] * (1 - amount) + conv[i] * amount;
    else d = conv;
  }
  colourMaps(d, ops.maps || []);
  return d;
}

/** 256-bin histogram per channel, handy for a server-side report. */
export function histogram(d) {
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < d.length; i += 4) { bins[0][d[i]]++; bins[1][d[i + 1]]++; bins[2][d[i + 2]]++; }
  return bins.map((b) => Array.from(b));
}
