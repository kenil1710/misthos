"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Settings → Submission rules (shown to contributors on the join page). */
export function SubmissionRules(p: {
  programId: string;
  maxSubmissionsPerRound: number;
  minXFollowers: number;
}) {
  const router = useRouter();
  const [max, setMax] = useState(String(p.maxSubmissionsPerRound));
  const [min, setMin] = useState(String(p.minXFollowers));
  const [busy, setBusy] = useState(false);
  const maxOk = /^\d+$/.test(max) && Number(max) >= 1 && Number(max) <= 100;
  const minOk = /^\d+$/.test(min) && Number(min) <= 10_000_000;
  const changed = Number(max) !== p.maxSubmissionsPerRound || Number(min) !== p.minXFollowers;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/programs/${p.programId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxSubmissionsPerRound: Number(max), minXFollowers: Number(min) }),
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
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
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
        <div className="grid gap-1.5">
          <Label htmlFor="rules-min">Minimum X followers</Label>
          <Input
            id="rules-min"
            inputMode="numeric"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            aria-invalid={!minOk}
          />
          <p className="text-muted-foreground text-xs">
            Smaller accounts go to your review. 0: no minimum.
          </p>
        </div>
      </div>
      <div>
        <Button type="button" disabled={busy || !changed || !maxOk || !minOk} onClick={save}>
          {busy ? "Saving…" : "Save rules"}
        </Button>
      </div>
    </div>
  );
}
