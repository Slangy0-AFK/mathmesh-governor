/**
 * Periodic audit anchor maintenance function.
 *
 * This function should be called regularly (e.g., daily via a cron job or scheduled task)
 * to create external anchors of the audit chain head. External anchoring makes it harder
 * for an attacker to retroactively tamper with the audit log.
 *
 * Deployment note: The actual mechanism for storing anchors externally depends on your
 * infrastructure. Options include:
 * 1. Commit to a git repository (read-only from this app's perspective)
 * 2. POST to an external audit service with signature verification
 * 3. Write to a ledger or append-only log
 * 4. Generate a file for manual/operator verification
 */

import { createAppClientFromRequest } from '../../../server/runtime.js';
import { recordAuditAnchor, generateAuditSnapshot } from '../../shared/auditAnchoring.ts';
import { sha256Hex } from '../../shared/auditChain.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const appClient = createAppClientFromRequest(req);
    const user = await appClient.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const svc = appClient.asServiceRole;

    // Get the current chain head
    const rows = await svc.entities.AuditLog.list('-seq', 1);
    const head = rows && rows.length > 0 ? rows[0] : null;

    if (!head || typeof head.seq !== 'number' || !head.row_hash) {
      return Response.json({
        ok: false,
        message: 'No audit records yet; nothing to anchor.',
      });
    }

    // Determine anchor type from environment or request body
    const body = await req.json().catch(() => ({}));
    const anchorType = body?.anchorType || process.env.AUDIT_ANCHOR_TYPE || 'manual';

    // Generate a snapshot suitable for external storage
    const snapshot = generateAuditSnapshot(
      { seq: head.seq, hash: head.row_hash },
      new Date().toISOString(),
      process.env.npm_package_version || 'unknown'
    );

    // In a real deployment, here you would:
    // 1. Call your external anchor service
    // 2. Commit to git (via an external script or service)
    // 3. Write to a ledger
    // etc.

    // For now, just record the anchor metadata locally
    const anchor = await recordAuditAnchor(
      svc,
      { seq: head.seq, hash: head.row_hash },
      anchorType as any,
      `snapshot-seq-${head.seq}`
    );

    return Response.json({
      ok: true,
      message: 'Audit chain anchored',
      anchor,
      snapshot: body?.includeSnapshot ? snapshot : undefined,
      note: 'The snapshot should be stored in your external anchor service. This function only records metadata locally.',
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
