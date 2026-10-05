"use client";

import { formatUsdc } from "@misthos/shared/money";
import { SOURCE_LABELS, SOURCE_TYPES, type SourceType } from "@misthos/shared/sources";
import { BudgetInput, LimitsInput, ProgramBasics, Rubric } from "@misthos/shared";
import { ArrowLeft, ArrowRight, Check, Eye, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { z } from "zod";
import { FocusHeader, FocusMain } from "@/components/app/focus-frame";
import { VaultArt } from "@/components/brand/illustrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { CooldownWarning } from "@/components/vault/cooldown-warning";
import { LIMIT_HELP } from "@/lib/limits-help";
import {
  deriveDefaultLimits,
  limitWarnings,
  itemNoun,
  perfectPayout,
  tryParseUsdc,
} from "@/lib/program-math";
import { cn } from "@/lib/utils";
import { fromNow, localAndUtc, toLocalInput } from "@/lib/when";
import { createProgramAction } from "../actions";
import { STEP_META, STEPS } from "./wizard-steps";

// ─── Form state (strings, as typed) ─────────────────────────────────────────

type Criterion = { name: string; description: string };
type Category = {
  name: string;
  description: string;
  sourceTypes: SourceType[];
  maxPoints: string;
  criteria: Criterion[];
  rules: string;
  requireMerged: boolean;
};
type Limits = {
  maxPerPayout: string;
  maxPerRound: string;
  maxPerDay: string;
  autoApproveThreshold: string;
  payeeCooldownHours: string;
};
type Form = {
  basics: { name: string; slug: string; description: string; logoUrl: string };
  rubric: { categories: Category[]; generalRules: string };
  budget: {
    ratePerPoint: string;
    roundLengthDays: string;
    startMode: "now" | "later";
    /** datetime-local value in the owner's zone, only used when startMode is "later". */
    firstRoundStartsAt: string;
    autoApproveConfidence: string;
    maxAutoApproveItem: string;
    minAccountAgeDays: string;
  };
  limits: Limits;
  /** Until the owner edits a limit, limits follow the rubric (see deriveDefaultLimits). */
  limitsEdited: boolean;
  slugEdited: boolean;
};

/** A starting rubric the owner edits; it is a template, not data. */
const STARTER_CATEGORIES: Category[] = [
  {
    name: "Threads and posts",
    description: "Original posts or threads that teach something about the project.",
    sourceTypes: ["x_post"],
    maxPoints: "10",
    criteria: [
      { name: "Depth", description: "Explains how or why, not just what." },
      { name: "Clarity", description: "Easy to follow for the intended audience." },
      { name: "Originality", description: "Not a rewrite of existing content." },
    ],
    rules: "Threads should be at least 3 posts. Announcement retweets and memes are not paid.",
    requireMerged: true,
  },
  {
    name: "Pull requests",
    description: "Code, docs or test contributions to the project's public repositories.",
    sourceTypes: ["github_pr"],
    maxPoints: "20",
    criteria: [
      { name: "Impact", description: "Fixes a real problem or adds a useful capability." },
      {
        name: "Quality",
        description: "Readable, tested, and follows the repository's conventions.",
      },
    ],
    rules: "Only merged pull requests are paid. Typo-only changes earn at most 2 points.",
    requireMerged: true,
  },
];

const initialForm = (): Form => ({
  basics: { name: "", slug: "", description: "", logoUrl: "" },
  rubric: { categories: STARTER_CATEGORIES, generalRules: "" },
  budget: {
    ratePerPoint: "0.5",
    roundLengthDays: "7",
    startMode: "now",
    firstRoundStartsAt: "",
    autoApproveConfidence: "0.8",
    maxAutoApproveItem: "",
    minAccountAgeDays: "30",
  },
  limits: {
    maxPerPayout: "",
    maxPerRound: "",
    maxPerDay: "",
    autoApproveThreshold: "",
    payeeCooldownHours: "24",
  },
  limitsEdited: false,
  slugEdited: false,
});

const DRAFT_KEY = "misthos:new-program-draft:v1";

function loadDraft(): { form: Form; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { form: Form; savedAt: string };
    return d?.form?.basics && d.form.rubric?.categories ? d : null;
  } catch {
    return null;
  }
}

const toKey = (s: string, i: number) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "c_$1")
    .slice(0, 32) || `item_${i + 1}`;

const toSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** Rate, best perfect payout and the limits in effect (derived until the owner edits them). */
function effective(f: Form) {
  const rate = tryParseUsdc(f.budget.ratePerPoint);
  const perfect = f.rubric.categories.map((c) =>
    rate !== null && Number(c.maxPoints) > 0 ? perfectPayout(Number(c.maxPoints), rate) : null,
  );
  const maxItem = perfect.reduce<bigint>((m, p) => (p !== null && p > m ? p : m), 0n);
  const derived = deriveDefaultLimits(maxItem);
  const limits: Limits = f.limitsEdited
    ? f.limits
    : {
        maxPerPayout: derived.maxPerPayout,
        maxPerRound: derived.maxPerRound,
        maxPerDay: derived.maxPerDay,
        autoApproveThreshold: derived.autoApproveThreshold,
        payeeCooldownHours: f.limits.payeeCooldownHours,
      };
  const maxAutoApproveItem = f.limitsEdited
    ? f.budget.maxAutoApproveItem
    : derived.maxAutoApproveItem;
  return { rate, perfect, maxItem, limits, maxAutoApproveItem };
}

function startDate(f: Form, now: Date): Date | null {
  if (f.budget.startMode === "now") return now;
  const t = Date.parse(f.budget.firstRoundStartsAt);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Convert typed strings into the shape the shared zod schemas expect. */
function toPayload(f: Form, now: Date) {
  const e = effective(f);
  const start = startDate(f, now);
  return {
    basics: f.basics,
    rubric: {
      generalRules: f.rubric.generalRules,
      categories: f.rubric.categories.map((c, i) => ({
        key: toKey(c.name, i),
        name: c.name,
        description: c.description,
        sourceTypes: c.sourceTypes,
        maxPoints: Number(c.maxPoints),
        criteria: c.criteria.map((k, j) => ({
          key: toKey(k.name, j),
          name: k.name,
          description: k.description,
        })),
        rules: c.rules,
        requireMerged: c.requireMerged,
      })),
    },
    budget: {
      ratePerPoint: f.budget.ratePerPoint,
      roundLengthDays: f.budget.roundLengthDays,
      firstRoundStartsAt: start ? start.toISOString() : "",
      autoApproveConfidence: f.budget.autoApproveConfidence,
      maxAutoApproveItem: e.maxAutoApproveItem,
      minAccountAgeDays: f.budget.minAccountAgeDays,
    },
    limits: e.limits,
  };
}

/** Zod's default messages ("Too small: expected string to have >=10 characters") in plain words. */
function humanize(i: z.core.$ZodIssue): string {
  const issue = i as {
    code: string;
    origin?: string;
    minimum?: number | bigint;
    maximum?: number | bigint;
    format?: string;
  };
  if (!/^(Too small|Too big|Invalid)/.test(i.message)) return i.message; // our own message
  if (issue.code === "too_small" && issue.origin === "string")
    return Number(issue.minimum) <= 1 ? "Required." : `Use at least ${issue.minimum} characters.`;
  if (issue.code === "too_big" && issue.origin === "string")
    return `Keep it under ${issue.maximum} characters.`;
  if (issue.code === "too_small" && issue.origin === "array")
    return `Add at least ${issue.minimum}.`;
  if (issue.code === "too_big" && issue.origin === "array") return `At most ${issue.maximum}.`;
  if (issue.code === "too_small") return `Must be at least ${issue.minimum}.`;
  if (issue.code === "too_big") return `Must be at most ${issue.maximum}.`;
  if (issue.format === "url") return "Use a full https:// link.";
  return "Check this value.";
}

/** The value at an error key like "basics.slug" or "rubric.categories.0.name". */
function valueAt(obj: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (o, part) => (o && typeof o === "object" ? (o as Record<string, unknown>)[part] : undefined),
      obj,
    );
}

function issues(schema: z.ZodType, value: unknown, prefix: string): Record<string, string> {
  const r = schema.safeParse(value);
  const out: Record<string, string> = {};
  if (!r.success)
    for (const i of r.error.issues) out[[prefix, ...i.path].join(".")] ??= humanize(i);
  return out;
}

/** Field ids → the error keys the schemas report, for validating a field when the owner leaves it. */
const ID_KEYS: Record<string, string> = {
  name: "basics.name",
  slug: "basics.slug",
  description: "basics.description",
  logo: "basics.logoUrl",
  rate: "budget.ratePerPoint",
  len: "budget.roundLengthDays",
  start: "budget.firstRoundStartsAt",
  age: "budget.minAccountAgeDays",
  conf: "budget.autoApproveConfidence",
  autoitem: "budget.maxAutoApproveItem",
  perpayout: "limits.maxPerPayout",
  perround: "limits.maxPerRound",
  perday: "limits.maxPerDay",
  threshold: "limits.autoApproveThreshold",
  cooldown: "limits.payeeCooldownHours",
};

const APP_HOST = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/^https?:\/\//, "");

// ─── Small field helpers ────────────────────────────────────────────────────

function Field({
  id,
  label,
  hint,
  error,
  warning,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  warning?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : null}
      {warning && !error ? <p className="text-warning text-xs leading-relaxed">{warning}</p> : null}
      {hint ? <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p> : null}
    </div>
  );
}

function UnitInput(props: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        id={props.id}
        inputMode="decimal"
        autoComplete="off"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.invalid}
        className="pr-16 font-mono tabular-nums"
      />
      <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">
        {props.unit}
      </span>
    </div>
  );
}

// ─── Wizard ─────────────────────────────────────────────────────────────────

export function ProgramWizard() {
  const pathname = usePathname();
  const search = useSearchParams();
  // The step lives in React state so a click always moves it at once. The URL mirrors it (shareable, and Back /
  // Forward work) but is only read on load and on popstate: right after hydration the router can still rewrite the
  // URL, and a step kept only in the URL could be silently undone.
  const stepFromUrl = (q: { get: (k: string) => string | null }) =>
    Math.min(STEPS.length, Math.max(1, Number(q.get("step")) || 1)) - 1;
  const [requested, setRequested] = useState(() => stepFromUrl(search));
  useEffect(() => {
    const onPop = () => setRequested(stepFromUrl(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Rendered client-only (see wizard-loader), so the saved draft can seed the first render.
  const [restored] = useState(() => loadDraft());
  const [form, setForm] = useState<Form>(() => restored?.form ?? initialForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Errors from the server (e.g. a join link someone else took), shown until that field's value changes.
  const [serverErrors, setServerErrors] = useState<
    Record<string, { message: string; value: string }>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [savedAt, setSavedAt] = useState<string | null>(restored?.savedAt ?? null);
  const dirty = savedAt !== null || JSON.stringify(form) !== JSON.stringify(initialForm());
  const [pending, startTransition] = useTransition();
  const [previewOpen, setPreviewOpen] = useState(false);
  const submitting = useRef(false);

  const [now] = useState(() => new Date());
  const payload = toPayload(form, now);
  const eff = effective(form);

  function validate(s: number): Record<string, string> {
    if (s === 0) return issues(ProgramBasics, payload.basics, "basics");
    if (s === 1) return issues(Rubric, payload.rubric, "rubric");
    if (s === 2) {
      const out = {
        ...issues(BudgetInput, payload.budget, "budget"),
        ...issues(LimitsInput, payload.limits, "limits"),
      };
      if (form.budget.startMode === "later") {
        const t = Date.parse(form.budget.firstRoundStartsAt);
        if (Number.isNaN(t)) out["budget.firstRoundStartsAt"] = "Pick a date and time.";
        else if (t < now.getTime() - 60_000)
          out["budget.firstRoundStartsAt"] = "That's in the past. Pick a later time or start now.";
      }
      return out;
    }
    return {};
  }
  // A link straight to a later step only works once the earlier steps are complete.
  const firstInvalid = [0, 1, 2].find((s) => Object.keys(validate(s)).length > 0) ?? 3;
  const step = Math.min(requested, firstInvalid);

  // Keep a draft so a refresh or a browser Back doesn't lose anything. Saved on every change (not debounced): a
  // step change can remount the wizard right after a keystroke.
  useEffect(() => {
    if (submitting.current) return;
    try {
      const at = new Date().toISOString();
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, savedAt: at }));
    } catch {
      /* storage unavailable: the form still works, it just isn't saved */
    }
  }, [form]);

  // Steps are client-only history entries: instant, no server round trip, and Back/Forward still work (Next keeps
  // useSearchParams in sync with the native history API).
  const goTo = (s: number) => {
    setRequested(s);
    window.history.pushState(null, "", `${pathname}?step=${s + 1}`);
    window.scrollTo({ top: 0 });
  };

  const update = <K extends "basics" | "rubric" | "budget">(section: K, patch: Partial<Form[K]>) =>
    setForm((f) => ({ ...f, [section]: { ...f[section], ...patch } }));
  const updateCategory = (i: number, patch: Partial<Category>) =>
    setForm((f) => ({
      ...f,
      rubric: {
        ...f.rubric,
        categories: f.rubric.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)),
      },
    }));
  /** The first edit to any limit freezes the derived values so they stop following the rubric. */
  const editLimit = (patch: Partial<Limits> & { maxAutoApproveItem?: string }) =>
    setForm((f) => {
      const e = effective(f);
      const { maxAutoApproveItem, ...limits } = patch;
      return {
        ...f,
        limitsEdited: true,
        limits: { ...(f.limitsEdited ? f.limits : e.limits), ...limits },
        budget: {
          ...f.budget,
          maxAutoApproveItem:
            maxAutoApproveItem ??
            (f.limitsEdited ? f.budget.maxAutoApproveItem : e.maxAutoApproveItem),
        },
      };
    });

  function onFieldBlur(ev: React.FocusEvent) {
    const key = ID_KEYS[(ev.target as HTMLElement).id];
    if (!key) return;
    const t = new Set(touched).add(key);
    setTouched(t);
    const all = validate(step);
    setErrors((prev) => {
      const out = { ...prev };
      for (const k of t) {
        if (all[k]) out[k] = all[k];
        else delete out[k];
      }
      return out;
    });
  }

  function next() {
    const e = validate(step);
    setErrors(e);
    if (Object.keys(e).length === 0) goTo(step + 1);
  }

  function discardDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    setForm(initialForm());
    setErrors({});
    setServerErrors({});
    setSavedAt(null);
    goTo(0);
  }

  function submit() {
    setFormError(null);
    submitting.current = true;
    startTransition(async () => {
      const res = await createProgramAction(toPayload(form, new Date()));
      // On success the action redirects (and the draft is cleared below); anything returned is an error.
      submitting.current = false;
      if (res?.fieldErrors) {
        const sent = toPayload(form, new Date());
        setServerErrors(
          Object.fromEntries(
            Object.entries(res.fieldErrors).map(([k, message]) => [
              k,
              { message, value: JSON.stringify(valueAt(sent, k)) },
            ]),
          ),
        );
        const keys = Object.keys(res.fieldErrors);
        const first = ["basics", "rubric", "budget"].findIndex((p) =>
          keys.some((k) => k.startsWith(p) || (p === "budget" && k.startsWith("limits"))),
        );
        if (first >= 0) goTo(first);
      }
      if (res?.error) setFormError(res.error);
    });
  }
  // The redirect after a successful create unmounts the wizard mid-transition: clear the draft then.
  useEffect(
    () => () => {
      if (submitting.current)
        try {
          localStorage.removeItem(DRAFT_KEY);
        } catch {
          /* ignore */
        }
    },
    [],
  );

  // A flagged field (left once, or caught by Continue) shows its error only while it's still wrong, so the error goes
  // away the moment the value is fixed. Clearing it on blur instead shifted the layout mid-click and lost the click.
  const live = validate(step);
  const e: Record<string, string> = {};
  for (const k of new Set([...touched, ...Object.keys(errors)])) if (live[k]) e[k] = live[k];
  for (const [k, se] of Object.entries(serverErrors))
    if (!e[k] && JSON.stringify(valueAt(payload, k)) === se.value) e[k] = se.message;
  const warnings = limitWarnings({
    maxCategoryPayout: eff.maxItem > 0n ? eff.maxItem : null,
    maxAutoApproveItem: tryParseUsdc(eff.maxAutoApproveItem),
    maxPerPayout: tryParseUsdc(eff.limits.maxPerPayout),
    maxPerRound: tryParseUsdc(eff.limits.maxPerRound),
    maxPerDay: tryParseUsdc(eff.limits.maxPerDay),
    autoApproveThreshold: tryParseUsdc(eff.limits.autoApproveThreshold),
  });
  const warn = (field: string) => warnings.find((w) => w.field === field)?.text;
  const start = startDate(form, now);
  const len = Number(form.budget.roundLengthDays);
  const end = start && len > 0 ? new Date(start.getTime() + len * 86_400_000) : null;

  const meta = STEP_META[step]!;
  return (
    <>
      <FocusHeader
        progress={<WizardProgress step={step} onGo={goTo} />}
        exit={
          <Button asChild variant="ghost" size="sm">
            <Link href="/app">Save and exit</Link>
          </Button>
        }
      />
      <FocusMain>
        <div className="grid items-start gap-12 pt-8 sm:pt-12 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)] xl:gap-20">
          <div className="min-w-0">
            <p className="text-brand text-sm font-medium">
              Step {step + 1} of {STEPS.length}
              <span className="text-muted-foreground font-normal"> · {STEPS[step]}</span>
            </p>
            <h1 className="display mt-2 text-[2.5rem] leading-[1.05] sm:text-[3.25rem]">
              {meta.title}
            </h1>
            <p className="text-soft mt-3 max-w-[56ch] text-[15px] leading-relaxed">{meta.intro}</p>
            {dirty ? (
              <p className="text-muted-foreground mt-3 text-xs" aria-live="polite">
                Draft saved on this device ·{" "}
                <button
                  type="button"
                  className="hover:text-foreground underline underline-offset-4"
                  onClick={discardDraft}
                >
                  Discard draft
                </button>
              </p>
            ) : null}

            <div className="mt-8 grid gap-6" onBlur={onFieldBlur}>
              {step === 0 ? (
                <>
                  <Field id="name" label="Program name" error={e["basics.name"]}>
                    <Input
                      id="name"
                      placeholder="Arc Creators"
                      value={form.basics.name}
                      onChange={(ev) => {
                        const name = ev.target.value;
                        setForm((f) => ({
                          ...f,
                          basics: {
                            ...f.basics,
                            name,
                            ...(f.slugEdited ? {} : { slug: toSlug(name) }),
                          },
                        }));
                      }}
                      aria-invalid={!!e["basics.name"]}
                    />
                  </Field>
                  <Field
                    id="slug"
                    label="Join link"
                    hint="Filled in from the name. Lowercase letters, numbers and dashes."
                    error={e["basics.slug"]}
                  >
                    <div
                      className={cn(
                        "border-input focus-within:border-ring focus-within:ring-ring/50 flex h-8 items-center overflow-hidden rounded-lg border focus-within:ring-3 dark:bg-input/30",
                        e["basics.slug"] && "border-destructive",
                      )}
                    >
                      <span className="text-muted-foreground bg-muted/50 flex h-full shrink-0 items-center border-r px-2.5 font-mono text-[13px]">
                        {APP_HOST}/join/
                      </span>
                      <input
                        id="slug"
                        placeholder="arc-creators"
                        value={form.basics.slug}
                        onChange={(ev) =>
                          setForm((f) => ({
                            ...f,
                            slugEdited: true,
                            basics: { ...f.basics, slug: ev.target.value },
                          }))
                        }
                        className="placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm outline-none"
                        aria-invalid={!!e["basics.slug"]}
                      />
                    </div>
                  </Field>
                  <Field
                    id="description"
                    label="Description"
                    hint="Shown on the join page. Say what you pay for and who it's for."
                    error={e["basics.description"]}
                  >
                    <Textarea
                      id="description"
                      rows={4}
                      placeholder="Pays builders for original threads, guides and pull requests that help others ship on Arc."
                      value={form.basics.description}
                      onChange={(ev) => update("basics", { description: ev.target.value })}
                      aria-invalid={!!e["basics.description"]}
                    />
                  </Field>
                  <Field
                    id="logo"
                    label="Logo URL (optional)"
                    hint="A square https image."
                    error={e["basics.logoUrl"]}
                  >
                    <Input
                      id="logo"
                      type="url"
                      placeholder="https://example.com/logo.png"
                      value={form.basics.logoUrl}
                      onChange={(ev) => update("basics", { logoUrl: ev.target.value })}
                      aria-invalid={!!e["basics.logoUrl"]}
                    />
                  </Field>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <ScoringExplainer rate={eff.rate} />
                  {form.rubric.categories.map((c, i) => (
                    <fieldset
                      key={i}
                      className="bg-card shadow-soft grid gap-4 rounded-[1.25rem] p-5 sm:p-6"
                    >
                      <div className="flex items-center justify-between">
                        <legend className="text-sm font-medium">Category {i + 1}</legend>
                        {form.rubric.categories.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                rubric: {
                                  ...f.rubric,
                                  categories: f.rubric.categories.filter((_, j) => j !== i),
                                },
                              }))
                            }
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            Remove
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
                        <Field
                          id={`c${i}-name`}
                          label="Name"
                          error={
                            e[`rubric.categories.${i}.name`] ?? e[`rubric.categories.${i}.key`]
                          }
                        >
                          <Input
                            id={`c${i}-name`}
                            placeholder="Threads and posts"
                            value={c.name}
                            onChange={(ev) => updateCategory(i, { name: ev.target.value })}
                          />
                        </Field>
                        <Field
                          id={`c${i}-max`}
                          label="Max points"
                          error={e[`rubric.categories.${i}.maxPoints`]}
                        >
                          <UnitInput
                            id={`c${i}-max`}
                            unit="points"
                            placeholder="10"
                            value={c.maxPoints}
                            onChange={(v) => updateCategory(i, { maxPoints: v })}
                          />
                        </Field>
                      </div>
                      <p className="bg-muted/60 rounded-xl px-3.5 py-2.5 text-sm">
                        A perfect {itemNoun(c.name)} (10/10) earns{" "}
                        <span className="mono-num font-medium">
                          {eff.perfect[i] !== null && eff.perfect[i] !== undefined
                            ? formatUsdc(eff.perfect[i]!)
                            : "—"}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          ({c.maxPoints || "0"} points ×{" "}
                          {eff.rate !== null ? formatUsdc(eff.rate) : "rate"} per point). A 7/10
                          average earns 70% of that.
                        </span>
                      </p>
                      <Field
                        id={`c${i}-desc`}
                        label="What counts"
                        error={e[`rubric.categories.${i}.description`]}
                      >
                        <Textarea
                          id={`c${i}-desc`}
                          rows={2}
                          placeholder="Original posts or threads that teach something about building on Arc."
                          value={c.description}
                          onChange={(ev) => updateCategory(i, { description: ev.target.value })}
                        />
                      </Field>
                      <div className="grid gap-1.5">
                        <span className="text-sm font-medium">Accepted sources</span>
                        <div className="flex flex-wrap gap-4">
                          {SOURCE_TYPES.map((t) => (
                            <label key={t} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="accent-brand size-4"
                                checked={c.sourceTypes.includes(t)}
                                onChange={(ev) =>
                                  updateCategory(i, {
                                    sourceTypes: ev.target.checked
                                      ? [...c.sourceTypes, t]
                                      : c.sourceTypes.filter((x) => x !== t),
                                  })
                                }
                              />
                              {SOURCE_LABELS[t]}
                            </label>
                          ))}
                        </div>
                        {e[`rubric.categories.${i}.sourceTypes`] ? (
                          <p className="text-danger text-xs">Pick at least one source.</p>
                        ) : null}
                      </div>
                      {c.sourceTypes.includes("github_pr") ? (
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="accent-brand size-4"
                            checked={c.requireMerged}
                            onChange={(ev) =>
                              updateCategory(i, { requireMerged: ev.target.checked })
                            }
                          />
                          Only pay merged pull requests
                        </label>
                      ) : null}
                      <div className="grid gap-2">
                        <span className="text-sm font-medium">Scoring criteria</span>
                        <p className="text-muted-foreground -mt-1 text-xs">
                          The agent scores each from 0 to 10 and explains why. The category&apos;s
                          points are their average ÷ 10 × max points.
                        </p>
                        {c.criteria.map((k, j) => (
                          <div key={j} className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
                            <Input
                              aria-label={`Criterion ${j + 1} name`}
                              placeholder={["Depth", "Clarity", "Originality"][j] ?? "Criterion"}
                              value={k.name}
                              onChange={(ev) =>
                                updateCategory(i, {
                                  criteria: c.criteria.map((x, m) =>
                                    m === j ? { ...x, name: ev.target.value } : x,
                                  ),
                                })
                              }
                            />
                            <Input
                              aria-label={`Criterion ${j + 1} description`}
                              placeholder="What a 10 looks like, e.g. explains how and why"
                              value={k.description}
                              onChange={(ev) =>
                                updateCategory(i, {
                                  criteria: c.criteria.map((x, m) =>
                                    m === j ? { ...x, description: ev.target.value } : x,
                                  ),
                                })
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove criterion ${j + 1}`}
                              disabled={c.criteria.length === 1}
                              onClick={() =>
                                updateCategory(i, {
                                  criteria: c.criteria.filter((_, m) => m !== j),
                                })
                              }
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        ))}
                        {Object.keys(e).some((k) =>
                          k.startsWith(`rubric.categories.${i}.criteria`),
                        ) ? (
                          <p className="text-danger text-xs">
                            Each criterion needs a unique name and a description.
                          </p>
                        ) : null}
                        {c.criteria.length < 8 ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="justify-self-start"
                            onClick={() =>
                              updateCategory(i, {
                                criteria: [...c.criteria, { name: "", description: "" }],
                              })
                            }
                          >
                            <Plus className="size-4" aria-hidden="true" />
                            Add criterion
                          </Button>
                        ) : null}
                      </div>
                      <Field
                        id={`c${i}-rules`}
                        label="Rules (plain language, optional)"
                        error={e[`rubric.categories.${i}.rules`]}
                      >
                        <Textarea
                          id={`c${i}-rules`}
                          rows={2}
                          placeholder="Threads should be at least 3 posts. Memes and reposts are not paid."
                          value={c.rules}
                          onChange={(ev) => updateCategory(i, { rules: ev.target.value })}
                        />
                      </Field>
                    </fieldset>
                  ))}
                  {form.rubric.categories.length < 10 ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="justify-self-start"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          rubric: {
                            ...f.rubric,
                            categories: [
                              ...f.rubric.categories,
                              {
                                name: "",
                                description: "",
                                sourceTypes: ["article"],
                                maxPoints: "10",
                                criteria: [{ name: "", description: "" }],
                                rules: "",
                                requireMerged: true,
                              },
                            ],
                          },
                        }))
                      }
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      Add category
                    </Button>
                  ) : null}
                  <Field
                    id="general"
                    label="Rules for every submission (optional)"
                    error={e["rubric.generalRules"]}
                  >
                    <Textarea
                      id="general"
                      rows={3}
                      placeholder="English only. Original work about building on Arc."
                      value={form.rubric.generalRules}
                      onChange={(ev) => update("rubric", { generalRules: ev.target.value })}
                    />
                  </Field>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <section
                    className="bg-card shadow-soft grid gap-4 rounded-[1.25rem] p-5 sm:p-6"
                    aria-labelledby="schedule-h"
                  >
                    <h2 id="schedule-h" className="text-base font-medium">
                      Schedule
                    </h2>
                    <div className="grid gap-1.5">
                      <span className="text-sm font-medium" id="start-label">
                        First round starts
                      </span>
                      <div
                        role="radiogroup"
                        aria-labelledby="start-label"
                        className="flex flex-wrap gap-2"
                      >
                        {(
                          [
                            ["now", "Now"],
                            ["later", "Schedule for later"],
                          ] as const
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            role="radio"
                            aria-checked={form.budget.startMode === mode}
                            onClick={() =>
                              update("budget", {
                                startMode: mode,
                                ...(mode === "later" && !form.budget.firstRoundStartsAt
                                  ? {
                                      firstRoundStartsAt: toLocalInput(
                                        new Date(Date.now() + 86_400_000),
                                      ),
                                    }
                                  : {}),
                              })
                            }
                            className={cn(
                              "h-8 rounded-lg border px-3 text-sm transition-colors",
                              form.budget.startMode === mode
                                ? "border-brand bg-brand-subtle text-brand font-medium"
                                : "hover:bg-muted",
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {form.budget.startMode === "later" ? (
                      <Field
                        id="start"
                        label="Start date and time (your local time)"
                        error={e["budget.firstRoundStartsAt"]}
                        hint={
                          start ? `${localAndUtc(start)} · starts ${fromNow(start)}` : undefined
                        }
                      >
                        <Input
                          id="start"
                          type="datetime-local"
                          value={form.budget.firstRoundStartsAt}
                          onChange={(ev) =>
                            update("budget", { firstRoundStartsAt: ev.target.value })
                          }
                        />
                      </Field>
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        Round 1 opens as soon as you create the program. Contributors can submit
                        once the join page is published.
                      </p>
                    )}
                    <Field
                      id="len"
                      label="Round length"
                      error={e["budget.roundLengthDays"]}
                      hint={
                        start && end
                          ? `Round 1: ${localAndUtc(start).split(" · ")[0]} to ${localAndUtc(end).split(" · ")[0]}. Approved work is paid when each round closes.`
                          : "Approved work is paid when each round closes."
                      }
                    >
                      <div className="max-w-48">
                        <UnitInput
                          id="len"
                          unit="days"
                          placeholder="7"
                          value={form.budget.roundLengthDays}
                          onChange={(v) => update("budget", { roundLengthDays: v })}
                        />
                      </div>
                    </Field>
                  </section>

                  <section
                    className="bg-card shadow-soft grid gap-4 rounded-[1.25rem] p-5 sm:p-6"
                    aria-labelledby="pay-h"
                  >
                    <h2 id="pay-h" className="text-base font-medium">
                      Pay
                    </h2>
                    <Field
                      id="rate"
                      label="Rate per point"
                      error={e["budget.ratePerPoint"]}
                      hint={
                        <>
                          {form.rubric.categories.map((c, i) => (
                            <span key={i} className="block">
                              A perfect {itemNoun(c.name)} (10/10) earns{" "}
                              <span className="mono-num text-foreground">
                                {eff.perfect[i] !== null && eff.perfect[i] !== undefined
                                  ? formatUsdc(eff.perfect[i]!)
                                  : "—"}
                              </span>
                              .
                            </span>
                          ))}
                        </>
                      }
                    >
                      <div className="max-w-48">
                        <UnitInput
                          id="rate"
                          unit="USDC"
                          placeholder="0.50"
                          value={form.budget.ratePerPoint}
                          onChange={(v) => update("budget", { ratePerPoint: v })}
                          invalid={!!e["budget.ratePerPoint"]}
                        />
                      </div>
                    </Field>
                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                      <Field
                        id="autoitem"
                        label="Largest item paid without your review"
                        hint={LIMIT_HELP.maxAutoApproveItem}
                        warning={warn("maxAutoApproveItem")}
                        error={e["budget.maxAutoApproveItem"]}
                      >
                        <UnitInput
                          id="autoitem"
                          unit="USDC"
                          value={eff.maxAutoApproveItem}
                          onChange={(v) => editLimit({ maxAutoApproveItem: v })}
                        />
                      </Field>
                      <Field
                        id="conf"
                        label="Minimum agent confidence"
                        hint={LIMIT_HELP.autoApproveConfidence}
                        error={e["budget.autoApproveConfidence"]}
                      >
                        <UnitInput
                          id="conf"
                          unit="0.5–1"
                          placeholder="0.8"
                          value={form.budget.autoApproveConfidence}
                          onChange={(v) => update("budget", { autoApproveConfidence: v })}
                        />
                      </Field>
                      <Field
                        id="age"
                        label="Minimum X account age"
                        hint="Younger accounts are sent to your review."
                        error={e["budget.minAccountAgeDays"]}
                      >
                        <UnitInput
                          id="age"
                          unit="days"
                          placeholder="30"
                          value={form.budget.minAccountAgeDays}
                          onChange={(v) => update("budget", { minAccountAgeDays: v })}
                        />
                      </Field>
                    </div>
                  </section>

                  <section
                    className="bg-card shadow-soft grid gap-4 rounded-[1.25rem] p-5 sm:p-6"
                    aria-labelledby="limits-h"
                  >
                    <div>
                      <h2 id="limits-h" className="text-base font-medium">
                        Vault limits
                      </h2>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Enforced by the vault contract; the agent can&apos;t exceed them.{" "}
                        {form.limitsEdited
                          ? "You've edited these."
                          : "Suggested from your rubric, and they follow it until you edit one."}
                      </p>
                    </div>
                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                      {(
                        [
                          ["perpayout", "maxPerPayout", "Max per contributor per round"],
                          ["perround", "maxPerRound", "Max per round"],
                          ["perday", "maxPerDay", "Max per rolling 24 hours"],
                          ["threshold", "autoApproveThreshold", "Your approval needed above"],
                        ] as const
                      ).map(([id, key, label]) => (
                        <Field
                          key={id}
                          id={id}
                          label={label}
                          hint={LIMIT_HELP[key]}
                          warning={warn(key)}
                          error={e[`limits.${key}`]}
                        >
                          <UnitInput
                            id={id}
                            unit="USDC"
                            value={eff.limits[key]}
                            onChange={(v) => editLimit({ [key]: v })}
                            invalid={!!e[`limits.${key}`]}
                          />
                        </Field>
                      ))}
                      <Field
                        id="cooldown"
                        label="New wallet cooldown"
                        hint={LIMIT_HELP.payeeCooldownHours}
                        error={e["limits.payeeCooldownHours"]}
                      >
                        <UnitInput
                          id="cooldown"
                          unit="hours"
                          placeholder="24"
                          value={form.limits.payeeCooldownHours}
                          onChange={(v) =>
                            setForm((f) => ({
                              ...f,
                              limits: { ...f.limits, payeeCooldownHours: v },
                            }))
                          }
                        />
                      </Field>
                    </div>
                    <CooldownWarning hours={form.limits.payeeCooldownHours} />
                  </section>
                </>
              ) : null}

              {step === 3 ? (
                <div className="grid gap-4">
                  <ReviewBlock title="Program" onEdit={() => goTo(0)}>
                    <p className="font-medium">{form.basics.name}</p>
                    <p className="text-muted-foreground mt-0.5 font-mono text-xs">
                      {APP_HOST}/join/{form.basics.slug}
                    </p>
                  </ReviewBlock>
                  <ReviewBlock title="Pays for" onEdit={() => goTo(1)}>
                    <ul className="grid gap-1.5">
                      {form.rubric.categories.map((c, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-4">
                          <span className="min-w-0 truncate">{c.name || `Category ${i + 1}`}</span>
                          <span className="text-muted-foreground shrink-0 text-xs">
                            a perfect one earns{" "}
                            <span className="mono-num text-foreground text-sm">
                              {eff.perfect[i] ? formatUsdc(eff.perfect[i]!) : "—"}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </ReviewBlock>
                  <ReviewBlock title="Round 1" onEdit={() => goTo(2)}>
                    <p>
                      {form.budget.startMode === "now"
                        ? "Starts when you create the program"
                        : start
                          ? localAndUtc(start)
                          : "—"}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      Every {form.budget.roundLengthDays} days after that
                    </p>
                  </ReviewBlock>
                  <ReviewBlock title="Without your review" onEdit={() => goTo(2)}>
                    <p>
                      Items up to {eff.maxAutoApproveItem} USDC with confidence ≥{" "}
                      {form.budget.autoApproveConfidence}
                    </p>
                  </ReviewBlock>
                  <ReviewBlock title="Vault limits" onEdit={() => goTo(2)}>
                    <ul className="grid gap-0.5">
                      <li>{eff.limits.maxPerPayout} USDC per contributor per round</li>
                      <li>
                        {eff.limits.maxPerRound} USDC per round · {eff.limits.maxPerDay} USDC per 24
                        hours
                      </li>
                      <li>Your approval for rounds above {eff.limits.autoApproveThreshold} USDC</li>
                      <li>
                        {form.limits.payeeCooldownHours} h before a new payout wallet can be paid
                      </li>
                    </ul>
                  </ReviewBlock>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Nothing is published or spent yet. The program is saved as a draft; next, a
                    short guided setup deploys and funds its vault, then you publish the join page.
                  </p>
                </div>
              ) : null}
            </div>

            {formError ? (
              <p role="alert" className="text-danger mt-6 text-sm">
                {formError}
              </p>
            ) : null}

            <div
              data-sticky-actions
              className="bg-background/90 supports-[backdrop-filter]:bg-background/75 sticky bottom-0 z-20 -mx-4 mt-10 flex items-center justify-between gap-2 border-t px-4 py-4 supports-[backdrop-filter]:backdrop-blur-md sm:mx-0 sm:px-0"
            >
              {step > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => goTo(step - 1)}
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  Back
                </Button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
                  <SheetTrigger asChild>
                    <Button type="button" variant="outline" className="lg:hidden">
                      <Eye className="size-4" aria-hidden="true" />
                      Preview
                    </Button>
                  </SheetTrigger>
                  <SheetContent
                    side="bottom"
                    className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-5"
                  >
                    <SheetTitle className="sr-only">Join page preview</SheetTitle>
                    <PreviewContent
                      form={form}
                      perfect={eff.perfect}
                      step={step}
                      limits={eff.limits}
                    />
                  </SheetContent>
                </Sheet>
                {step < STEPS.length - 1 ? (
                  <Button type="button" onClick={next}>
                    Continue
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                ) : (
                  <Button type="button" onClick={submit} disabled={pending}>
                    {pending ? "Creating…" : "Create program"}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <aside className="hidden lg:block" aria-label="Preview">
            <div className="sticky top-24 pb-8">
              <PreviewContent form={form} perfect={eff.perfect} step={step} limits={eff.limits} />
            </div>
          </aside>
        </div>
      </FocusMain>
    </>
  );
}

/** One section of the review step, with a jump back to the step that sets it. */
function ReviewBlock({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section className="bg-card shadow-soft grid gap-2 rounded-[1.25rem] p-5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {title}
        </h2>
        <button
          type="button"
          onClick={onEdit}
          className="text-muted-foreground hover:text-foreground rounded-sm text-xs underline-offset-4 hover:underline"
          aria-label={`Edit ${title.toLowerCase()}`}
        >
          Edit
        </button>
      </div>
      <div className="leading-relaxed">{children}</div>
    </section>
  );
}

/** "Step 2 of 4" on phones; the four steps (done ones clickable) from 768px. */
function WizardProgress({ step, onGo }: { step: number; onGo: (s: number) => void }) {
  return (
    <>
      <div className="flex w-full max-w-40 flex-col gap-1.5 md:hidden">
        <span className="text-muted-foreground text-center text-xs">
          Step {step + 1} of {STEPS.length}
        </span>
        <span className="bg-muted h-1 overflow-hidden rounded-full" aria-hidden="true">
          <span
            className="bg-brand block h-full rounded-full transition-[width] duration-500"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </span>
      </div>
      <ol className="hidden items-center gap-2 text-sm md:flex" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            className="flex items-center gap-2"
          >
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={cn("h-px w-6 lg:w-10", i <= step ? "bg-brand" : "bg-border")}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[11px] font-medium tabular-nums transition-colors",
                i < step && "bg-brand text-primary-foreground",
                i === step && "ring-brand text-brand bg-card ring-2",
                i > step && "bg-muted text-muted-foreground",
              )}
            >
              {i < step ? <Check className="size-3.5" strokeWidth={2.5} /> : i + 1}
            </span>
            {i < step ? (
              <button
                type="button"
                className="text-soft hover:text-foreground rounded-sm"
                onClick={() => onGo(i)}
              >
                {label}
              </button>
            ) : (
              <span
                className={cn(i === step ? "text-foreground font-medium" : "text-muted-foreground")}
              >
                {label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

function ScoringExplainer({ rate }: { rate: bigint | null }) {
  return (
    <div className="bg-brand-subtle/60 rounded-[1.25rem] p-5 text-sm">
      <p className="font-medium">How a score becomes USDC</p>
      <ol className="text-soft mt-2 grid list-decimal gap-1 pl-5">
        <li>The agent scores each criterion from 0 to 10.</li>
        <li>The category&apos;s points are the average score ÷ 10 × its max points.</li>
        <li>
          Payout = points × the rate per point
          {rate !== null ? ` (${formatUsdc(rate)}, set in the next step)` : ""}, within your vault
          limits.
        </li>
      </ol>
    </div>
  );
}

/**
 * What contributors will see, updating as the owner types: the join page in a browser frame, then what matters for
 * the current step (payout math, the vault's limits, what happens after creating it). Sticky beside the form from
 * 1024px; in a bottom sheet behind "Preview" below that.
 */
function PreviewContent({
  form,
  perfect,
  step,
  limits,
}: {
  form: Form;
  perfect: (bigint | null)[];
  step: number;
  limits: Limits;
}) {
  const amount = (i: number) =>
    perfect[i] !== null && perfect[i] !== undefined ? formatUsdc(perfect[i]!) : "—";
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <span className="relative flex size-2" aria-hidden="true">
          <span className="bg-brand/40 absolute inset-0 animate-ping rounded-full [animation-duration:2.4s]" />
          <span className="bg-brand relative size-2 rounded-full" />
        </span>
        Live preview of your join page
      </p>
      <div className="bg-card shadow-lift overflow-hidden rounded-[1.25rem]">
        <div className="bg-muted/60 flex items-center gap-3 border-b px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="bg-border size-2.5 rounded-full" />
            <span className="bg-border size-2.5 rounded-full" />
            <span className="bg-border size-2.5 rounded-full" />
          </span>
          <span className="bg-background text-muted-foreground min-w-0 flex-1 truncate rounded-md px-2.5 py-1 font-mono text-[11px]">
            {APP_HOST}/join/{form.basics.slug || "your-program"}
          </span>
        </div>
        <div className="p-5 sm:p-6">
          <p className="text-muted-foreground text-xs">Contributor program</p>
          <p className="display mt-1 text-[1.75rem] leading-tight [overflow-wrap:anywhere]">
            {form.basics.name || "Your program"}
          </p>
          <p className="text-soft mt-2 line-clamp-4 text-sm leading-relaxed">
            {form.basics.description || "Your description appears here."}
          </p>
          <p className="text-muted-foreground mt-5 text-xs font-medium">Pays for</p>
          <ul className="mt-2 grid gap-2">
            {form.rubric.categories.map((c, i) => (
              <li
                key={i}
                className="bg-background/60 flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {c.name || `Category ${i + 1}`}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {c.sourceTypes.map((t) => SOURCE_LABELS[t]).join(", ") || "No sources yet"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="text-muted-foreground block text-[10px]">up to</span>
                  <span className="mono-num text-sm font-medium">{amount(i)}</span>
                </span>
              </li>
            ))}
          </ul>
          <span className="bg-primary text-primary-foreground mt-5 flex h-9 items-center justify-center rounded-lg text-sm font-medium">
            Sign in with X to join
          </span>
        </div>
      </div>

      {step === 2 ? (
        <div className="bg-card shadow-soft relative overflow-hidden rounded-[1.25rem] p-5 text-sm">
          <VaultArt className="pointer-events-none absolute top-4 right-4 size-16" />
          <p className="font-medium">Your vault enforces</p>
          <dl className="mt-3 grid gap-1.5 pr-0 sm:pr-20">
            {(
              [
                ["Per contributor per round", limits.maxPerPayout],
                ["Per round", limits.maxPerRound],
                ["Per 24 hours", limits.maxPerDay],
                ["Your approval above", limits.autoApproveThreshold],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-soft">{label}</dt>
                <dd className="mono-num">{v ? `${v} USDC` : "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
            Whatever the agent decides, the contract won&apos;t pay past these.
          </p>
        </div>
      ) : step === 3 ? (
        <div className="bg-card shadow-soft rounded-[1.25rem] p-5 text-sm">
          <p className="font-medium">After you create it</p>
          <ol className="text-soft mt-3 grid gap-2">
            {[
              "Deploy the program's vault (one transaction)",
              "Fund it with test USDC",
              "Publish the join page and share the link",
            ].map((t, i) => (
              <li key={t} className="flex gap-2.5">
                <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums">
                  {i + 1}
                </span>
                {t}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="bg-card shadow-soft rounded-[1.25rem] p-5 text-sm">
          <p className="font-medium">What a perfect submission earns</p>
          <ul className="mt-3 grid gap-1.5">
            {form.rubric.categories.map((c, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-soft truncate">{c.name || `Category ${i + 1}`}</span>
                <span className="mono-num">{amount(i)}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
            Max points × rate per point. Most work scores below 10/10 and earns proportionally less.
          </p>
        </div>
      )}
    </div>
  );
}
