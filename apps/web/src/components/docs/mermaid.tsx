"use client";

import { useTheme } from "next-themes";
import { useEffect, useId, useState } from "react";

/** Renders a Mermaid diagram on the client, in the current theme. Mermaid is loaded only on pages that use it. */
export function Mermaid({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("mermaid").then(async ({ default: mermaid }) => {
      const dark = resolvedTheme === "dark";
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        themeVariables: {
          background: "transparent",
          primaryColor: dark ? "#1c1b1a" : "#ffffff",
          primaryTextColor: dark ? "#ecebe9" : "#1c1917",
          primaryBorderColor: dark ? "#3a3936" : "#d6d3d1",
          lineColor: dark ? "#78716c" : "#a8a29e",
          clusterBkg: dark ? "#161615" : "#f5f5f4",
          clusterBorder: dark ? "#2e2d2b" : "#e7e5e4",
          fontSize: "14px",
        },
      });
      const { svg } = await mermaid.render(`m${id}${dark ? "d" : "l"}`, chart);
      if (!cancelled) setSvg(svg);
    });
    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);
  if (!svg)
    return (
      <div
        className="bg-fd-card my-6 h-64 animate-pulse rounded-xl border"
        aria-label="Loading diagram"
      />
    );
  return (
    <div
      className="bg-fd-card not-prose my-6 overflow-x-auto rounded-xl border p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
