"use client";

import {
  BudgetInput,
  formatUsdc,
  LimitsInput,
  parseUsdc,
  ProgramBasics,
  Rubric,
  SOURCE_TYPES,
  type SourceType,
} from "@misthos/shared";
import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createProgramAction } from "../actions";

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
type Form = {
  basics: { name: string; slug: string; description: string; logoUrl: string };
  rubric: { categories: Category[]; generalRules: string };
  budget: {
    ratePerPoint: string;
    roundLengthDays: string;
    firstRoundStartsAt: string;
    autoApproveConfidence: string;
    maxAutoApproveItem: string;
    minAccountAgeDays: string;
  };
  limits: {
    maxPerPayout: string;
    maxPerRound: string;
    maxPerDay: string;
    autoApproveThreshold: string;
    payeeCooldownHours: string;
  };
};

const SOURCE_LABELS: Record<SourceType, string> = {
  x_post: "X posts",
  github_pr: "GitHub PRs",
  article: "Articles",
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

function defaultStart(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

const initialForm = (): Form => ({
  basics: { name: "", slug: "", description: "", logoUrl: "" },
  rubric: { categories: STARTER_CATEGORIES, generalRules: "" },
  budget: {
    ratePerPoint: "2",
    roundLengthDays: "14",
    firstRoundStartsAt: defaultStart(),
    autoApproveConfidence: "0.8",
    maxAutoApproveItem: "20",
    minAccountAgeDays: "30",
  },
  limits: {
    maxPerPayout: "50",
    maxPerRound: "1000",
    maxPerDay: "2000",
    autoApproveThreshold: "250",
    payeeCooldownHours: "24",
  },
});

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

/** Convert typed strings into the shape the shared zod schemas expect. */
function toPayload(f: Form) {
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
      ...f.budget,
      firstRoundStartsAt: Number.isNaN(Date.parse(f.budget.firstRoundStartsAt))
        ? ""
        : new Date(f.budget.firstRoundStartsAt).toISOString(),
    },
    limits: f.limits,
  };
}

function issues(schema: z.ZodType, value: unknown, prefix: string): Record<string, string> {
  const r = schema.safeParse(value);
  const out: Record<string, string> = {};
  if (!r.success) for (const i of r.error.issues) out[[prefix, ...i.path].join(".")] ??= i.message;
  return out;
}

const STEPS = ["Basics", "Rubric", "Budget and limits", "Review"] as const;

// ─── Small field helpers ────────────────────────────────────────────────────

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-danger text-xs">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

function UsdcField(props: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field id={props.id} label={props.label} hint={props.hint} error={props.error}>
      <div className="relative">
        <Input
          id={props.id}
          inputMode="decimal"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          aria-invalid={!!props.error}
          className="pr-14 font-mono tabular-nums"
        />
        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">
          USDC
        </span>
      </div>
    </Field>
  );
}

// ─── Wizard ─────────────────────────────────────────────────────────────────

export function ProgramWizard() {
  const [form, setForm] = useState<Form>(initialForm);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [pending, startTransition] = useTransition();

  const payload = toPayload(form);
  const update = <K extends keyof Form>(section: K, patch: Partial<Form[K]>) =>
    setForm((f) => ({ ...f, [section]: { ...f[section], ...patch } }));
  const updateCategory = (i: number, patch: Partial<Category>) =>
    setForm((f) => ({
      ...f,
      rubric: {
        ...f.rubric,
        categories: f.rubric.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)),
      },
    }));

  function validate(s: number): Record<string, string> {
    if (s === 0) return issues(ProgramBasics, payload.basics, "basics");
    if (s === 1) return issues(Rubric, payload.rubric, "rubric");
    if (s === 2)
      return {
        ...issues(BudgetInput, payload.budget, "budget"),
        ...issues(LimitsInput, payload.limits, "limits"),
      };
    return {};
  }

  function next() {
    const e = validate(step);
    setErrors(e);
    if (Object.keys(e).length === 0) setStep((s) => s + 1);
  }

  function submit() {
    setFormError(null);
    startTransition(async () => {
      const res = await createProgramAction(payload);
      // On success the action redirects; anything returned is an error.
      if (res?.fieldErrors) {
        setErrors(res.fieldErrors);
        const keys = Object.keys(res.fieldErrors);
        const first = ["basics", "rubric", "budget"].findIndex((p) =>
          keys.some((k) => k.startsWith(p) || (p === "budget" && k.startsWith("limits"))),
        );
        if (first >= 0) setStep(first);
      }
      if (res?.error) setFormError(res.error);
    });
  }

  const e = errors;
  const rate = (() => {
    try {
      return parseUsdc(form.budget.ratePerPoint);
    } catch {
      return null;
    }
  })();

  return (
    <div className="mt-8">
      <ol className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-2",
              i === step ? "text-foreground font-medium" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full border text-[11px] tabular-nums",
                i < step && "bg-brand border-brand text-white",
                i === step && "border-foreground",
              )}
            >
              {i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>

      <div className="mt-8 grid gap-6">
        {step === 0 ? (
          <>
            <Field id="name" label="Program name" error={e["basics.name"]}>
              <Input
                id="name"
                value={form.basics.name}
                onChange={(ev) => {
                  const name = ev.target.value;
                  update("basics", slugTouched ? { name } : { name, slug: toSlug(name) });
                }}
                aria-invalid={!!e["basics.name"]}
              />
            </Field>
            <Field
              id="slug"
              label="URL name"
              hint={`Contributors join at /join/${form.basics.slug || "your-program"}`}
              error={e["basics.slug"]}
            >
              <Input
                id="slug"
                value={form.basics.slug}
                onChange={(ev) => {
                  setSlugTouched(true);
                  update("basics", { slug: ev.target.value });
                }}
                className="font-mono"
                aria-invalid={!!e["basics.slug"]}
              />
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
                value={form.basics.description}
                onChange={(ev) => update("basics", { description: ev.target.value })}
                aria-invalid={!!e["basics.description"]}
              />
            </Field>
            <Field
              id="logo"
              label="Logo URL (optional)"
              hint="An https image URL."
              error={e["basics.logoUrl"]}
            >
              <Input
                id="logo"
                type="url"
                value={form.basics.logoUrl}
                onChange={(ev) => update("basics", { logoUrl: ev.target.value })}
                aria-invalid={!!e["basics.logoUrl"]}
              />
            </Field>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <p className="text-muted-foreground text-sm">
              Each category says what kind of work counts, how it&apos;s scored, and the most it can
              earn. The agent scores every criterion from 0 to 10 and explains why.
            </p>
            {form.rubric.categories.map((c, i) => (
              <fieldset key={i} className="grid gap-4 rounded-lg border p-4">
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
                <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                  <Field
                    id={`c${i}-name`}
                    label="Name"
                    error={e[`rubric.categories.${i}.name`] ?? e[`rubric.categories.${i}.key`]}
                  >
                    <Input
                      id={`c${i}-name`}
                      value={c.name}
                      onChange={(ev) => updateCategory(i, { name: ev.target.value })}
                    />
                  </Field>
                  <Field
                    id={`c${i}-max`}
                    label="Max points"
                    error={e[`rubric.categories.${i}.maxPoints`]}
                  >
                    <Input
                      id={`c${i}-max`}
                      inputMode="numeric"
                      className="font-mono tabular-nums"
                      value={c.maxPoints}
                      onChange={(ev) => updateCategory(i, { maxPoints: ev.target.value })}
                    />
                  </Field>
                </div>
                <Field
                  id={`c${i}-desc`}
                  label="What counts"
                  error={e[`rubric.categories.${i}.description`]}
                >
                  <Textarea
                    id={`c${i}-desc`}
                    rows={2}
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
                      onChange={(ev) => updateCategory(i, { requireMerged: ev.target.checked })}
                    />
                    Only pay merged pull requests
                  </label>
                ) : null}
                <div className="grid gap-2">
                  <span className="text-sm font-medium">Scoring criteria</span>
                  {c.criteria.map((k, j) => (
                    <div key={j} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                      <Input
                        aria-label={`Criterion ${j + 1} name`}
                        placeholder="Name"
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
                        placeholder="What a 10 looks like"
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
                          updateCategory(i, { criteria: c.criteria.filter((_, m) => m !== j) })
                        }
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  {Object.keys(e).some((k) => k.startsWith(`rubric.categories.${i}.criteria`)) ? (
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
                  label="Rules (plain language)"
                  error={e[`rubric.categories.${i}.rules`]}
                >
                  <Textarea
                    id={`c${i}-rules`}
                    rows={2}
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
                value={form.rubric.generalRules}
                onChange={(ev) => update("rubric", { generalRules: ev.target.value })}
              />
            </Field>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <section className="grid gap-4">
              <h2 className="text-base font-medium">Budget</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <UsdcField
                  id="rate"
                  label="Rate per point"
                  hint="Payout = points × rate, capped by the limits below."
                  error={e["budget.ratePerPoint"]}
                  value={form.budget.ratePerPoint}
                  onChange={(v) => update("budget", { ratePerPoint: v })}
                />
                <Field id="len" label="Round length (days)" error={e["budget.roundLengthDays"]}>
                  <Input
                    id="len"
                    inputMode="numeric"
                    className="font-mono tabular-nums"
                    value={form.budget.roundLengthDays}
                    onChange={(ev) => update("budget", { roundLengthDays: ev.target.value })}
                  />
                </Field>
                <Field id="start" label="First round starts" error={e["budget.firstRoundStartsAt"]}>
                  <Input
                    id="start"
                    type="datetime-local"
                    value={form.budget.firstRoundStartsAt}
                    onChange={(ev) => update("budget", { firstRoundStartsAt: ev.target.value })}
                  />
                </Field>
                <Field
                  id="age"
                  label="Minimum X account age (days)"
                  hint="Younger accounts are flagged for review."
                  error={e["budget.minAccountAgeDays"]}
                >
                  <Input
                    id="age"
                    inputMode="numeric"
                    className="font-mono tabular-nums"
                    value={form.budget.minAccountAgeDays}
                    onChange={(ev) => update("budget", { minAccountAgeDays: ev.target.value })}
                  />
                </Field>
              </div>
            </section>
            <section className="grid gap-4">
              <h2 className="text-base font-medium">Auto-approval</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="conf"
                  label="Minimum agent confidence"
                  hint="Between 0.5 and 1. Below this, items go to your review queue."
                  error={e["budget.autoApproveConfidence"]}
                >
                  <Input
                    id="conf"
                    inputMode="decimal"
                    className="font-mono tabular-nums"
                    value={form.budget.autoApproveConfidence}
                    onChange={(ev) => update("budget", { autoApproveConfidence: ev.target.value })}
                  />
                </Field>
                <UsdcField
                  id="autoitem"
                  label="Largest item paid without review"
                  error={e["budget.maxAutoApproveItem"]}
                  value={form.budget.maxAutoApproveItem}
                  onChange={(v) => update("budget", { maxAutoApproveItem: v })}
                />
              </div>
            </section>
            <section className="grid gap-4">
              <div>
                <h2 className="text-base font-medium">Vault limits</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Enforced by the vault contract. The agent cannot exceed them, whatever it decides.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <UsdcField
                  id="perpayout"
                  label="Max per contributor per round"
                  error={e["limits.maxPerPayout"]}
                  value={form.limits.maxPerPayout}
                  onChange={(v) => update("limits", { maxPerPayout: v })}
                />
                <UsdcField
                  id="perround"
                  label="Max per round"
                  error={e["limits.maxPerRound"]}
                  value={form.limits.maxPerRound}
                  onChange={(v) => update("limits", { maxPerRound: v })}
                />
                <UsdcField
                  id="perday"
                  label="Max per rolling 24 hours"
                  error={e["limits.maxPerDay"]}
                  value={form.limits.maxPerDay}
                  onChange={(v) => update("limits", { maxPerDay: v })}
                />
                <UsdcField
                  id="threshold"
                  label="Rounds above this need your approval"
                  error={e["limits.autoApproveThreshold"]}
                  value={form.limits.autoApproveThreshold}
                  onChange={(v) => update("limits", { autoApproveThreshold: v })}
                />
                <Field
                  id="cooldown"
                  label="New wallet cooldown (hours)"
                  hint="A new or changed payout wallet can't be paid until this passes."
                  error={e["limits.payeeCooldownHours"]}
                >
                  <Input
                    id="cooldown"
                    inputMode="numeric"
                    className="font-mono tabular-nums"
                    value={form.limits.payeeCooldownHours}
                    onChange={(ev) => update("limits", { payeeCooldownHours: ev.target.value })}
                  />
                </Field>
              </div>
            </section>
          </>
        ) : null}

        {step === 3 ? (
          <dl className="grid gap-x-8 gap-y-4 rounded-lg border p-5 text-sm sm:grid-cols-[200px_1fr]">
            <dt className="text-muted-foreground">Program</dt>
            <dd>
              {form.basics.name}{" "}
              <span className="text-muted-foreground font-mono">/{form.basics.slug}</span>
            </dd>
            <dt className="text-muted-foreground">Categories</dt>
            <dd className="grid gap-1">
              {form.rubric.categories.map((c, i) => (
                <div key={i}>
                  {c.name}: up to {c.maxPoints} points
                  {rate !== null ? (
                    <span className="text-muted-foreground font-mono tabular-nums">
                      {" "}
                      ({formatUsdc(rate * BigInt(Number(c.maxPoints) || 0))})
                    </span>
                  ) : null}
                </div>
              ))}
            </dd>
            <dt className="text-muted-foreground">Rounds</dt>
            <dd>
              Every {form.budget.roundLengthDays} days, starting{" "}
              {new Date(form.budget.firstRoundStartsAt).toLocaleString()}
            </dd>
            <dt className="text-muted-foreground">Vault limits</dt>
            <dd className="font-mono tabular-nums">
              {form.limits.maxPerPayout} per payout · {form.limits.maxPerRound} per round ·{" "}
              {form.limits.maxPerDay} per 24h
            </dd>
            <dt className="text-muted-foreground">Owner approval</dt>
            <dd>Rounds above {form.limits.autoApproveThreshold} USDC</dd>
            <dt className="text-muted-foreground">Next</dt>
            <dd className="text-muted-foreground">
              The program is saved as a draft. You can publish it to open the join page, then deploy
              and fund its vault before the first payout.
            </dd>
          </dl>
        ) : null}
      </div>

      {formError ? (
        <p role="alert" className="text-danger mt-6 text-sm">
          {formError}
        </p>
      ) : null}

      <div className="mt-8 flex items-center justify-between border-t pt-6">
        <Button
          type="button"
          variant="ghost"
          disabled={step === 0 || pending}
          onClick={() => setStep((s) => s - 1)}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={next}>
            Continue
          </Button>
        ) : (
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Create program"}
          </Button>
        )}
      </div>
    </div>
  );
}
