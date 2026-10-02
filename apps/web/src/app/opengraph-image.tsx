import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const alt = "Misthos: contributor payroll, run by an agent you can audit.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const font = (f: string) => readFile(path.join(process.cwd(), "src/assets/fonts", f));

export default async function OpengraphImage() {
  const [medium, regular, mono] = await Promise.all([
    font("Geist-Medium.ttf"),
    font("Geist-Regular.ttf"),
    font("GeistMono-Regular.ttf"),
  ]);
  const ink = "#1c1917";
  const soft = "#57534e";
  const line = "#e7e5e4";
  const brand = "#0f6b50";
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#FAFAF9",
        padding: "72px 80px",
        fontFamily: "Geist",
        color: ink,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
          <path d="M4 13a8 8 0 0 1 16 0" stroke={brand} strokeWidth="2" strokeLinecap="round" />
          <path d="M4 18h16" stroke={brand} strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="13" r="1.75" fill={brand} />
        </svg>
        <span style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.02em" }}>Misthos</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 72,
            fontWeight: 500,
            lineHeight: 1.04,
            letterSpacing: "-0.035em",
            maxWidth: 940,
          }}
        >
          Contributor payroll, run by an agent you can audit.
        </div>
        <div style={{ marginTop: 28, fontSize: 28, color: soft, lineHeight: 1.4, maxWidth: 900 }}>
          Verified work, signed decisions, USDC payouts on Arc inside limits enforced on-chain.
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 40,
          borderTop: `1px solid ${line}`,
          paddingTop: 28,
          fontFamily: "Geist Mono",
          fontSize: 20,
          color: soft,
        }}
      >
        <span>Capped on-chain</span>
        <span>Signed decisions</span>
        <span>Verifiable on Arc</span>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Geist", data: medium, weight: 500, style: "normal" },
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}
