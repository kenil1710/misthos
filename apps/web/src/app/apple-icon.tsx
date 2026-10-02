import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1c1917",
      }}
    >
      <svg width="112" height="112" viewBox="0 0 24 24" fill="none">
        <path d="M5 13.5a7 7 0 0 1 14 0" stroke="#fafaf9" strokeWidth="2" strokeLinecap="round" />
        <path d="M5 18h14" stroke="#fafaf9" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="13.5" r="1.75" fill="#fafaf9" />
      </svg>
    </div>,
    size,
  );
}
