/**
 * The only way client-side code may write to the audit log.
 *
 * Previously the browser wrote audit rows directly. Two problems with that: the rows
 * were unchained (so deleting one left no trace), and a row written by a client is a
 * row the client could also have forged. Routing every client-originated event through
 * here means it gets a sequence number, a chain hash and a server-side signature.
 *
 * What this does NOT fix, stated plainly: the CONTENT still comes from the client, so
 * a lying client can still record a lie. It just cannot record it unsigned, out of
 * order, or remove it afterwards without leaving a detectable hole. Rows written here
 * are marked server_enforced: false so nobody mistakes a client claim for a server
 * verdict.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { appendAudit } from '../../shared/auditChain.ts';

const ALLOWED = new Set([
  'GATE_PASS', 'GATE_HALT', 'CACHE_HIT', 'CACHE_STORE', 'OUTPUT_ATTRIBUTED', 'PIPELINE_COMPLETE',
]);

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const eventType = String(body?.event_type || '');

    // A client must not be able to mint enforcement events like AGENT_REVOKED or
    // ADMISSION_PASS — those may only be written by the server paths that decide them.
    if (!ALLOWED.has(eventType)) {
      return Response.json({
        error: `Event type "${eventType}" cannot be recorded from the client. Only observational events are accepted here; enforcement events are written by the gates that decide them.`,
      }, { status: 403 });
    }

    const row = await appendAudit(base44.asServiceRole, {
      event_type: eventType,
      agent_id: String(body?.agent_id || 'unknown'),
      session_nonce: String(body?.session_nonce || ''),
      output_hash: String(body?.output_hash || ''),
      gate: String(body?.gate || ''),
      action: String(body?.action || ''),
      details: String(body?.details || '').slice(0, 2000),
      tokens_total: typeof body?.tokens_total === 'number' ? body.tokens_total : 0,
      drift_signal: !!body?.drift_signal,
      enforcement: typeof body?.enforcement === 'string' ? body.enforcement : '',
      halted_at: String(body?.halted_at || ''),
      server_enforced: false,
    });

    return Response.json({ ok: true, seq: row?.seq, rowHash: row?.row_hash });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}