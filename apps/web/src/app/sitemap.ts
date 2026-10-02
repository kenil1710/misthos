import { getDb, programs } from "@misthos/db";
import { and, eq, inArray } from "drizzle-orm";
import type { MetadataRoute } from "next";

/** Landing, docs, and public audit pages of real (non-demo) published programs. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const pages: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/docs`, changeFrequency: "weekly", priority: 0.7 },
  ];
  try {
    const live = await getDb()
      .select({ slug: programs.slug, updatedAt: programs.updatedAt })
      .from(programs)
      .where(and(eq(programs.isDemo, false), inArray(programs.status, ["active", "paused"])));
    for (const p of live)
      pages.push({
        url: `${base}/p/${p.slug}`,
        lastModified: p.updatedAt,
        changeFrequency: "daily",
        priority: 0.6,
      });
  } catch {
    // The sitemap still lists the static pages if the database is unavailable.
  }
  return pages;
}
