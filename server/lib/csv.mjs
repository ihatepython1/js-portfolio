// RFC 4180 CSV, both directions. The browser build carries the same parser;
// this copy is what the import endpoint and the test suite use.

export function parseCsv(text) {
  const rows = [[]];
  let field = "", quoted = false;
  text = String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { rows[rows.length - 1].push(field); field = ""; }
    else if (c === "\n") { rows[rows.length - 1].push(field); field = ""; rows.push([]); }
    else field += c;
  }
  rows[rows.length - 1].push(field);
  return rows;
}

export function toCsv(records, columns) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.join(",")]
    .concat(records.map((r) => columns.map((c) => cell(r[c])).join(",")))
    .join("\n");
}

/** Turn CSV text into validated product records. Returns { products, skipped }. */
export function productsFromCsv(text) {
  const rows = parseCsv(text).filter((r) => r.join("").trim() !== "");
  if (!rows.length) return { products: [], skipped: 0 };
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  const products = [];
  let skipped = 0;
  for (const r of rows) {
    const o = {};
    head.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
    if (!o.sku || !o.name) { skipped++; continue; }
    products.push({
      sku: o.sku.toUpperCase().slice(0, 24),
      name: o.name.slice(0, 120),
      category: o.category || "Uncategorised",
      supplier: o.supplier || "",
      cost: Math.max(0, +o.cost || 0),
      price: Math.max(0, +o.price || 0),
      qty: Math.max(0, Math.round(+o.qty || 0)),
      reorder: Math.max(0, Math.round(+o.reorder || 0))
    });
  }
  return { products, skipped };
}
