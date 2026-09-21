// Worker: runs a benchmark sweep of every algorithm over seeded random mazes.
import { parentPort } from "node:worker_threads";
import { ALGORITHMS, solve, generateMaze, seeded } from "../pathfind.mjs";

parentPort.on("message", (job) => {
  try {
    if (job.task === "solve") {
      parentPort.postMessage({ ok: true, result: solve(job.grid, job.algorithm) });
      return;
    }

    const { cols = 61, rows = 31, trials = 20, seed = 1 } = job;
    const rand = seeded(seed);
    const totals = Object.fromEntries(
      ALGORITHMS.map((a) => [a, { visited: 0, pathLength: 0, cost: 0, ms: 0, solved: 0 }])
    );

    for (let t = 0; t < trials; t++) {
      const maze = generateMaze(cols, rows, rand);
      for (const a of ALGORITHMS) {
        const r = solve(maze, a);
        const acc = totals[a];
        acc.visited += r.visited;
        acc.pathLength += r.pathLength;
        acc.ms += r.ms;
        if (r.pathLength) { acc.solved++; acc.cost += r.cost; }
      }
    }

    const cells = cols * rows;
    const results = ALGORITHMS.map((a) => {
      const s = totals[a];
      return {
        algorithm: a,
        avgVisited: Math.round(s.visited / trials),
        shareOfBoard: +(s.visited / trials / cells * 100).toFixed(1),
        avgPathLength: Math.round(s.pathLength / trials),
        avgCost: s.solved ? +(s.cost / s.solved).toFixed(1) : null,
        avgMs: +(s.ms / trials).toFixed(3),
        solveRate: +(s.solved / trials * 100).toFixed(0)
      };
    });

    const best = Math.min(...results.filter((r) => r.avgCost).map((r) => r.avgCost));
    for (const r of results) r.costVsBest = r.avgCost ? +(r.avgCost / best).toFixed(2) : null;

        // `rows` is the maze height, so the table goes out as `results`
    parentPort.postMessage({ ok: true, cols, rows, trials, seed, results });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message });
  }
});
