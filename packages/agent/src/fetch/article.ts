import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import type { FetchResult } from "../types";
import { safeFetchHtml } from "./safe-fetch";

/** Hidden text: HTML comments, elements hidden by attribute/inline style, and alt/title attributes. */
function extractHiddenText(doc: Document): string {
  const out: string[] = [];
  const walker = doc.createTreeWalker(doc, 128 /* NodeFilter.SHOW_COMMENT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n.textContent ?? "");
  const hiddenSel =
    "[hidden],[aria-hidden='true'],[style*='display:none'],[style*='display: none'],[style*='visibility:hidden']," +
    "[style*='visibility: hidden'],[style*='font-size:0'],[style*='font-size: 0'],[style*='opacity:0'],[style*='opacity: 0']";
  doc.querySelectorAll(hiddenSel).forEach((el) => out.push(el.textContent ?? ""));
  doc
    .querySelectorAll("[alt],[title]")
    .forEach((el) => out.push(`${el.getAttribute("alt") ?? ""} ${el.getAttribute("title") ?? ""}`));
  return out.join("\n").replace(/\s+/g, " ").trim().slice(0, 20_000);
}

function findPublished(doc: Document): string | null {
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute("content") ?? null;
  const candidates = [
    meta("meta[property='article:published_time']"),
    meta("meta[name='article:published_time']"),
    meta("meta[itemprop='datePublished']"),
    meta("meta[name='date']"),
    doc.querySelector("time[datetime]")?.getAttribute("datetime") ?? null,
  ];
  for (const s of doc.querySelectorAll("script[type='application/ld+json']")) {
    try {
      const j = JSON.parse(s.textContent ?? "");
      for (const node of Array.isArray(j)
        ? j
        : [j, ...(Array.isArray(j?.["@graph"]) ? j["@graph"] : [])]) {
        if (typeof node?.datePublished === "string") candidates.push(node.datePublished);
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  for (const c of candidates)
    if (c && !Number.isNaN(Date.parse(c))) return new Date(c).toISOString();
  return null;
}

/** Every X handle the page links to or mentions (lowercased), for the ownership check. */
function findXMentions(doc: Document, text: string): string[] {
  const set = new Set<string>();
  doc.querySelectorAll("a[href]").forEach((a) => {
    const m =
      /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i.exec(
        a.getAttribute("href") ?? "",
      );
    if (m && !["i", "intent", "share", "home", "search"].includes(m[1]!.toLowerCase()))
      set.add(m[1]!.toLowerCase());
  });
  for (const m of text.matchAll(/(?:^|[^\w@])@([A-Za-z0-9_]{1,15})\b/g))
    set.add(m[1]!.toLowerCase());
  return [...set].slice(0, 200);
}

/** Parse fetched HTML into a Resource. Pure, so fixtures can exercise it without the network. */
export function parseArticle(
  resourceId: string,
  finalUrl: string,
  html: string,
): FetchResult["outcome"] {
  // Scripts never run (no runScripts), no subresources are loaded, and console noise is discarded.
  const dom = new JSDOM(html, { url: finalUrl, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const hiddenText = extractHiddenText(doc);
  const published = findPublished(doc);
  const pageText = doc.body?.textContent ?? "";
  const xMentions = findXMentions(doc, pageText);
  const article = new Readability(doc.cloneNode(true) as Document).parse();
  const text = (article?.textContent ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!article || text.length < 200) {
    return { status: "not_found", detail: "No readable article text was found at that link." };
  }
  return {
    status: "ok",
    resource: {
      sourceType: "article",
      resourceId,
      url: finalUrl,
      timestamp:
        published ??
        (article.publishedTime && !Number.isNaN(Date.parse(article.publishedTime))
          ? new Date(article.publishedTime).toISOString()
          : null),
      timestampKind: published || article.publishedTime ? "published" : "unknown",
      title: article.title || null,
      text: text.slice(0, 60_000),
      author: {
        id: null,
        handle: null,
        name: article.byline ?? null,
        createdAt: null,
        followers: null,
      },
      article: {
        siteName: article.siteName ?? null,
        byline: article.byline ?? null,
        xMentions,
        hiddenText,
      },
    },
  };
}

export async function fetchArticle(resourceId: string): Promise<FetchResult> {
  const usage = [{ provider: "web" as const, endpoint: "GET article", units: 1, estCostUsd: 0 }];
  const { finalUrl, status, html } = await safeFetchHtml(resourceId);
  if (status === 404 || status === 410)
    return { outcome: { status: "not_found", detail: "The page no longer exists." }, usage };
  return { outcome: parseArticle(resourceId, finalUrl, html), usage };
}
