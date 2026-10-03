// Per-route client JS (raw and gzip) from a production build: node scripts/bundle-sizes.mjs [.next-show]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
const dir = process.argv[2] ?? ".next";
const routes = ["/page", "/join/[slug]/page", "/c/[slug]/page", "/c/page", "/p/[slug]/page", "/app/(overview)/page", "/app/programs/[id]/page", "/app/programs/[id]/submissions/page", "/docs/[[...slug]]/page"];
globalThis.self = globalThis;
const rows = [];
for (const r of routes) {
  const f = path.join(dir, "server/app", r + "_client-reference-manifest.js");
  if (!fs.existsSync(f)) continue;
  globalThis.__RSC_MANIFEST = {};
  (0, eval)(fs.readFileSync(f, "utf8"));
  const m = globalThis.__RSC_MANIFEST[r];
  const files = new Set();
  for (const v of Object.values(m.clientModules)) for (const c of v.chunks) if (c.endsWith(".js")) files.add(c.replace(/^\/_next\//, ""));
  for (const arr of Object.values(m.entryJSFiles ?? {})) for (const c of arr) files.add(c.replace(/^\/_next\//, ""));
  let raw = 0, gz = 0;
  for (const c of files) { const p = path.join(dir, c); if (!fs.existsSync(p)) continue; const b = fs.readFileSync(p); raw += b.length; gz += zlib.gzipSync(b).length; }
  rows.push({ route: r.replace(/\/page$/, "") || "/", rawKB: Math.round(raw / 1024), gzipKB: Math.round(gz / 1024) });
}
console.table(rows);
