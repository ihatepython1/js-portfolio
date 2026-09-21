#!/usr/bin/env node
// Benchmark the five search algorithms over freshly generated mazes, spread
// across worker threads, and print the table to the terminal.
//
//   node tools/bench.mjs
//   node tools/bench.mjs --trials 100 --cols 81 --rows 41 --seed 7
//   node tools/bench.mjs --csv > bench.csv

import { availableParallelism } from "node:os";
import { createPool } from "../server/lib/pool.mjs";
import { ALGORITHMS } from "../server/lib/pathfind.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i > -1 && args[i + 1] && !args[i + 1].startsWith("--") ? +args[i + 1] : fallback;
};
const has = (name) => args.includes("--" + name);

const cols = flag("cols", 61);
const rows = flag("rows", 31);
const trials = flag("trials", 40);
const seed = flag("seed", Math.floor(Math.random() * 1e9));
const workers = Math.max(1, Math.min(flag("workers", availableParallelism() - 1) || 1, 8));

const pool = createPool(new URL("../server/lib/workers/solve.worker.mjs", import.meta.url), workers);

// split the trials across the pool, each shard with its own derived seed
const shards = Array.from({ length: workers }, (_, i) => ({
  task: "benchmark",
  cols, rows,
  trials: Math.floor(trials / workers) + (i < trials % workers ? 1 : 0),
  seed: seed + i * 7919
})).filter((s) => s.trials > 0);

const t0 = performance.now();
const results = await Promise.all(shards.map((s) => pool.run(s)));
const wall = performance.now() - t0;
await pool.close();

const failed = results.find((r) => !r.ok);
if (failed) { console.error("worker failed:", failed.error); process.exit(1); }

// weighted merge of the per-shard averages
const merged = ALGORITHMS.map((a) => {
  let visited = 0, path = 0, cost = 0, ms = 0, n = 0, solvedWeight = 0;
  for (const [i, r] of results.entries()) {
    const row = r.results.find((x) => x.algorithm === a);
    const w = shards[i].trials;
    visited += row.avgVisited * w;
    path += row.avgPathLength * w;
    ms += row.avgMs * w;
    if (row.avgCost) { cost += row.avgCost * w; solvedWeight += w; }
    n += w;
  }
  return {
    algorithm: a,
    avgVisited: Math.round(visited / n),
    shareOfBoard: +((visited / n / (cols * rows)) * 100).toFixed(1),
    avgPathLength: Math.round(path / n),
    avgCost: solvedWeight ? +(cost / solvedWeight).toFixed(1) : null,
    avgMs: +(ms / n).toFixed(3)
  };
});

const best = Math.min(...merged.filter((m) => m.avgCost).map((m) => m.avgCost));
for (const m of merged) m.costVsBest = m.avgCost ? +(m.avgCost / best).toFixed(2) : null;

if (has("csv")) {
  const cols_ = ["algorithm", "avgVisited", "shareOfBoard", "avgPathLength", "avgCost", "costVsBest", "avgMs"];
  console.log(cols_.join(","));
  for (const m of merged) console.log(cols_.map((c) => m[c] ?? "").join(","));
  process.exit(0);
}

const NAMES = { astar: "A*", dijkstra: "Dijkstra", bfs: "Breadth-first", greedy: "Greedy", dfs: "Depth-first" };
const pad = (s, n, right = false) => (right ? String(s).padStart(n) : String(s).padEnd(n));

console.log(`\n  ${trials} mazes of ${cols}×${rows} · seed ${seed} · ${shards.length} workers · ${wall.toFixed(0)} ms wall clock\n`);
console.log("  " + pad("algorithm", 15) + pad("looked at", 12, true) + pad("of board", 11, true) +
            pad("cost", 9, true) + pad("vs best", 10, true) + pad("time", 11, true));
console.log("  " + "─".repeat(68));
for (const m of merged) {
  const bar = "▌".repeat(Math.max(1, Math.round((m.avgVisited / Math.max(...merged.map((x) => x.avgVisited))) * 14)));
  console.log(
    "  " + pad(NAMES[m.algorithm], 15) + pad(m.avgVisited, 12, true) + pad(m.shareOfBoard + "%", 11, true) +
    pad(m.avgCost ?? "—", 9, true) + pad(m.costVsBest ? "×" + m.costVsBest : "—", 10, true) +
    pad(m.avgMs + " ms", 11, true) + "  " + bar
  );
}
console.log("");
