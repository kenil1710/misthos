import { chromium } from "@playwright/test";
const OUT = "/private/tmp/claude-501/-Users-kenilvakariya-misthos/ecafb2be-299d-4417-9fff-c39dad2e032e/scratchpad";
const [url, tag, width] = [process.argv[2] ?? "/", process.argv[3] ?? "l", Number(process.argv[4] ?? 1440)];
const b = await chromium.launch();
for (const t of ["light", "dark"]) {
  const c = await b.newContext({ viewport: { width, height: 900 }, colorScheme: t as "light" | "dark", deviceScaleFactor: 1 });
  await c.addInitScript((x) => localStorage.setItem("theme", x), t);
  const p = await c.newPage();
  await p.goto("http://localhost:3100" + url, { waitUntil: "networkidle" });
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await p.waitForTimeout(500);
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const H = await p.evaluate(() => document.body.scrollHeight);
  const seg = Number(process.env.SEG ?? 1400);
  for (let y = 0, i = 0; y < H; y += seg, i++)
    await p.screenshot({ path: `${OUT}/${tag}-${t}-${i}.png`, fullPage: true, clip: { x: 0, y, width, height: Math.min(seg, H - y) } });
}
await b.close();
