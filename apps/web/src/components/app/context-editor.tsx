"use client";

import { CONTEXT_ABOUT_MIN, EMPTY_READ, hasUnderstanding } from "@misthos/shared/context";
import { Check, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ABOUT_PLACEHOLDER,
  contextPayload,
  toDraftUnderstanding,
  type ContextDraft,
  type ContextSourceView,
  type UnderstandingDraft,
} from "@/lib/context-draft";
import { cn } from "@/lib/utils";

export {
  contextPayload,
  emptyContextDraft,
  toDraftUnderstanding,
  type ContextDraft,
} from "@/lib/context-draft";

/**
 * Context for the agent: what the program is about (required), links it reads once, and what every post must
 * include. "Read it" asks the agent what it understood; the owner keeps or edits that before saving.
 */
export function ContextEditor({
  value,
  onChange,
  errors = {},
  idPrefix = "ctx",
}: {
  value: ContextDraft;
  onChange: (patch: Partial<ContextDraft>) => void;
  errors?: Partial<Record<"about" | "links" | "mustInclude", string>>;
  idPrefix?: string;
}) {
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const id = (s: string) => `${idPrefix}-${s}`;
  const tooShort = value.about.trim().length < CONTEXT_ABOUT_MIN;

  async function read() {
    setReadError(null);
    setReading(true);
    try {
      const p = contextPayload(value);
      const res = await fetch("/api/owner/context/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ about: p.about, links: p.links, mustInclude: p.mustInclude }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? "The agent couldn't start reading.");
      // The worker reads the links and drafts the summary; usually a few seconds.
      for (let i = 0; i < 60 && alive.current; i++) {
        const r = await fetch(`/api/owner/context/${body.id}`, { cache: "no-store" });
        const s = (await r.json()) as {
          status: "reading" | "ready" | "failed";
          understanding: {
            summary: string;
            keyFacts: string[];
            onTopic: string[];
            offTopic: string[];
          } | null;
          sources: ContextSourceView[];
          error: string | null;
        };
        if (s.status === "ready" && s.understanding && hasUnderstanding(s.understanding)) {
          onChange({
            readId: body.id,
            understanding: toDraftUnderstanding(s.understanding),
            sources: s.sources,
          });
          return;
        }
        if (s.status === "failed" || s.status === "ready") {
          onChange({ readId: body.id, sources: s.sources });
          throw new Error(s.error ?? EMPTY_READ);
        }
        await new Promise((r) => setTimeout(r, i < 10 ? 1000 : 2500));
      }
      throw new Error("Still reading. Try again in a minute, or write the summary yourself.");
    } catch (e) {
      if (alive.current) setReadError((e as Error).message);
    } finally {
      if (alive.current) setReading(false);
    }
  }

  const u = value.understanding;
  const setU = (patch: Partial<UnderstandingDraft>) =>
    onChange({
      understanding: {
        ...(u ?? { summary: "", keyFacts: "", onTopic: "", offTopic: "" }),
        ...patch,
      },
    });

  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <Label htmlFor={id("about")}>About this program</Label>
        <Textarea
          id={id("about")}
          rows={7}
          placeholder={ABOUT_PLACEHOLDER}
          value={value.about}
          onChange={(e) => onChange({ about: e.target.value })}
          aria-invalid={!!errors.about}
        />
        {errors.about ? (
          <p role="alert" className="text-danger text-xs">
            {errors.about}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs leading-relaxed">
          What the project is, what to post about, what to avoid. The agent treats this as the truth
          when it reviews work.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id("links")}>Links (optional)</Label>
        <Textarea
          id={id("links")}
          rows={3}
          placeholder={"https://arc.network\nhttps://docs.arc.network\n@arc"}
          value={value.links}
          onChange={(e) => onChange({ links: e.target.value })}
          aria-invalid={!!errors.links}
          className="font-mono text-[13px]"
        />
        {errors.links ? (
          <p role="alert" className="text-danger text-xs">
            {errors.links}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs leading-relaxed">
          Website, docs or your X handle, one per line (up to 3). The agent reads them once.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id("must")}>Posts must include (optional)</Label>
        <Input
          id={id("must")}
          placeholder="@arc, #BuildOnArc, arc.network"
          value={value.mustInclude}
          onChange={(e) => onChange({ mustInclude: e.target.value })}
          aria-invalid={!!errors.mustInclude}
        />
        {errors.mustInclude ? (
          <p role="alert" className="text-danger text-xs">
            {errors.mustInclude}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs leading-relaxed">
          A link, @mention or #hashtag. Checked automatically; work without it goes to you for
          review.
        </p>
      </div>

      <section
        aria-labelledby={id("understood")}
        className="bg-card shadow-soft grid gap-4 rounded-2xl border p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={id("understood")} className="inline-flex items-center gap-2 font-medium">
            <Sparkles className="text-brand size-4" strokeWidth={1.5} aria-hidden="true" />
            Here&apos;s what I understood
          </h2>
          <Button
            type="button"
            size="sm"
            variant={u ? "outline" : "default"}
            disabled={reading || tooShort}
            onClick={read}
          >
            {reading ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Reading…
              </>
            ) : u ? (
              "Read again"
            ) : (
              "Read it"
            )}
          </Button>
        </div>
        {readError ? (
          <div
            role="alert"
            className="bg-warning-subtle flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm"
          >
            <span className="text-foreground min-w-0 flex-1">{readError}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reading || tooShort}
              onClick={read}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {!u ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {tooShort
              ? "Write a few sentences above, then let the agent read them and your links."
              : "Let the agent read your text and links. You'll see its summary, key facts and topics, and can edit anything before saving."}
            {!reading ? (
              <>
                {" "}
                <button
                  type="button"
                  className="text-foreground underline underline-offset-4"
                  onClick={() => setU({})}
                >
                  Or write it yourself
                </button>
                .
              </>
            ) : null}
          </p>
        ) : (
          <div className="grid gap-4">
            <UField
              id={id("summary")}
              label="Summary"
              rows={3}
              value={u.summary}
              onChange={(v) => setU({ summary: v })}
            />
            <UField
              id={id("facts")}
              label="Key facts the agent checks claims against"
              hint="One per line. Remove anything that's wrong."
              rows={4}
              value={u.keyFacts}
              onChange={(v) => setU({ keyFacts: v })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <UField
                id={id("on")}
                label="On topic"
                rows={4}
                value={u.onTopic}
                onChange={(v) => setU({ onTopic: v })}
              />
              <UField
                id={id("off")}
                label="Off topic"
                rows={4}
                value={u.offTopic}
                onChange={(v) => setU({ offTopic: v })}
              />
            </div>
          </div>
        )}
        {value.sources.length ? (
          <ul className="grid gap-1.5 border-t pt-3 text-xs" aria-label="Links the agent read">
            {value.sources.map((s) => (
              <li key={s.url} className="flex items-start gap-2">
                {s.ok ? (
                  <Check className="text-success mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <TriangleAlert
                    className="text-warning mt-0.5 size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0">
                  <span className="font-mono break-all">{s.url}</span>
                  {s.note ? <span className="text-muted-foreground"> · {s.note}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function UField(props: {
  id: string;
  label: string;
  hint?: string;
  rows: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Textarea
        id={props.id}
        rows={props.rows}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={cn("text-sm")}
      />
      {props.hint ? <p className="text-muted-foreground text-xs">{props.hint}</p> : null}
    </div>
  );
}
