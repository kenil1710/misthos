import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/p/", "/docs", "/join/"],
        disallow: ["/app", "/api/", "/c/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
