"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui-kit/confirm-dialog";
import { fromNow, localAndUtc, toLocalInput } from "@/lib/when";

/**
 * Settings → Round schedule. A round that hasn't started can be moved or started now; the round length can always
 * change (a running round keeps its end; later rounds use the new length). Every change is audited server-side.
 */
export function RoundSchedule(p: {
  programId: string;
  round: { number: number; startsAt: string; endsAt: string } | null;
  roundLengthDays: number;
}) {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const starts = p.round ? new Date(p.round.startsAt) : null;
  const ends = p.round ? new Date(p.round.endsAt) : null;
  const scheduled = !!starts && starts.getTime() > now;
  const [len, setLen] = useState(String(p.roundLengthDays));
  const [start, setStart] = useState(starts && scheduled ? toLocalInput(starts) : "");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const lenNum = Number(len);
  const lenOk = Number.isInteger(lenNum) && lenNum >= 1 && lenNum <= 90;
  const startDate = start ? new Date(start) : null;
  const startChanged =
    scheduled && startDate && starts && Math.abs(startDate.getTime() - starts.getTime()) >= 60_000;
  const changed = lenNum !== p.roundLengthDays || !!startChanged;

  async function send(body: object, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/owner/programs/${p.programId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401)
        return void toast.error("Your session expired. Sign in again to continue.");
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (out.ok) toast.success(ok);
      else toast.error(out.error ?? "Couldn't change the schedule.");
      router.refresh();
    } catch {
      toast.error("Couldn't reach Misthos. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!p.round || !starts || !ends)
    return <p className="text-muted-foreground text-sm">No rounds yet.</p>;
  return (
    <div className="grid gap-5">
      <div className="bg-muted/40 rounded-lg border p-4 text-sm">
        {scheduled ? (
          <>
            <p className="font-medium">
              Round {p.round.number} is scheduled · starts {fromNow(starts, now)}
            </p>
            <p className="text-soft mt-1">{localAndUtc(starts)}</p>
          </>
        ) : (
          <>
            <p className="font-medium">
              Round {p.round.number} is open · closes {fromNow(ends, now)}
            </p>
            <p className="text-soft mt-1">Closes {localAndUtc(ends)}</p>
          </>
        )}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="sched-len">Round length</Label>
          <div className="relative max-w-48">
            <Input
              id="sched-len"
              inputMode="numeric"
              className="pr-14 tabular-nums"
              value={len}
              onChange={(e) => setLen(e.target.value)}
              aria-invalid={!lenOk}
            />
            <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs">
              days
            </span>
          </div>
          <p className={lenOk ? "text-muted-foreground text-xs" : "text-danger text-xs"}>
            {lenOk
              ? scheduled
                ? `Applies to round ${p.round.number} and every round after it.`
                : `Round ${p.round.number} keeps its end date; later rounds use the new length.`
              : "Between 1 and 90 days."}
          </p>
        </div>
        {scheduled ? (
          <div className="grid content-start gap-1.5">
            <Label htmlFor="sched-start">Starts (your local time)</Label>
            <Input
              id="sched-start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {startDate
                ? `${localAndUtc(startDate)} · ${fromNow(startDate, now)}`
                : "Pick a date and time."}
            </p>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={busy || !changed || !lenOk}
          onClick={() =>
            send(
              {
                action: "update",
                roundLengthDays: lenNum,
                ...(startChanged && startDate ? { startsAt: startDate.toISOString() } : {}),
              },
              "Round schedule updated.",
            )
          }
        >
          Save schedule
        </Button>
        {scheduled ? (
          <Button disabled={busy} onClick={() => setConfirm(true)}>
            Start round {p.round.number} now
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Start round ${p.round.number} now?`}
        description="Contributors can submit work right away. The round keeps its length."
        rows={[
          { label: "Was scheduled for", value: localAndUtc(starts) },
          { label: "Will end", value: localAndUtc(new Date(now + p.roundLengthDays * 86_400_000)) },
        ]}
        confirmLabel="Start now"
        onConfirm={() => send({ action: "start_now" }, `Round ${p.round!.number} has started.`)}
      />
    </div>
  );
}
