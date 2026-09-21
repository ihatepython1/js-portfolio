# Four browser apps and a server, with no dependencies

Four self-contained web applications, plus one Node server that gives each of them a backend. There is no framework, no bundler and no `node_modules` — `package.json` has an empty `dependencies` block and it stays that way. The browser code is plain JavaScript in a single HTML file per app; the server uses only `node:` builtins.

**Static demo:** https://ihatepython1.github.io/js-portfolio/ — every app is fully usable there. When the Node server is running, each one detects it and switches on extra features instead.

```bash
node server/index.mjs      # http://localhost:8080
node --test                # 51 tests, no install needed
```

| Project | In the browser | With the server running |
|---|---|---|
| [Shelf](shelf/) | Inventory and reorder tracking, saved to `localStorage` | SQLite storage, live sync between tabs and devices, stock movement audit log |
| [Pathfinder](pathfinder/) | Five search algorithms animated on a grid | Benchmarks all five over dozens of seeded mazes in a worker pool |
| [Image Lab](imagelab/) | Pixel editing on a downscaled preview | Full-resolution pass in a worker, PNG written by a hand-rolled encoder |
| [Pulse-16](sequencer/) | 8-voice drum machine synthesized in Web Audio | Offline WAV render, short-code pattern sharing, live jam room |

---

## The browser apps

### Shelf — stock control

An inventory tool built around the problem a small distributor actually has: knowing what to reorder before it runs out.

- Add, edit and delete products; inline quantity stepper on every row
- Reorder point per SKU, with low-stock and out-of-stock rows flagged
- KPI strip: stock value at cost, margin if everything sells, items needing reorder
- Search across name, SKU and supplier; filter by category and stock level; sort any column
- CSV export, and CSV import that updates existing SKUs and adds new ones
- Undo for deletes, and duplicate-SKU and price-below-cost checks in the editor
- Falls back to in-memory state when `localStorage` is unavailable

Notable code: an RFC 4180 CSV parser handling quoted fields, escaped quotes and embedded newlines. The same parser runs on the server, and the test suite covers both.

### Pathfinder — search visualizer

The same grid, the same walls, five algorithms, so the trade-offs are visible rather than theoretical.

- A*, Dijkstra, breadth-first, greedy best-first and depth-first
- Weighted terrain (cost 6) — Dijkstra and A* route around it, breadth-first walks straight through and pays
- Maze generation by recursive backtracking, with extra openings so more than one route exists
- Draw walls by dragging, Shift for slow ground, drag the start and goal markers

Notable code: the frontier structure *is* the algorithm — a stack for depth-first, a FIFO queue for breadth-first, a lazily-deleting binary min-heap for the priority searches. The search runs to completion first and records its expansion order, so the animation is a replay rather than an artificially slowed search.

### Image Lab — pixel processing

Every effect is written against the raw pixel buffer. No CSS filters, no image library.

- Brightness, contrast, saturation and gamma through a precomputed 256-entry lookup table
- 3×3 convolution: Gaussian blur, sharpen, unsharp mask, outline, emboss, with a blend amount
- Sobel gradient magnitude on luminance
- Stackable colour maps: grayscale, invert, sepia, posterize, threshold
- Live RGB histogram and per-pass timing
- Drag and drop, a procedurally generated test image, a draggable before/after split, PNG export

### Pulse-16 — step sequencer

A drum machine with no samples. Eight voices, each built from oscillators and filtered noise when the note fires.

- 16 steps, three states each: off, hit, accent
- Lookahead scheduling: a timer schedules notes against the audio clock ahead of time, so timing holds when the main thread is busy
- Swing, tempo, master volume through a compressor, per-track mute
- Presets, a randomiser, and pattern sharing through the URL hash

Notable code: audio time and frame time are kept separate. Notes are queued against `AudioContext.currentTime`; the playhead is drawn by comparing that queue against the clock.

---

## The server

`server/index.mjs` — one process serving the static apps and the API for all four.

- **Hand-written router and static file server**, with a path traversal guard and per-extension caching
- **Token bucket rate limiting** per address, priced per endpoint (a benchmark costs more than a product lookup). `RATE_LIMIT=off` disables it for local testing
- **`node:sqlite`** for products, stock movements and saved patterns, with an automatic JSON-file fallback when the built-in SQLite is unavailable (Node 20, or a read-only filesystem)
- **`worker_threads` pools** for the CPU-heavy endpoints, so a full-resolution image pass or a 40-maze benchmark never blocks the event loop
- **A WebSocket server written against RFC 6455**: SHA-1 handshake, frame parsing with masking and both extended length forms, fragmentation, ping/pong, close, rooms and broadcast

### API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Node version, storage driver, worker counts, live socket rooms |
| `GET` | `/api/products` | Current stock |
| `PUT` | `/api/products/:sku` | Create or update, broadcast to other tabs |
| `DELETE` | `/api/products/:sku` | Remove |
| `POST` | `/api/products/:sku/move` | Adjust quantity and record a movement |
| `GET` | `/api/movements` | Audit log, most recent first |
| `POST` | `/api/import` | CSV body; `?mode=replace` to wipe first |
| `GET` | `/api/export.csv` | CSV with a BOM, so Excel reads Thai names correctly |
| `POST` | `/api/solve` | Run one algorithm on a submitted grid |
| `POST` | `/api/benchmark` | All five algorithms over seeded mazes, averaged |
| `POST` | `/api/render` | Base64 RGBA in, PNG out |
| `POST` | `/api/render-wav` | Pattern in, 16-bit PCM WAV out |
| `POST` | `/api/patterns` | Save a pattern, get a short code |
| `GET` | `/api/patterns/:code` | Load one back |
| `WS` | `/ws?room=shelf` | Stock changes relayed to every other tab |
| `WS` | `/ws?room=jam` | Step edits shared live between sequencers |

### Encoders written by hand

- `server/lib/png.mjs` — PNG chunk framing, CRC-32 and scanline filtering. Only the deflate step is borrowed from `node:zlib`, which is what the PNG spec calls for anyway. The test inflates the output and reconstructs the original pixels through the filter to prove it round-trips.
- `server/lib/wav.mjs` — the Web Audio voices reimplemented as raw sample maths (pitch envelopes, one-pole and biquad filters, noise bursts), soft-clipped, normalised and written into a 16-bit PCM WAV.

---

## Command line tools

```bash
node tools/render-wav.mjs --bpm 128 --bars 8 --out loop.wav
node tools/render-wav.mjs --pattern kick=1000100010001000,hat=1010101010101010
echo '{"kick":"1000100010001000"}' | node tools/render-wav.mjs --stdin
node tools/bench.mjs --trials 100 --cols 81 --rows 41
node tools/bench.mjs --trials 40 --csv > bench.csv
```

A typical benchmark run, 40 mazes of 61×31:

```
  algorithm         looked at   of board     cost   vs best       time
  ────────────────────────────────────────────────────────────────────
  A*                      493      26.1%      139        ×1   2.875 ms  ▌▌▌▌▌▌▌▌▌▌
  Dijkstra                573      30.3%      139        ×1   3.150 ms  ▌▌▌▌▌▌▌▌▌▌▌▌
  Breadth-first           590      31.2%      147     ×1.06   2.480 ms  ▌▌▌▌▌▌▌▌▌▌▌▌
  Greedy                  248      13.1%      167     ×1.20   1.640 ms  ▌▌▌▌▌
  Depth-first             702      37.1%      231     ×1.66   1.180 ms  ▌▌▌▌▌▌▌▌▌▌▌▌▌▌
```

A* and Dijkstra return identical costs, as an admissible heuristic requires; A* gets there having looked at fewer cells. Greedy is the cheapest search and the worst route. Depth-first is fastest per call and worst at everything else.

## Tests

51 tests on Node's built-in runner. No test framework, no assertion library.

```bash
node --test              # everything
npm run test:unit        # pure functions
npm run test:api         # boots the real server and talks to it over TCP
```

Unit tests cover the CSV parser, the min-heap, all five algorithms (including that A* stays optimal, that a walled-off goal terminates, and that generated mazes are always solvable), the PNG encoder's round-trip, the WAV header, the pixel pipeline, and the WebSocket frame reader against hand-built masked frames.

The integration tests spawn `server/index.mjs` as a child process and exercise every endpoint over real HTTP, including a WebSocket client written from scratch in the test itself — raw socket, handshake, `Sec-WebSocket-Accept` verification, masked frame out, server frame in.

The suite paid for itself immediately: it caught that breadth-first search was using a zero-priority heap rather than a FIFO queue, so it was not breadth-first at all and returned 13-step routes where 9 was optimal. The same bug was in the browser build. Both are fixed.

## Running it

No build step and nothing to install.

```bash
node server/index.mjs                       # everything, on :8080
PORT=3000 DATA_DIR=/tmp/shelf node server/index.mjs
node --watch server/index.mjs               # reload on change

docker build -t four-apps . && docker run -p 8080:8080 four-apps
```

Or serve the folder statically and skip the backend entirely:

```bash
python3 -m http.server 8000
```

## Deploying

- **GitHub Pages** — Settings → Pages → deploy from `main` / root. The four apps work; the server-backed panels report that no backend is present.
- **Any Node host** (Fly, Render, Railway, a VPS) — start `node server/index.mjs` and mount a volume at `DATA_DIR` to keep stock data.

## Browser support

Current Chrome, Firefox and Safari. Uses `<dialog>`, pointer events, `Uint8ClampedArray`, `AbortSignal.timeout` and the Web Audio API. Audio starts only after a click, as browsers require. Requires Node 20 or newer; Node 22.5+ additionally enables the SQLite driver.

## License

MIT
