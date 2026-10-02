import { readFileSync, writeFileSync } from "node:fs";

/**
 * Set KEY=value in a .env file without touching any other line: fills an existing empty `KEY=` line in place, or
 * appends. Refuses to overwrite a non-empty value. Values are never printed.
 */
export function setEnvLine(
  path: string,
  key: string,
  value: string,
  comment?: string,
): "filled" | "appended" | "unchanged" {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) {
    const current = lines[i]!.slice(key.length + 1);
    if (current === value) return "unchanged";
    if (current.trim() !== "")
      throw new Error(`${key} already has a value in ${path}; not overwriting it.`);
    lines[i] = `${key}=${value}`;
    writeFileSync(path, lines.join("\n"));
    return "filled";
  }
  const sep = text.endsWith("\n") ? "" : "\n";
  writeFileSync(path, `${text}${sep}${comment ? `# ${comment}\n` : ""}${key}=${value}\n`);
  return "appended";
}
