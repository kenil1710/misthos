/** 6-decimal base units → plain decimal input value ("12.5", "3"). */
export function unitsToInput(units: bigint | string): string {
  const v = BigInt(units);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
