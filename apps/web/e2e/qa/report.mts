/** Print the results table of the last live QA run as Markdown (pasted into docs/QA_REPORT.md). */
import { readFileSync } from "node:fs";
import path from "node:path";

const r = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../.qa/results.json"), "utf8"),
) as {
  run: string;
  results: { id: string; area: string; name: string; status: string; detail: string; ms: number }[];
};
const esc = (s: string) =>
  s
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .replace(/0x[0-9a-fA-F]{64}/g, (h) => `${h.slice(0, 10)}…`);
console.log(
  `| # | Area | Test | Result | Evidence | Time |\n| --- | --- | --- | --- | --- | --- |`,
);
for (const x of r.results)
  console.log(
    `| ${x.id} | ${x.area} | ${esc(x.name)} | ${x.status === "pass" ? "Pass" : "**Fail**"} | ${esc(x.detail)} | ${Math.round(x.ms / 1000)} s |`,
  );
const failed = r.results.filter((x) => x.status !== "pass").length;
console.log(`\nRun ${r.run}: ${r.results.length - failed} passed, ${failed} failed.`);
