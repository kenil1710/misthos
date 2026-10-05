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

const X_PROFILE =
  /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i;
const handlesIn = (text: string) =>
  [...text.matchAll(/(?:^|[^\w@])@([A-Za-z0-9_]{1,15})\b/g)].map((m) => m[1]!.toLowerCase());
const profileHandle = (href: string | null | undefined) => {
  const m = X_PROFILE.exec(href ?? "");
  return m && !["i", "intent", "share", "home", "search"].includes(m[1]!.toLowerCase())
    ? m[1]!.toLowerCase()
    : null;
};

/**
 * X handles that name the article's author (F-04): author metadata (twitter:creator, meta author, rel=author,
 * JSON-LD author), the detected byline, and byline/author elements outside comment sections. A handle mentioned
 * anywhere else on the page (comments, sidebars, the body) doesn't make someone the author.
 */
function findAuthorHandles(doc: Document, byline: string | null): string[] {
  const set = new Set<string>();
  const add = (h: string | null) => h && set.add(h.replace(/^@/, "").toLowerCase());
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute("content") ?? "";
  for (const h of handlesIn(` ${meta("meta[name='twitter:creator']")}`)) add(h);
  if (/^@?[A-Za-z0-9_]{1,15}$/.test(meta("meta[name='twitter:creator']").trim()))
    add(meta("meta[name='twitter:creator']").trim());
  for (const h of handlesIn(` ${meta("meta[name='author']")}`)) add(h);
  add(profileHandle(meta("meta[name='author']")));
  const inComments = (el: Element) =>
    !!el.closest("[class*='comment' i], [id*='comment' i], [class*='reply' i]");
  doc
    .querySelectorAll(
      "[rel~='author'], [itemprop='author'], [class~='author'], [class~='byline'], [class*='byline' i]",
    )
    .forEach((el) => {
      if (inComments(el)) return;
      add(profileHandle(el.getAttribute("href")));
      el.querySelectorAll("a[href]").forEach((a) => add(profileHandle(a.getAttribute("href"))));
      for (const h of handlesIn(` ${el.textContent ?? ""}`)) add(h);
    });
  for (const s of doc.querySelectorAll("script[type='application/ld+json']")) {
    try {
      const j = JSON.parse(s.textContent ?? "");
      const nodes = Array.isArray(j)
        ? j
        : [j, ...(Array.isArray(j?.["@graph"]) ? j["@graph"] : [])];
      for (const node of nodes)
        for (const a of [node?.author].flat()) {
          if (!a) continue;
          if (typeof a === "string") for (const h of handlesIn(` ${a}`)) add(h);
          for (const u of [a.url, ...[a.sameAs].flat()]) add(profileHandle(u));
          if (typeof a.name === "string") for (const h of handlesIn(` ${a.name}`)) add(h);
        }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  for (const h of handlesIn(` ${byline ?? ""}`)) add(h);
  return [...set].slice(0, 20);
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
        authorHandles: findAuthorHandles(doc, article.byline ?? null),
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
