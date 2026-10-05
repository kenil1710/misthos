import { cn } from "@/lib/utils";

/**
 * The "blockies" identicon wallets and explorers show for an address (8×8, mirrored, three colours), so the avatar
 * here matches what people see in MetaMask or on Etherscan. Deterministic and pure: no wallet code.
 */
export function Identicon({ seed, className }: { seed: string; className?: string }) {
  const { cells, color, bg, spot } = blockies(seed.toLowerCase());
  return (
    <svg
      viewBox="0 0 8 8"
      aria-hidden="true"
      shapeRendering="crispEdges"
      className={cn("size-7 shrink-0 rounded-full", className)}
    >
      <rect width="8" height="8" fill={bg} />
      {cells.map((v, i) =>
        v ? (
          <rect
            key={i}
            x={i % 8}
            y={Math.floor(i / 8)}
            width="1"
            height="1"
            fill={v === 1 ? color : spot}
          />
        ) : null,
      )}
    </svg>
  );
}

/** The ethereum-blockies algorithm (xorshift seeded from the string). */
function blockies(seed: string) {
  const s = [0, 0, 0, 0];
  for (let i = 0; i < seed.length; i++)
    s[i % 4] = (s[i % 4]! << 5) - s[i % 4]! + seed.charCodeAt(i);
  const rand = () => {
    const t = s[0]! ^ (s[0]! << 11);
    s[0] = s[1]!;
    s[1] = s[2]!;
    s[2] = s[3]!;
    s[3] = s[3]! ^ (s[3]! >> 19) ^ t ^ (t >> 8);
    return (s[3]! >>> 0) / ((1 << 31) >>> 0);
  };
  const hsl = () => {
    const h = Math.floor(rand() * 360);
    const sat = rand() * 60 + 40;
    const l = (rand() + rand() + rand() + rand()) * 25;
    return `hsl(${h} ${sat}% ${l}%)`;
  };
  const color = hsl();
  const bg = hsl();
  const spot = hsl();
  const cells: number[] = [];
  for (let y = 0; y < 8; y++) {
    const half = Array.from({ length: 4 }, () => Math.floor(rand() * 2.3));
    cells.push(...half, ...[...half].reverse());
  }
  return { cells, color, bg, spot };
}
