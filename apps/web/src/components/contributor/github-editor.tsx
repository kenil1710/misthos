"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Set or change the GitHub username matched against pull request and commit authors. */
export function GithubEditor({
  programSlug,
  current,
}: {
  programSlug: string;
  current: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!editing)
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {current ?? <span className="text-muted-foreground">Not set</span>}
        <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
          {current ? "Change" : "Add"}
        </Button>
      </span>
    );
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contributor/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programSlug, githubLogin: value.trim() }),
      });
      if (res.status === 401) return setError("Your session expired. Sign in with X again.");
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok)
        return setError(
          body.error === "invalid_github"
            ? "That isn't a valid GitHub username."
            : "Couldn't save. Try again.",
        );
      toast.success(
        value.trim() ? `GitHub username set to ${value.trim()}` : "GitHub username removed",
      );
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid max-w-xs gap-1.5">
      <Label htmlFor="gh" className="sr-only">
        GitHub username
      </Label>
      <div className="flex gap-2">
        <Input
          id="gh"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="octocat"
          autoComplete="off"
        />
        <Button size="default" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className={error ? "text-danger text-xs" : "text-muted-foreground text-xs"}>
        {error ?? "Pull requests and commits are matched to this username."}
      </p>
    </div>
  );
}
