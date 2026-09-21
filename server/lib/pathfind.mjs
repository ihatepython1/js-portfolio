// The same five search algorithms the browser runs, in a form the server can
// benchmark: no drawing, no replay list, just counts and timings.

export const WALL = 1, MUD = 2, MUD_COST = 6;

/** Binary min-heap with lazy deletion. */
export class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v, p) {
    this.a.push({ v, p });
    let i = this.a.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.a[par].p <= this.a[i].p) break;
      [this.a[par], this.a[i]] = [this.a[i], this.a[par]];
      i = par;
    }
  }
  pop() {
    if (!this.a.length) return undefined;
    const top = this.a[0], last = this.a.pop();
    if (this.a.length) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.a.length && this.a[l].p < this.a[m].p) m = l;
        if (r < this.a.length && this.a[r].p < this.a[m].p) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
        i = m;
      }
    }
    return top.v;
  }
}

export const ALGORITHMS = ["astar", "dijkstra", "bfs", "greedy", "dfs"];

/**
 * @param {Object} g  { cols, rows, grid: number[]|Uint8Array, start:{x,y}, goal:{x,y} }
 * @param {string} kind  one of ALGORITHMS
 * @returns {{visited:number, expanded:number, pathLength:number, cost:number|null, ms:number}}
 */
export function solve(g, kind = "astar") {
  const { cols, rows, grid } = g;
  const idx = (x, y) => y * cols + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const cost = (i) => (grid[i] === MUD ? MUD_COST : 1);

  const s = idx(g.start.x, g.start.y), goal = idx(g.goal.x, g.goal.y);
  const n = cols * rows;
  const prev = new Int32Array(n).fill(-1);
  const dist = new Float64Array(n).fill(Infinity);
  const seen = new Uint8Array(n);
  const h = (i) => Math.abs((i % cols) - g.goal.x) + Math.abs(Math.floor(i / cols) - g.goal.y);

  const weighted = kind === "dijkstra" || kind === "astar";
  const priority = (i) =>
    kind === "astar" ? dist[i] + h(i) : kind === "greedy" ? h(i) : kind === "dijkstra" ? dist[i] : 0;

  const t0 = performance.now();
  // the frontier structure is the algorithm: a stack backtracks, a FIFO queue
  // spreads evenly, a priority queue follows whichever score it is given
  const open = new MinHeap();
  const list = [s];        // stack for dfs, queue for bfs
  let head = 0;
  dist[s] = 0;
  seen[s] = 1;
  open.push(s, priority(s));

  const takeNext =
    kind === "dfs" ? () => list.pop() :
    kind === "bfs" ? () => (head < list.length ? list[head++] : undefined) :
    () => open.pop();
  const hasNext =
    kind === "dfs" ? () => list.length > 0 :
    kind === "bfs" ? () => head < list.length :
    () => open.size > 0;

  let expanded = 0;
  const closed = new Set();

  while (hasNext()) {
    const cur = takeNext();
    if (cur === undefined) break;
    expanded++;
    closed.add(cur);
    if (cur === goal) break;

    const cx = cur % cols, cy = Math.floor(cur / cols);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!inside(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (grid[ni] === WALL) continue;

      if (weighted) {
        const nd = dist[cur] + cost(ni);
        if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = cur; open.push(ni, priority(ni)); }
      } else {
        if (seen[ni]) continue;
        seen[ni] = 1; prev[ni] = cur; dist[ni] = dist[cur] + cost(ni);
        if (kind === "dfs" || kind === "bfs") list.push(ni);
        else open.push(ni, priority(ni));
      }
    }
  }

  let pathLength = 0;
  if (goal === s || prev[goal] !== -1) {
    for (let c = goal; c !== -1; c = prev[c]) { pathLength++; if (c === s) break; }
  }
  const ms = performance.now() - t0;
  return {
    visited: closed.size,
    expanded,
    pathLength,
    cost: pathLength ? dist[goal] : null,
    ms: +ms.toFixed(3)
  };
}

/** Recursive-backtracker maze, plus extra openings and weighted ground. */
export function generateMaze(cols, rows, rand = Math.random) {
  const grid = new Uint8Array(cols * rows).fill(WALL);
  const idx = (x, y) => y * cols + x;
  grid[idx(1, 1)] = 0;
  const stack = [[1, 1]];
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const opts = [[0, -2], [2, 0], [0, 2], [-2, 0]]
      .map(([dx, dy]) => [x + dx, y + dy, x + dx / 2, y + dy / 2])
      .filter(([nx, ny]) => nx > 0 && ny > 0 && nx < cols - 1 && ny < rows - 1 && grid[idx(nx, ny)] === WALL);
    if (!opts.length) { stack.pop(); continue; }
    const [nx, ny, mx, my] = opts[Math.floor(rand() * opts.length)];
    grid[idx(mx, my)] = 0;
    grid[idx(nx, ny)] = 0;
    stack.push([nx, ny]);
  }
  for (let k = 0; k < (cols * rows) / 28; k++)
    grid[idx(1 + Math.floor(rand() * (cols - 2)), 1 + Math.floor(rand() * (rows - 2)))] = 0;
  for (let k = 0; k < (cols * rows) / 12; k++) {
    const i = Math.floor(rand() * grid.length);
    if (!grid[i]) grid[i] = MUD;
  }

  const start = { x: Math.floor(cols * 0.12), y: Math.floor(rows / 2) };
  const goal = { x: Math.floor(cols * 0.88), y: Math.floor(rows / 2) };
  for (const p of [start, goal])
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (p.x + dx >= 0 && p.y + dy >= 0 && p.x + dx < cols && p.y + dy < rows)
          grid[idx(p.x + dx, p.y + dy)] = 0;

  return { cols, rows, grid, start, goal };
}

/** Mulberry32 — a seeded PRNG so a benchmark run can be reproduced exactly. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
