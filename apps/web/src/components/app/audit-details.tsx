import { formatUsdc, shortHex } from "@misthos/shared";
import type { ReactNode } from "react";
import { utc } from "@/lib/time";

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

/** "sourceType" → "source type": stored keys read as words. */
const label = (k: string) => LABELS[k] ?? k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

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
    if (key === "payableAfter" && /^\d{9,11}$/.test(v)) return utc(new Date(Number(v) * 1000));
    // ISO timestamps (round windows, schedules) in the app's one format.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v)))
      return utc(new Date(v));
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
          <span className="text-muted-foreground">{label(k)} </span>
          {v}
        </span>
      ))}
    </span>
  );
}
