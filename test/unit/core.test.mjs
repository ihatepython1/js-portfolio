import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toCsv, productsFromCsv } from "../../server/lib/csv.mjs";
import { MinHeap, solve, generateMaze, seeded, ALGORITHMS, WALL, MUD } from "../../server/lib/pathfind.mjs";

test("CSV: quoted fields, escaped quotes and embedded newlines", () => {
  const rows = parseCsv('a,b,c\n"say ""hi""","line1\nline2",3');
  assert.deepEqual(rows[0], ["a", "b", "c"]);
  assert.equal(rows[1][0], 'say "hi"');
  assert.equal(rows[1][1], "line1\nline2");
  assert.equal(rows[1][2], "3");
});

test("CSV: round-trips values that need quoting", () => {
  const records = [{ a: 'has "quotes"', b: "has,comma", c: "has\nnewline" }];
  const parsed = parseCsv(toCsv(records, ["a", "b", "c"]));
  assert.deepEqual(parsed[1], ['has "quotes"', "has,comma", "has\nnewline"]);
});

test("CSV: strips a BOM and normalises CRLF", () => {
  const rows = parseCsv("\uFEFFsku,name\r\nA-1,Widget\r\n");
  assert.deepEqual(rows[0], ["sku", "name"]);
  assert.deepEqual(rows[1], ["A-1", "Widget"]);
});

test("import: skips rows with no SKU or name, clamps negatives, upcases SKU", () => {
  const { products, skipped } = productsFromCsv(
    "sku,name,cost,price,qty,reorder\n" +
    "bv-1,Water,-5,10,3.7,2\n" +
    ",Nameless,1,2,3,4\n" +
    "ST-9,,1,2,3,4\n"
  );
  assert.equal(skipped, 2);
  assert.equal(products.length, 1);
  assert.equal(products[0].sku, "BV-1");
  assert.equal(products[0].cost, 0);
  assert.equal(products[0].qty, 4, "quantities are rounded to whole units");
});

test("MinHeap pops in ascending priority order", () => {
  const h = new MinHeap();
  const input = [5, 3, 9, 1, 7, 1, 12, 0];
  input.forEach((n, i) => h.push("v" + i, n));
  const out = [];
  while (h.size) out.push(h.pop());
  const priorities = out.map((v) => input[+v.slice(1)]);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b));
});

/** 7x5 open board, wall down the middle with one gap. */
function board() {
  const cols = 7, rows = 5;
  const grid = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) if (y !== 2) grid[y * cols + 3] = WALL;
  return { cols, rows, grid, start: { x: 0, y: 2 }, goal: { x: 6, y: 2 } };
}

test("every algorithm finds a route through the gap", () => {
  for (const a of ALGORITHMS) {
    const r = solve(board(), a);
    assert.ok(r.pathLength > 0, `${a} found no path`);
  }
});

test("A* returns the same cost as Dijkstra, and looks at fewer cells", () => {
  const g = generateMaze(61, 31, seeded(42));
  const astar = solve(g, "astar");
  const dijkstra = solve(g, "dijkstra");
  assert.equal(astar.cost, dijkstra.cost, "A* with an admissible heuristic must stay optimal");
  assert.ok(astar.visited <= dijkstra.visited, "A* should not expand more than Dijkstra");
});

test("breadth-first is shortest in steps but not in cost when ground is slow", () => {
  // a straight corridor of slow ground, versus a longer clear detour
  const cols = 9, rows = 5;
  const grid = new Uint8Array(cols * rows);
  const idx = (x, y) => y * cols + x;
  for (let x = 1; x < 8; x++) grid[idx(x, 2)] = MUD;   // direct but expensive
  for (let x = 0; x < cols; x++) { grid[idx(x, 1)] = 0; }
  const g = { cols, rows, grid, start: { x: 0, y: 2 }, goal: { x: 8, y: 2 } };

  const bfs = solve(g, "bfs");
  const dij = solve(g, "dijkstra");
  assert.ok(dij.cost <= bfs.cost, "Dijkstra should never pay more than BFS");
  assert.ok(dij.pathLength >= bfs.pathLength, "the cheaper route here is the longer one");
});

test("a walled-off goal reports no path instead of hanging", () => {
  const cols = 5, rows = 5;
  const grid = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) grid[y * cols + 2] = WALL;
  const r = solve({ cols, rows, grid, start: { x: 0, y: 0 }, goal: { x: 4, y: 4 } }, "astar");
  assert.equal(r.pathLength, 0);
  assert.equal(r.cost, null);
});

test("start equal to goal is a path of length one", () => {
  const g = board();
  g.goal = { ...g.start };
  assert.equal(solve(g, "astar").pathLength, 1);
});

test("generated mazes are always solvable and endpoints are never walled in", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const g = generateMaze(41, 21, seeded(seed));
    assert.notEqual(g.grid[g.start.y * g.cols + g.start.x], WALL);
    assert.ok(solve(g, "bfs").pathLength > 0, `maze with seed ${seed} had no route`);
  }
});

test("the seeded generator is reproducible", () => {
  const a = generateMaze(31, 15, seeded(7)).grid;
  const b = generateMaze(31, 15, seeded(7)).grid;
  assert.deepEqual([...a], [...b]);
});
