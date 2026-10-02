import { formatUsdc, shortHex } from "@misthos/shared";
import type { ReactNode } from "react";

/** Keys whose values are 6-decimal USDC base units. */
const USDC_KEYS = new Set([
  "amount",
  "total",
  "threshold",
  "maxPerPayout",
  "maxPerRound",
  "maxPerDay",
  "autoApproveThreshold",
  "maxAutoApproveItem",
  "ratePerPoint",
]);
const LABELS: Record<string, string> = {
  txHash: "tx",
  decisionHash: "decision",
  payableAfter: "payable after",
  decisionRoot: "root",
  payoutId: "payout",
};

const link = (href: string, text: string) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="text-foreground font-mono underline-offset-4 hover:underline"
  >
    {text}
  </a>
);

function value(key: string, v: unknown, explorer: string, verifyBase: string | null): ReactNode {
  if (typeof v === "string") {
    if (USDC_KEYS.has(key) && /^\d+$/.test(v))
      return <span className="mono-num text-foreground">{formatUsdc(BigInt(v))}</span>;
    if (key === "txHash" && /^0x[0-9a-fA-F]{64}$/.test(v))
      return link(`${explorer}/tx/${v}`, shortHex(v));
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) return link(`${explorer}/address/${v}`, shortHex(v));
    if (key === "decisionHash" && /^0x[0-9a-fA-F]{64}$/.test(v) && verifyBase)
      return link(`${verifyBase}#verify?d=${v}`, shortHex(v));
    if (/^0x[0-9a-fA-F]{64}$/.test(v)) return <span className="font-mono">{shortHex(v)}</span>;
    if (key === "payableAfter" && /^\d{9,11}$/.test(v))
      return `${new Date(Number(v) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
    return v.length > 48 ? `${v.slice(0, 45)}…` : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v))
    return v.length === 0
      ? "none"
      : v.every((x) => typeof x === "string")
        ? v.join(", ")
        : `${v.length} item${v.length === 1 ? "" : "s"}`;
  return null;
}

/** Readable audit-event details: amounts in USDC, hashes and addresses linked, the raw JSON on hover. */
export function AuditDetails({
  data,
  explorer,
  verifyBase,
}: {
  data: unknown;
  explorer: string;
  verifyBase: string | null;
}) {
  if (!data || typeof data !== "object") return null;
  const parts = Object.entries(data as Record<string, unknown>)
    .map(([k, v]) => [k, value(k, v, explorer, verifyBase)] as const)
    .filter(([, v]) => v !== null && v !== "")
    .slice(0, 5);
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-0.5" title={JSON.stringify(data)}>
      {parts.map(([k, v]) => (
        <span key={k}>
          <span className="text-muted-foreground">{LABELS[k] ?? k} </span>
          {v}
        </span>
      ))}
    </span>
  );
}
