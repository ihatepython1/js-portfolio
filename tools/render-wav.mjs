#!/usr/bin/env node
// Render a Pulse-16 pattern to a WAV from the command line — no browser, no
// audio hardware, no sample files.
//
//   node tools/render-wav.mjs                          # the built-in demo pattern
//   node tools/render-wav.mjs --bpm 128 --bars 8 -o loop.wav
//   node tools/render-wav.mjs --pattern kick=1000100010001000,hat=1010101010101010
//   node tools/render-wav.mjs --code ab12cd              # a pattern saved by the server
//   echo '{"kick":"1000"}' | node tools/render-wav.mjs --stdin

import { writeFileSync } from "node:fs";
import { renderPattern, encodeWav, VOICES } from "../server/lib/wav.mjs";
import { openStore } from "../server/lib/store.mjs";

const DEMO = {
  kick:  "1000001010000010",
  snare: "0000100000001002",
  hat:   "1011101110111011",
  tom:   "0000000010000100",
  bass:  "1002001010020010",
  blip:  "0010000100100001"
};

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  for (const token of ["--" + name, "-" + name]) {
    const i = args.indexOf(token);
    if (i > -1 && args[i + 1] && !args[i + 1].startsWith("-")) return args[i + 1];
  }
  return fallback;
};
const has = (name) => args.includes("--" + name);

if (has("help") || args.includes("-h")) {
  console.log(`
  render-wav — turn a 16-step pattern into a WAV file

  --bpm <n>        tempo, 40-200            (default 104)
  --swing <n>      0-60, percent            (default 14)
  --bars <n>       repeats of the 16 steps  (default 4)
  --pattern <s>    voice=steps,voice=steps
  --code <s>       load a pattern saved through the server
  --stdin          read a JSON pattern object from stdin
  -o, --out <f>    output file              (default pulse16.wav)

  voices: ${VOICES.join(", ")}
  steps:  16 characters of 0 (off), 1 (hit), 2 (accent)
`);
  process.exit(0);
}

function parsePattern(text) {
  const out = {};
  for (const pair of text.split(",")) {
    const [voice, steps] = pair.split("=");
    if (!VOICES.includes(voice)) throw new Error(`unknown voice: ${voice} (try ${VOICES.join(", ")})`);
    if (!/^[012]{1,16}$/.test(steps || "")) throw new Error(`bad steps for ${voice}: expected up to 16 digits of 0, 1 or 2`);
    out[voice] = steps.padEnd(16, "0");
  }
  return out;
}

const readStdin = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
};

let pattern = DEMO;
let bpm = +flag("bpm", 104);
let swing = +flag("swing", 14);

if (has("stdin")) {
  pattern = JSON.parse(await readStdin());
} else if (has("code")) {
  const store = await openStore();
  const row = store.getPattern(flag("code", "").toLowerCase());
  if (!row) { console.error("no pattern with that code"); process.exit(1); }
  pattern = row.data;
  if (row.bpm) bpm = row.bpm;
  if (row.swing) swing = row.swing;
} else if (has("pattern")) {
  pattern = parsePattern(flag("pattern", ""));
}

const bars = +flag("bars", 4);
const out = flag("out", flag("o", "pulse16.wav"));
const t0 = performance.now();
const samples = renderPattern({ pattern, bpm, swing: swing / 100, bars });
const wav = encodeWav(samples);
writeFileSync(out, wav);

const seconds = samples.length / 44100;
const hits = Object.values(pattern).reduce((n, row) => n + [...row].filter((c) => c !== "0").length, 0);
console.log(
  `${out} · ${seconds.toFixed(2)}s · ${(wav.length / 1024).toFixed(0)} KB · ` +
  `${hits} hits across ${Object.keys(pattern).length} voices · ` +
  `${bpm} bpm, ${swing}% swing · rendered in ${(performance.now() - t0).toFixed(0)} ms`
);
