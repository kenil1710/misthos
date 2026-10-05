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
  /** On-chain reads that pin the signer to a genuine vault's agent (F-09, N-8). */
  chain: {
    /** The vault's `agent()` at a block (historical read); null if it can't be read. */
    agentAt: (vault: Address, block: bigint) => Promise<Address | null>;
    /** Was this vault created by the Misthos factory? (Its address must be the factory's CREATE2 prediction.) */
    isFactoryVault: (vault: Address) => Promise<boolean>;
    /** The first block at or after this time; null if it can't be found. */
    blockAt: (time: Date) => Promise<bigint | null>;
  };
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

  // 3. Signature. The record names its signer and the published row must agree; the signature must verify for it.
  // Which address is allowed to sign is decided on-chain (N-8): the agent of a vault our factory created, read at the
  // block of the payout (or of the decision, if it wasn't paid), so records keep verifying after an agent rotation.
  const parsed = (() => {
    try {
      return JSON.parse(canonical) as { signer?: unknown; decidedAt?: unknown };
    } catch {
      return {};
    }
  })();
  const recordSigner = String(parsed.signer ?? "").toLowerCase();
  if (recordSigner !== d.signerAddress.toLowerCase()) {
    steps.push({
      id: "signature",
      label: "Agent signature",
      state: "fail",
      detail: `The record says it was signed by ${recordSigner || "nobody"}, but it was published as signed by ${d.signerAddress}.`,
    });
    return done(false, hash, "Not verified: the signer doesn't match the record.");
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
  const sigStep: ProofStep = {
    id: "signature",
    label: "Agent signature",
    state: "pass",
    detail: `Signed by the agent ${isContract ? "smart-contract wallet" : "key"} ${d.signerAddress}, verified with ${isContract ? "ERC-1271 isValidSignature on Arc" : "ECDSA recovery"}`,
  };
  steps.push(sigStep);
  /** Pin the signer to the agent of a factory vault at a block. Returns a failure message, or null. */
  const pin = async (vault: Address, block: bigint | null, when: string) => {
    if (!(await deps.chain.isFactoryVault(vault).catch(() => false)))
      return `The vault ${vault} wasn't created by the Misthos vault factory, so its agent proves nothing.`;
    const agent = block === null ? null : await deps.chain.agentAt(vault, block).catch(() => null);
    if (!agent)
      return "The vault's agent couldn't be read on Arc, so the signer can't be confirmed. Try again in a moment.";
    if (agent.toLowerCase() !== recordSigner)
      return `Signed by ${d.signerAddress}, but ${when} (block ${block}) the vault's agent was ${agent}.`;
    sigStep.detail += `; it was the agent of vault ${vault} (created by the Misthos factory) ${when}, read on Arc at block ${block}.`;
    return null;
  };
  const pinFailed = (message: string) => {
    sigStep.state = "fail";
    sigStep.detail = message;
    return done(false, hash, "Not verified: the signer isn't the vault's agent.");
  };

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
    // Not paid: the program's vault, checked against the factory, and its agent when the decision was made.
    const [prog] = await deps.db
      .select({ vault: programs.vaultAddress })
      .from(programs)
      .where(eq(programs.id, sub!.programId))
      .limit(1);
    if (prog?.vault) {
      const decidedAt =
        typeof parsed.decidedAt === "string" && !Number.isNaN(Date.parse(parsed.decidedAt))
          ? new Date(parsed.decidedAt)
          : d.createdAt;
      const failed = await pin(
        prog.vault as Address,
        await deps.chain.blockAt(decidedAt).catch(() => null),
        "when the decision was made",
      );
      if (failed) return pinFailed(failed);
    } else {
      sigStep.detail += "; the program has no vault yet, so the signer isn't pinned to one.";
    }
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

  // 5. Chain. The vault is whichever contract emitted the payout event (never an address from the database).
  const receipt = await deps.getReceipt(p.txHash as Hex);
  const events = receipt
    ? parseEventLogs({
        abi: misthosVaultAbi,
        logs: receipt.logs,
        eventName: "PayoutExecuted",
      }).filter((l) => l.args.payoutId === p.payoutIdBytes32)
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
      ? `PayoutExecuted in block ${receipt!.blockNumber} paid ${p.toAddress} with decisionHash ${short(recomputed)}, from vault ${ev.address}.`
      : ev
        ? "The on-chain event's decision hash, amount or recipient differs from Misthos's records."
        : "The payout transaction has no matching PayoutExecuted event from this program's vault.",
    href: deps.explorerTx(p.txHash),
  });
  if (matches) {
    const failed = await pin(ev.address as Address, receipt!.blockNumber, "when it paid this");
    if (failed) return pinFailed(failed);
  }
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
