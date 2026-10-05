"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ContextEditor, contextPayload, type ContextDraft } from "./context-editor";

/** Settings → Context for the agent. Saving creates a new version; past decisions keep the one they used. */
export function ContextSettings(p: {
  programId: string;
  initial: ContextDraft;
  version: number | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ContextDraft>(p.initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed =
    JSON.stringify(contextPayload(draft)) !== JSON.stringify(contextPayload(p.initial));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/owner/programs/${p.programId}/context`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contextPayload(draft)),
      });
      const out = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        version?: number;
        error?: string;
      };
      if (!res.ok || !out.ok) return setError(out.error ?? "Couldn't save the context.");
      toast.success(`Saved as version ${out.version}. New submissions use it.`);
      router.refresh();
    } catch {
      setError("Couldn't reach Misthos. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <ContextEditor
        idPrefix="settings-ctx"
        value={draft}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      />
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={busy || !changed} onClick={save}>
          {busy ? "Saving…" : p.version ? "Save as a new version" : "Save context"}
        </Button>
        <span className="text-muted-foreground text-xs">
          {p.version
            ? `Version ${p.version} is in use. Earlier decisions keep the version they were judged with.`
            : "Until you save, the agent reviews with the rubric only."}
        </span>
      </div>
    </div>
  );
}
