// Offline renderer for Pulse-16. The browser builds each voice out of Web Audio
// nodes; here the same recipes are written as raw sample maths and encoded as a
// 16-bit PCM WAV, so a pattern can be turned into a file with no audio hardware.

export const VOICES = ["kick", "snare", "clap", "hat", "open", "tom", "bass", "blip"];
const SR = 44100;

/* ---- tiny DSP helpers ---- */
const expDecay = (t, tau) => Math.exp(-t / tau);
const sine = (ph) => Math.sin(ph * Math.PI * 2);
const saw = (ph) => 2 * (ph % 1) - 1;
const square = (ph) => (ph % 1 < 0.5 ? 1 : -1);
const tri = (ph) => 4 * Math.abs((ph % 1) - 0.5) - 1;

// one-pole filters: enough character for percussion, and no state tables needed
function makeLP() { let y = 0; return (x, cut) => { const a = 1 - Math.exp(-2 * Math.PI * cut / SR); return (y += a * (x - y)); }; }
function makeHP() { let y = 0; return (x, cut) => { const a = 1 - Math.exp(-2 * Math.PI * cut / SR); y += a * (x - y); return x - y; }; }
// two-pole resonant band-pass, used for the clap bursts
function makeBP(freq, q) {
  const w = 2 * Math.PI * freq / SR, alpha = Math.sin(w) / (2 * q);
  const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w), a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 / a0) * x + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

/**
 * Each voice writes itself into the mix buffer starting at a sample offset.
 * accent raises level and brightness, exactly as the browser version does.
 */
const RENDER = {
  kick(buf, at, accent) {
    const dur = 0.4 | 0 || 0.4, n = Math.floor(0.4 * SR);
    let ph = 0;
    for (let i = 0; i < n && at + i < buf.length; i++) {
      const t = i / SR;
      const f = 44 + ((accent ? 190 : 160) - 44) * expDecay(t, 0.032);
      ph += f / SR;
      buf[at + i] += sine(ph) * (accent ? 1.05 : 0.85) * expDecay(t, 0.1);
    }
  },
  snare(buf, at, accent) {
    const n = Math.floor(0.22 * SR), hp = makeHP();
    let ph = 0;
    for (let i = 0; i < n && at + i < buf.length; i++) {
      const t = i / SR;
      const noise = hp(Math.random() * 2 - 1, 1400) * (accent ? 0.72 : 0.5) * expDecay(t, 0.055);
      ph += 190 / SR;
      buf[at + i] += noise + tri(ph) * 0.3 * expDecay(t, 0.03);
    }
  },
  clap(buf, at, accent) {
    const bursts = [0, 0.011, 0.022, 0.036];
    const bp = makeBP(1100, 1.2);
    const n = Math.floor(0.24 * SR);
    for (let i = 0; i < n && at + i < buf.length; i++) {
      const t = i / SR;
      let amp = 0;
      for (let b = 0; b < bursts.length; b++) {
        if (t < bursts[b]) continue;
        const tt = t - bursts[b];
        amp += expDecay(tt, b === 3 ? 0.055 : 0.008) * (b === 3 ? 1 : 0.6);
      }
      buf[at + i] += bp(Math.random() * 2 - 1) * amp * (accent ? 0.85 : 0.6);
    }
  },
  hat(buf, at, accent) {
    const n = Math.floor(0.07 * SR), hp = makeHP();
    for (let i = 0; i < n && at + i < buf.length; i++) {
      const t = i / SR;
      buf[at + i] += hp(Math.random() * 2 - 1, 7500) * (accent ? 0.42 : 0.28) * expDecay(t, 0.012);
    }
  },
  open(buf, at, accent) {
    const n = Math.floor(0.45 * SR), hp = makeHP();
    for (let i = 0; i < n && at + i < buf.length; i++) {
      const t = i / SR;
      buf[at + i] += hp(Math.random() * 2 - 1, 6800) * (accent ? 0.38 : 0.26) * expDecay(t, 0.11);
    }
  },
  tom(buf, at, accent) {
    const n = Math.floor(0.35 * SR);
    let ph = 0;
    for (let i = 0; i < n && at + i < buf.length; i++) {
      const t = i / SR;
      const f = 80 + ((accent ? 260 : 210) - 80) * expDecay(t, 0.06);
      ph += f / SR;
      buf[at + i] += sine(ph) * 0.6 * expDecay(t, 0.085);
    }
  },
  bass(buf, at, accent) {
    const n = Math.floor(0.4 * SR), lp = makeLP();
    let ph = 0;
    for (let i = 0; i < n && at + i < buf.length; i++) {
      const t = i / SR;
      ph += (accent ? 82.4 : 55) / SR;
      const cut = 120 + ((accent ? 1400 : 900) - 120) * expDecay(t, 0.07);
      buf[at + i] += lp(saw(ph), cut) * 0.5 * expDecay(t, 0.1);
    }
  },
  blip(buf, at, accent) {
    const n = Math.floor(0.15 * SR);
    let ph = 0;
    for (let i = 0; i < n && at + i < buf.length; i++) {
      const t = i / SR;
      const f = (accent ? 1046 : 784) + (accent ? 522 : 96) * Math.min(1, t / 0.05);
      ph += f / SR;
      buf[at + i] += square(ph) * 0.14 * expDecay(t, 0.03);
    }
  }
};

/**
 * Render a pattern to a mono Float32Array.
 * @param {Object} opts
 * @param {Object<string,string>} opts.pattern  voice id -> 16 chars of 0/1/2
 * @param {number} opts.bpm
 * @param {number} opts.swing  0..0.6
 * @param {number} opts.bars   how many times to repeat the 16 steps
 */
export function renderPattern({ pattern = {}, bpm = 104, swing = 0.14, bars = 2 }) {
  bpm = Math.min(200, Math.max(40, +bpm || 104));
  swing = Math.min(0.6, Math.max(0, +swing || 0));
  bars = Math.min(16, Math.max(1, Math.round(+bars || 2)));

  const step = 60 / bpm / 4;
  const barLen = step * 16;
  const total = Math.ceil((barLen * bars + 0.6) * SR);
  const buf = new Float32Array(total);

  for (let bar = 0; bar < bars; bar++) {
    let t = bar * barLen;
    for (let s = 0; s < 16; s++) {
      for (const v of VOICES) {
        const row = pattern[v];
        const hit = row ? +row[s] || 0 : 0;
        if (hit && RENDER[v]) RENDER[v](buf, Math.floor(t * SR), hit === 2);
      }
      t += s % 2 === 0 ? step * (1 + swing) : step * (1 - swing);
    }
  }

  // soft clip, then normalise to a comfortable -1 dBFS or so
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.tanh(buf[i] * 0.9);
    peak = Math.max(peak, Math.abs(buf[i]));
  }
  const gain = peak > 0 ? 0.89 / peak : 1;
  for (let i = 0; i < buf.length; i++) buf[i] *= gain;
  return buf;
}

/** Encode mono float samples as a 16-bit PCM WAV file. */
export function encodeWav(samples, sampleRate = SR) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);        // fmt chunk size
  head.writeUInt16LE(1, 20);         // PCM
  head.writeUInt16LE(1, 22);         // mono
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * 2, 28); // byte rate
  head.writeUInt16LE(2, 32);         // block align
  head.writeUInt16LE(16, 34);        // bits per sample
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
