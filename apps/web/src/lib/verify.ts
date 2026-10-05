import { decisions, payouts, programs, submissions, type DbLike } from "@misthos/db";
import { misthosVaultAbi } from "@misthos/shared/abi";
import { canonicalize } from "@misthos/shared/canonical";
import { hashOfHashes } from "@misthos/shared/ids";
import { verifyDecisionRecord } from "@misthos/shared/signatures";
import { desc, eq, inArray } from "drizzle-orm";
import {
  keccak256,
  parseEventLogs,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";

export type StepState = "pass" | "fail" | "skip";
export interface ProofStep {
  id: "record" | "published" | "signature" | "payout" | "chain";
  label: string;
  state: StepState;
  detail: string;
  href?: string;
}
export interface Verification {
  verified: boolean;
  decisionHash: Hex | null;
  headline: string;
  steps: ProofStep[];
}

export interface VerifyDeps {
  db: DbLike;
  client: Pick<PublicClient, "verifyMessage" | "getCode">;
  getReceipt: (hash: Hex) => Promise<TransactionReceipt | null>;
  explorerTx: (hash: string) => string;
  /** The vault's agent, read on-chain (`agent()`); null if it can't be read. Pins the signer (F-09). */
  vaultAgent: (vault: Address) => Promise<Address | null>;
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/**
 * Verify a decision record end to end, the way an outside auditor would:
 *  1. re-canonicalize the pasted JSON and keccak256 it,
 *  2. confirm Misthos published a decision with that hash,
 *  3. verify the agent's signature over the hash (EOA ecrecover or ERC-1271 isValidSignature),
 *  4. confirm the payout that paid it commits to it (payout decisionHash = keccak of its items' sorted hashes),
 *  5. read the payout transaction's receipt and match the vault's PayoutExecuted event field by field.
 * Steps after a failure are skipped. A record that was never paid (e.g. rejected) verifies through step 3.
 */
export async function verifyDecision(deps: VerifyDeps, pasted: string): Promise<Verification> {
  const steps: ProofStep[] = [];
  const done = (verified: boolean, decisionHash: Hex | null, headline: string): Verification => {
    const ids: ProofStep["id"][] = ["record", "published", "signature", "payout", "chain"];
    const labels: Record<ProofStep["id"], string> = {
      record: "Record hash",
      published: "Published by Misthos",
      signature: "Agent signature",
      payout: "Included in a payout",
      chain: "Matches the on-chain payout event",
    };
    for (const id of ids)
      if (!steps.some((s) => s.id === id))
        steps.push({ id, label: labels[id], state: "skip", detail: "Not checked." });
    return { verified, decisionHash, headline, steps };
  };

  // 1. Hash
  let canonical: string;
  try {
    canonical = canonicalize(JSON.parse(pasted));
  } catch {
    steps.push({
      id: "record",
      label: "Record hash",
      state: "fail",
      detail: "That isn't valid JSON. Paste the full decision record.",
    });
    return done(false, null, "Not verified: the record couldn't be read.");
  }
  const hash = keccak256(toBytes(canonical));
  steps.push({
    id: "record",
    label: "Record hash",
    state: "pass",
    detail: `keccak256 of the canonical record (sorted keys, no whitespace) is ${hash}.`,
  });

  // 2. Published
  const [d] = await deps.db
    .select()
    .from(decisions)
    .where(eq(decisions.decisionHash, hash))
    .limit(1);
  if (!d) {
    steps.push({
      id: "published",
      label: "Published by Misthos",
      state: "fail",
      detail:
        "No decision with this hash was published. If you edited the record, even one character, the hash changes.",
    });
    return done(false, hash, "Not verified: this record doesn't match any published decision.");
  }
  const [newer] = await deps.db
    .select({ hash: decisions.decisionHash })
    .from(decisions)
    .where(eq(decisions.submissionId, d.submissionId))
    .orderBy(desc(decisions.createdAt))
    .limit(1);
  steps.push({
    id: "published",
    label: "Published by Misthos",
    state: "pass",
    detail:
      newer && newer.hash !== hash
        ? `Published on ${d.createdAt.toISOString().slice(0, 10)}, later superseded by ${short(newer.hash)}.`
        : `Published on ${d.createdAt.toISOString().slice(0, 10)}.`,
  });

  // 3. Signature, against the vault's on-chain agent rather than an address from Misthos's own database (F-09):
  // the record names its signer, the published row must agree, and that address must be the program vault's agent.
  const recordSigner = (() => {
    try {
      return String((JSON.parse(canonical) as { signer?: unknown }).signer ?? "").toLowerCase();
    } catch {
      return "";
    }
  })();
  const [prog] = await deps.db
    .select({ vault: programs.vaultAddress })
    .from(submissions)
    .innerJoin(programs, eq(programs.id, submissions.programId))
    .where(eq(submissions.id, d.submissionId))
    .limit(1);
  const onChainAgent = prog?.vault
    ? ((await deps.vaultAgent(prog.vault as Address).catch(() => null))?.toLowerCase() ?? null)
    : null;
  const pinFail =
    recordSigner !== d.signerAddress.toLowerCase()
      ? `The record says it was signed by ${recordSigner || "nobody"}, but it was published as signed by ${d.signerAddress}.`
      : prog?.vault && !onChainAgent
        ? `The vault's agent couldn't be read on Arc, so the signer can't be confirmed. Try again in a moment.`
        : onChainAgent && onChainAgent !== recordSigner
          ? `Signed by ${d.signerAddress}, but the program vault's agent on Arc is ${onChainAgent}.`
          : null;
  if (pinFail) {
    steps.push({ id: "signature", label: "Agent signature", state: "fail", detail: pinFail });
    return done(false, hash, "Not verified: the signer isn't the vault's agent.");
  }
  const sig = await verifyDecisionRecord(deps.client, {
    decisionJson: canonical,
    decisionHash: hash,
    signature: d.signature as Hex,
    signerAddress: d.signerAddress as Address,
  });
  const isContract = !!(await deps.client
    .getCode({ address: d.signerAddress as Address })
    .catch(() => undefined));
  if (!sig.ok) {
    steps.push({
      id: "signature",
      label: "Agent signature",
      state: "fail",
      detail: `The signature doesn't verify for ${d.signerAddress}.`,
    });
    return done(false, hash, "Not verified: the agent's signature doesn't match.");
  }
  steps.push({
    id: "signature",
    label: "Agent signature",
    state: "pass",
    detail: `Signed by the agent ${isContract ? "smart-contract wallet" : "key"} ${d.signerAddress}, verified with ${isContract ? "ERC-1271 isValidSignature on Arc" : "ECDSA recovery"}${onChainAgent ? `; it is the vault's agent on Arc (read from the vault's agent()).` : "; the program has no vault yet, so the signer isn't pinned to one."}`,
  });

  // 4. Payout
  const [sub] = await deps.db
    .select()
    .from(submissions)
    .where(eq(submissions.id, d.submissionId))
    .limit(1);
  const [p] = sub?.payoutId
    ? await deps.db.select().from(payouts).where(eq(payouts.id, sub.payoutId)).limit(1)
    : [];
  if (!p || p.status !== "executed" || !p.txHash) {
    const why =
      d.action === "reject"
        ? "This decision rejected the submission, so nothing was paid."
        : "This submission hasn't been paid yet.";
    steps.push({ id: "payout", label: "Included in a payout", state: "skip", detail: why });
    steps.push({
      id: "chain",
      label: "Matches the on-chain payout event",
      state: "skip",
      detail: "No payout transaction to check.",
    });
    return {
      verified: true,
      decisionHash: hash,
      headline: "Verified: published and signed by the agent. No payout to match on-chain.",
      steps,
    };
  }
  const items = await deps.db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.payoutId, p.id));
  const itemDecisions = await deps.db
    .select({
      submissionId: decisions.submissionId,
      hash: decisions.decisionHash,
      createdAt: decisions.createdAt,
    })
    .from(decisions)
    .where(
      inArray(
        decisions.submissionId,
        items.map((i) => i.id),
      ),
    )
    .orderBy(desc(decisions.createdAt));
  const latest = new Map<string, Hex>();
  for (const x of itemDecisions)
    if (!latest.has(x.submissionId) && x.createdAt <= p.updatedAt)
      latest.set(x.submissionId, x.hash as Hex);
  const recomputed = hashOfHashes([...latest.values()]);
  if (recomputed !== p.decisionHash || ![...latest.values()].includes(hash)) {
    steps.push({
      id: "payout",
      label: "Included in a payout",
      state: "fail",
      detail: `The payout's committed hash ${short(p.decisionHash)} doesn't include this record.`,
    });
    return done(false, hash, "Not verified: the payout doesn't commit to this record.");
  }
  steps.push({
    id: "payout",
    label: "Included in a payout",
    state: "pass",
    detail: `Payout ${short(p.payoutIdBytes32)} commits to keccak256 of its ${latest.size} decision hash${latest.size === 1 ? "" : "es"} (sorted): ${short(recomputed)}.`,
  });

  // 5. Chain
  const [program] = await deps.db
    .select({ vault: programs.vaultAddress })
    .from(programs)
    .where(eq(programs.id, sub!.programId))
    .limit(1);
  const receipt = await deps.getReceipt(p.txHash as Hex);
  const events = receipt
    ? parseEventLogs({
        abi: misthosVaultAbi,
        logs: receipt.logs,
        eventName: "PayoutExecuted",
      }).filter(
        (l) =>
          l.address.toLowerCase() === program?.vault?.toLowerCase() &&
          l.args.payoutId === p.payoutIdBytes32,
      )
    : [];
  const ev = events[0];
  const matches =
    !!ev &&
    ev.args.decisionHash === recomputed &&
    ev.args.amount === p.amount &&
    ev.args.to.toLowerCase() === p.toAddress.toLowerCase();
  steps.push({
    id: "chain",
    label: "Matches the on-chain payout event",
    state: matches ? "pass" : "fail",
    detail: matches
      ? `PayoutExecuted in block ${receipt!.blockNumber} paid ${p.toAddress} with decisionHash ${short(recomputed)}, from vault ${program!.vault}.`
      : ev
        ? "The on-chain event's decision hash, amount or recipient differs from Misthos's records."
        : "The payout transaction has no matching PayoutExecuted event from this program's vault.",
    href: deps.explorerTx(p.txHash),
  });
  return matches
    ? {
        verified: true,
        decisionHash: hash,
        headline:
          "Verified: this decision was signed by the agent and paid on-chain exactly as recorded.",
        steps,
      }
    : done(false, hash, "Not verified: the on-chain payout doesn't match.");
}
