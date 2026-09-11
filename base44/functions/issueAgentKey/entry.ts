import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { generateAgentKey, sha256Hex } from '../../shared/agentKeys.ts';

/**
 * Issue or rotate an agent's secret key. Admin only.
 *
 * The plaintext is returned exactly once, in this response, and never stored. If the
 * operator loses it the only remedy is rotation — which is the property that makes
 * the stored hash worth anything.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden — only an app admin may issue agent keys.' }, { status: 403 });
    }

    const body = await req.json();
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
    if (!agentId) return Response.json({ error: 'agentId is required' }, { status: 400 });

    const svc = base44.asServiceRole;
    const rows = await svc.entities.AgentIdentity.filter({ agent_id: agentId }, '-created_date', 1);
    if (rows.length === 0) {
      return Response.json({ error: `No registered agent "${agentId}". Register it first.` }, { status: 404 });
    }
    const agent = rows[0];
    const rotation = !!(agent.key_hash || '').trim();

    const key = generateAgentKey();
    const keyHash = await sha256Hex(key);
    const issuedAt = new Date().toISOString();

    await svc.entities.AgentIdentity.update(agent.id, {
      key_hash: keyHash,
      key_last_four: key.slice(-4),
      key_issued_at: issuedAt,
      key_auth_failures: 0,
    });

    await svc.entities.AuditLog.create({
      event_type: 'IDENTITY_VERIFIED',
      agent_id: agentId,
      gate: 'Agent Keys',
      details: rotation
        ? `Key ROTATED for "${agentId}" by ${user.email}. The previous key is now dead. Plaintext shown once and not stored.`
        : `Key ISSUED for "${agentId}" by ${user.email}. Plaintext shown once and not stored.`,
      enforcement: 'none',
      server_enforced: true,
    });

    return Response.json({
      agentId,
      key,
      rotation,
      issuedAt,
      lastFour: key.slice(-4),
      warning: 'Copy this key now. It is not stored and cannot be shown again.',
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}