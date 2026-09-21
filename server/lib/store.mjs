// Persistence with two interchangeable drivers. Node 22.5+ ships a built-in
// SQLite; where it is missing (or the filesystem is read-only) the same API is
// served from memory with a debounced JSON snapshot. Still no npm packages.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

const SEED = [
  { sku: "BV-1001", name: "น้ำดื่มสิงห์ 600ml (แพ็ค 12)", category: "Beverage", supplier: "Boonrawd", cost: 52, price: 69, qty: 48, reorder: 24 },
  { sku: "BV-1002", name: "เอส โคล่า 325ml (ลัง 24)", category: "Beverage", supplier: "Sermsuk", cost: 186, price: 240, qty: 12, reorder: 15 },
  { sku: "SN-2210", name: "เลย์ รสโนริสาหร่าย 50g", category: "Snack", supplier: "Berli Jucker", cost: 17, price: 25, qty: 96, reorder: 40 },
  { sku: "SN-2244", name: "ทาโร่ ปลาเส้น 25g (โหล)", category: "Snack", supplier: "Berli Jucker", cost: 96, price: 132, qty: 6, reorder: 12 },
  { sku: "HH-3050", name: "ผงซักฟอกบรีส 2.5kg", category: "Household", supplier: "Unilever TH", cost: 172, price: 215, qty: 21, reorder: 10 },
  { sku: "HH-3077", name: "น้ำยาล้างจานซันไลต์ 900ml", category: "Household", supplier: "Unilever TH", cost: 58, price: 79, qty: 0, reorder: 8 },
  { sku: "DR-4110", name: "พาราเซตามอล 500mg (แผง)", category: "Pharmacy", supplier: "Zuellig", cost: 8, price: 15, qty: 140, reorder: 60 },
  { sku: "ST-5001", name: "ข้าวหอมมะลิ 5kg", category: "Staple", supplier: "CP Rice", cost: 245, price: 299, qty: 18, reorder: 20 },
  { sku: "ST-5009", name: "น้ำมันปาล์มโอลีน 1L", category: "Staple", supplier: "Morakot", cost: 47, price: 62, qty: 64, reorder: 24 },
  { sku: "DA-6002", name: "นมไทยเดนมาร์ค 200ml (48)", category: "Dairy", supplier: "DPO", cost: 396, price: 480, qty: 3, reorder: 6 }
];

const FIELDS = ["sku", "name", "category", "supplier", "cost", "price", "qty", "reorder"];
const code = () => randomBytes(4).toString("base64url").slice(0, 6).toLowerCase();

export async function openStore(dataDir = join(process.cwd(), "data")) {
  try { mkdirSync(dataDir, { recursive: true }); } catch {}
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return sqliteStore(new DatabaseSync(join(dataDir, "portfolio.db")));
  } catch (err) {
    return jsonStore(join(dataDir, "portfolio.json"), err.message);
  }
}

/* ------------------------------- SQLite ------------------------------- */
function sqliteStore(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS products (
      sku TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, supplier TEXT,
      cost REAL NOT NULL, price REAL NOT NULL, qty INTEGER NOT NULL, reorder INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL, delta INTEGER NOT NULL,
      qty_after INTEGER NOT NULL, reason TEXT, at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS movements_at ON movements(at DESC);
    CREATE TABLE IF NOT EXISTS patterns (
      code TEXT PRIMARY KEY, data TEXT NOT NULL, bpm INTEGER, swing INTEGER, at TEXT NOT NULL
    );
  `);

  if (!db.prepare("SELECT count(*) n FROM products").get().n)
    for (const p of SEED) upsert(p);

  function upsert(p) {
    db.prepare(`INSERT INTO products (sku,name,category,supplier,cost,price,qty,reorder)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(sku) DO UPDATE SET name=excluded.name, category=excluded.category,
        supplier=excluded.supplier, cost=excluded.cost, price=excluded.price,
        qty=excluded.qty, reorder=excluded.reorder`)
      .run(p.sku, p.name, p.category, p.supplier ?? "", p.cost, p.price, p.qty, p.reorder);
    return p;
  }

  return {
    driver: "sqlite",
    listProducts: () => db.prepare("SELECT * FROM products ORDER BY sku").all(),
    getProduct: (sku) => db.prepare("SELECT * FROM products WHERE sku=?").get(sku) ?? null,
    upsertProduct: upsert,
    deleteProduct(sku) {
      const n = db.prepare("DELETE FROM products WHERE sku=?").run(sku).changes;
      return n > 0;
    },
    adjust(sku, delta, reason) {
      const p = db.prepare("SELECT * FROM products WHERE sku=?").get(sku);
      if (!p) return null;
      const qty = Math.max(0, p.qty + delta);
      db.prepare("UPDATE products SET qty=? WHERE sku=?").run(qty, sku);
      db.prepare("INSERT INTO movements (sku,delta,qty_after,reason,at) VALUES (?,?,?,?,?)")
        .run(sku, qty - p.qty, qty, reason ?? "manual", new Date().toISOString());
      return { ...p, qty };
    },
    movements: (limit = 60) =>
      db.prepare(`SELECT m.*, p.name FROM movements m LEFT JOIN products p USING(sku)
                  ORDER BY m.id DESC LIMIT ?`).all(Math.min(500, limit)),
    replaceAll(list) {
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM products").run();
        for (const p of list) upsert(p);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      return list.length;
    },
    savePattern(data, bpm, swing) {
      const c = code();
      db.prepare("INSERT INTO patterns (code,data,bpm,swing,at) VALUES (?,?,?,?,?)")
        .run(c, JSON.stringify(data), bpm | 0, swing | 0, new Date().toISOString());
      return c;
    },
    getPattern(c) {
      const row = db.prepare("SELECT * FROM patterns WHERE code=?").get(c);
      return row ? { ...row, data: JSON.parse(row.data) } : null;
    },
    recentPatterns: (limit = 8) =>
      db.prepare("SELECT code,bpm,swing,at FROM patterns ORDER BY at DESC LIMIT ?").all(limit)
  };
}

/* ---------------------------- JSON fallback ---------------------------- */
function jsonStore(file, why) {
  let state = { products: SEED.map((p) => ({ ...p })), movements: [], patterns: {}, nextId: 1 };
  try { state = { ...state, ...JSON.parse(readFileSync(file, "utf8")) }; } catch {}

  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(state)); } catch {}
    }, 250);
    if (timer.unref) timer.unref();
  };

  return {
    driver: "json",
    note: why,
    listProducts: () => [...state.products].sort((a, b) => a.sku.localeCompare(b.sku)),
    getProduct: (sku) => state.products.find((p) => p.sku === sku) ?? null,
    upsertProduct(p) {
      const i = state.products.findIndex((x) => x.sku === p.sku);
      const rec = Object.fromEntries(FIELDS.map((f) => [f, p[f]]));
      i > -1 ? (state.products[i] = rec) : state.products.push(rec);
      flush();
      return rec;
    },
    deleteProduct(sku) {
      const n = state.products.length;
      state.products = state.products.filter((p) => p.sku !== sku);
      flush();
      return state.products.length < n;
    },
    adjust(sku, delta, reason) {
      const p = state.products.find((x) => x.sku === sku);
      if (!p) return null;
      const before = p.qty;
      p.qty = Math.max(0, p.qty + delta);
      state.movements.unshift({
        id: state.nextId++, sku, delta: p.qty - before, qty_after: p.qty,
        reason: reason ?? "manual", at: new Date().toISOString(), name: p.name
      });
      state.movements = state.movements.slice(0, 500);
      flush();
      return { ...p };
    },
    movements: (limit = 60) => state.movements.slice(0, Math.min(500, limit)),
    replaceAll(list) {
      state.products = list.map((p) => Object.fromEntries(FIELDS.map((f) => [f, p[f]])));
      flush();
      return list.length;
    },
    savePattern(data, bpm, swing) {
      const c = code();
      state.patterns[c] = { code: c, data, bpm: bpm | 0, swing: swing | 0, at: new Date().toISOString() };
      flush();
      return c;
    },
    getPattern: (c) => state.patterns[c] ?? null,
    recentPatterns: (limit = 8) =>
      Object.values(state.patterns).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
        .map(({ code, bpm, swing, at }) => ({ code, bpm, swing, at }))
  };
}

export { SEED, FIELDS };
