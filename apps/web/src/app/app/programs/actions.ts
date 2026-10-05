"use server";

import { getDb } from "@misthos/db";
import { ProgramInput } from "@misthos/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { chainConfig } from "@/lib/server/chain";
import { createProgram, setProgramStatus } from "@/lib/server/programs";
import { getOwnerSession } from "@/lib/server/session";

export type CreateProgramState = { error?: string; fieldErrors?: Record<string, string> };

export async function createProgramAction(raw: unknown): Promise<CreateProgramState> {
  const session = await getOwnerSession();
  if (!session) return { error: "Your session expired. Sign in again." };

  const parsed = ProgramInput.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { error: "Some fields need attention.", fieldErrors };
  }

  const result = await createProgram(getDb(), {
    ownerUserId: session.sub,
    chain: chainConfig().key,
    input: parsed.data,
  });
  if (!result.ok)
    return {
      error: "That join link is taken. Pick another.",
      fieldErrors: { "basics.slug": "Already taken" },
    };
  // The sidebar's program switcher lives in the /app layout: refresh it so the new draft shows up right away.
  revalidatePath("/app", "layout");
  redirect(`/app/programs/${result.programId}/ready`);
}

export async function setProgramStatusAction(programId: string, status: "active" | "paused") {
  const session = await getOwnerSession();
  if (!session) return { ok: false as const };
  const id = z.uuid().safeParse(programId);
  // Server actions take untrusted input: the TypeScript type isn't a check.
  const next = z.enum(["active", "paused"]).safeParse(status);
  if (!id.success || !next.success) return { ok: false as const };
  const ok = await setProgramStatus(getDb(), {
    programId: id.data,
    userId: session.sub,
    status: next.data,
  });
  revalidatePath("/app", "layout");
  return { ok };
}
