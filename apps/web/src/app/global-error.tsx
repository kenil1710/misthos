"use client";

/** Last resort when the root layout itself fails: no app styles are guaranteed, so this stays self-contained. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          maxWidth: 520,
          margin: "15vh auto",
          padding: "0 16px",
          color: "#1c1917",
          background: "#fafaf9",
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 500 }}>Misthos couldn&apos;t load</h1>
        <p style={{ color: "#57534e", fontSize: 14, lineHeight: 1.6 }}>
          It couldn&apos;t reach its database or the Arc network just now. Your data is safe;
          nothing was changed.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 12,
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid #d6d3d1",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
