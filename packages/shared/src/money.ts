import { USDC_ERC20_DECIMALS } from "./chains";

/** USDC amounts are always bigint base units of the 6-decimal ERC-20 interface. */
export type UsdcUnits = bigint;

const UNIT = 10n ** BigInt(USDC_ERC20_DECIMALS);

/** Parse a decimal string ("1234.5") into 6-decimal base units. Rejects >6 fractional digits. */
export function parseUsdc(value: string): UsdcUnits {
  const m = /^(\d+)(?:\.(\d{0,6}))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid USDC amount: "${value}"`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? "").padEnd(USDC_ERC20_DECIMALS, "0"));
  return whole * UNIT + frac;
}

/** Format base units as "1,234.50" (2 decimals, truncated toward zero, never rounded up). */
export function formatUsdc(units: UsdcUnits, opts: { withSymbol?: boolean } = {}): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const whole = abs / UNIT;
  const cents = (abs % UNIT) / 10n ** BigInt(USDC_ERC20_DECIMALS - 2);
  const s = `${neg ? "-" : ""}${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
  return opts.withSymbol === false ? s : `${s} USDC`;
}

/** Shorten an address or hash: 0x3a4f…9c21 */
export function shortHex(hex: string, head = 4, tail = 4): string {
  if (hex.length <= 2 + head + tail + 1) return hex;
  return `${hex.slice(0, 2 + head)}…${hex.slice(-tail)}`;
}
