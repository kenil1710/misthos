import "server-only";
import { auditEvents, type DbLike } from "@misthos/db";

export interface AuditInput {
  programId?: string | null;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  data?: Record<string, unknown>;
}

/** Append an audit event. Accepts a transaction so the event commits with the change it describes. */
export async function audit(db: Pick<DbLike, "insert">, e: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    programId: e.programId ?? null,
    actor: e.actor,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    dataJson: e.data ?? {},
  });
}
