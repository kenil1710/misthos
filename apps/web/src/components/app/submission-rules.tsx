"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BELOW_MINIMUM_CHOICES, type BelowMinimum } from "@/lib/minimums";
import { cn } from "@/lib/utils";

/** Settings → Submission rules (shown to contributors on the join page). */
export function SubmissionRules(p: {
  programId: string;
  maxSubmissionsPerRound: number;
  minXFollowers: number;
  minAccountAgeDays: number;
  belowMinimum: BelowMinimum;
}) {
  const router = useRouter();
  const [max, setMax] = useState(String(p.maxSubmissionsPerRound));
  const [min, setMin] = useState(String(p.minXFollowers));
  const [age, setAge] = useState(String(p.minAccountAgeDays));
  const [policy, setPolicy] = useState<BelowMinimum>(p.belowMinimum);
  const [busy, setBusy] = useState(false);
  const maxOk = /^\d+$/.test(max) && Number(max) >= 1 && Number(max) <= 100;
  const minOk = /^\d+$/.test(min) && Number(min) <= 10_000_000;
  const ageOk = /^\d+$/.test(age) && Number(age) <= 3650;
  const anyMinimum = (minOk && Number(min) > 0) || (ageOk && Number(age) > 0);
  const changed =
    Number(max) !== p.maxSubmissionsPerRound ||
    Number(min) !== p.minXFollowers ||
    Number(age) !== p.minAccountAgeDays ||
    policy !== p.belowMinimum;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/programs/${p.programId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxSubmissionsPerRound: Number(max),
          minXFollowers: Number(min),
          minAccountAgeDays: Number(age),
          belowMinimum: policy,
        }),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (out.ok) toast.success("Submission rules saved.");
      else toast.error(out.error ?? "Couldn't save the rules.");
      router.refresh();
    } catch {
      toast.error("Couldn't reach Misthos. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="rules-max">Submissions per contributor per round</Label>
          <Input
            id="rules-max"
            inputMode="numeric"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            aria-invalid={!maxOk}
          />
          <p className="text-muted-foreground text-xs">
            1 to 100. More are refused before any review cost.
          </p>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="rules-min">Minimum X followers</Label>
          <Input
            id="rules-min"
            inputMode="numeric"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            aria-invalid={!minOk}
          />
          <p className="text-muted-foreground text-xs">0: no minimum.</p>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="rules-age">Minimum X account age (days)</Label>
          <Input
            id="rules-age"
            inputMode="numeric"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            aria-invalid={!ageOk}
          />
          <p className="text-muted-foreground text-xs">0: no minimum.</p>
        </div>
      </div>
      <fieldset className="grid gap-2" disabled={!anyMinimum}>
        <legend className="mb-2 text-sm font-medium">Accounts below these minimums</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {BELOW_MINIMUM_CHOICES.map((c) => (
            <label
              key={c.value}
              className={cn(
                "has-[:focus-visible]:ring-ring/50 flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm has-[:focus-visible]:ring-[3px]",
                policy === c.value && "border-primary bg-brand-subtle/50",
                !anyMinimum && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name="below-minimum"
                value={c.value}
                checked={policy === c.value}
                onChange={() => setPolicy(c.value)}
                className="accent-primary mt-0.5"
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground text-xs leading-relaxed">{c.detail}</span>
              </span>
            </label>
          ))}
        </div>
        {!anyMinimum ? (
          <p className="text-muted-foreground text-xs">Set a minimum above to choose.</p>
        ) : null}
      </fieldset>
      <div>
        <Button
          type="button"
          disabled={busy || !changed || !maxOk || !minOk || !ageOk}
          onClick={save}
        >
          {busy ? "Saving…" : "Save rules"}
        </Button>
      </div>
    </div>
  );
}
