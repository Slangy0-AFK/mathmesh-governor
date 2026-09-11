/**
 * Verify the audit chain. Admin-only and read-only.
 *
 * This is the function that decides whether anything else in this harness can be
 * believed. If the chain is broken, every claim built on the log — spend, drift
 * verdicts, kill switch history — is unverified from that point on.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { verifyChain } from '../../shared/auditChain.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — chain verification is an operator function.' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const limit = typeof body?.limit === 'number' && body.limit > 0 && body.limit <= 2000 ? body.limit : 500;

    const svc = base44.asServiceRole;
    const result = await verifyChain(svc, limit);

    // Recording the verification extends the chain, so a later reader can see that a
    // check happened and what it found. Verification is not exempt from the log.
    const tampering = result.problems.filter((p) => p.kind === 'altered' || p.kind === 'bad_signature' || p.kind === 'broken_link' || p.kind === 'gap');
    const benign = result.problems.filter((p) => p.kind === 'unchained' || p.kind === 'fork' || p.kind === 'unsigned');

    const summary = result.ok
      ? `Chain intact across ${result.checked} events. Head seq ${result.headSeq}.`
      : `${tampering.length} tampering indicator(s) and ${benign.length} benign anomal(ies) across ${result.checked} events. Head seq ${result.headSeq}.`;

    return Response.json({
      ok: result.ok,
      tamperingDetected: tampering.length > 0,
      checked: result.checked,
      headSeq: result.headSeq,
      headHash: result.headHash,
      problems: result.problems,
      tampering,
      benign,
      summary,
      caveat: 'This proves the log is tamper-EVIDENT, not immutable. Rows can still be edited or deleted — the point is that doing so is detectable here rather than silent. Rows marked "unchained" were written before chaining existed and cannot be verified either way.',
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}