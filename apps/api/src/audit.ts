import type { AppDb } from '@zoo/db'
import { auditLogs } from '@zoo/db/schema'

/**
 * Audit trail writer — SPEC.md §12: "audit_logs on every create/update/delete
 * of escalations, RCAs, actions, accounts, memberships."
 *
 * Kept tiny and synchronous with the mutation it records. A fire-and-forget
 * audit write could silently drop the record if the process exits first, and
 * an audit trail with gaps is worse than a slightly slower write.
 */
export interface AuditEntry {
  readonly actorUserId: string
  readonly action: string
  readonly entityType: string
  readonly entityId: string
  /** A compact record of what changed — the created row, or the field delta. */
  readonly diff?: unknown
}

export async function writeAudit(db: AppDb, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    diff: entry.diff === undefined ? null : (entry.diff as Record<string, unknown>),
  })
}
