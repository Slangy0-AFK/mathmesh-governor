import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { loadPolicy } from '../../shared/harnessPolicy.ts';
import { generateNonce } from '../../shared/semanticDrift.ts';

/**
 * Kill switch — operator control over the harness.
 *
 * Admin only, and every action is written to the audit log with a nonce. Modes:
 *   engage_all / release_all — global emergency stop for every agent
 *   revoke / freeze          — stop one agent
 *   reinstate                — return one agent to active and clear its strikes
 *   set_policy               — retune limits without a redeploy
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden — the kill switch is admin only.' }, { status: 403 });
    }

    const body = await req.json();
    const mode = typeof body.mode === 'string' ? body.mode : '';
    const reason = typeof body.reason === 'string' ? body.reason : '';
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';

    const svc = base44.asServiceRole;
    const policy = await loadPolicy(svc);
    const nonce = generateNonce();

    const audit = async (eventType: string, agent: string, details: string, enforcement: string) => {
      await svc.entities.AuditLog.create({
        event_type: eventType,
        agent_id: agent || 'ALL',
        event_nonce: nonce,
        gate: 'Kill Switch',
        details: `${details} (operator: ${user.email})`,
        enforcement,
        server_enforced: true,
      });
    };

    if (mode === 'engage_all' || mode === 'release_all') {
      const engaging = mode === 'engage_all';
      await svc.entities.HarnessControl.update(policy.id, {
        kill_all: engaging,
        kill_all_reason: engaging ? reason || 'No reason given.' : '',
        kill_all_engaged_by: engaging ? user.email : '',
      });
      await audit(
        engaging ? 'KILL_ALL_ENGAGED' : 'KILL_ALL_RELEASED',
        'ALL',
        engaging
          ? `GLOBAL EMERGENCY STOP ENGAGED. Every agent request is now denied at admission. Reason: ${reason || 'none given'}`
          : 'Global emergency stop released. Agents may run again, subject to their own status.',
        engaging ? 'kill_all' : 'none',
      );
      return Response.json({ success: true, kill_all: engaging, nonce });
    }

    if (mode === 'set_policy') {
      const patch: Record<string, unknown> = {};
      for (const key of ['max_runs_per_window', 'window_seconds', 'loop_repeat_limit', 'drift_strikes_before_revoke']) {
        if (typeof body[key] === 'number' && body[key] > 0) patch[key] = body[key];
      }
      if (typeof body.auto_revoke_on_drift === 'boolean') patch.auto_revoke_on_drift = body.auto_revoke_on_drift;
      if (Object.keys(patch).length === 0) {
        return Response.json({ error: 'No valid policy fields supplied' }, { status: 400 });
      }
      await svc.entities.HarnessControl.update(policy.id, patch);
      await audit('KILL_ALL_RELEASED', 'ALL', `Policy updated: ${JSON.stringify(patch)}`, 'none');
      return Response.json({ success: true, policy: { ...policy, ...patch }, nonce });
    }

    if (!agentId) return Response.json({ error: 'agentId is required for this mode' }, { status: 400 });

    const found = await svc.entities.AgentIdentity.filter({ agent_id: agentId }, '-created_date', 1);
    if (found.length === 0) return Response.json({ error: `Unknown agent "${agentId}"` }, { status: 404 });
    const agent = found[0];

    if (mode === 'revoke' || mode === 'freeze') {
      const revoking = mode === 'revoke';
      await svc.entities.AgentIdentity.update(agent.id, {
        status: revoking ? 'revoked' : 'frozen',
        revoked_reason: `${revoking ? 'Revoked' : 'Frozen'} by operator ${user.email}. ${reason || 'No reason given.'}`,
        revoked_at: new Date().toISOString(),
      });
      await audit(
        revoking ? 'AGENT_REVOKED' : 'AGENT_FROZEN',
        agentId,
        `${revoking ? 'Kill switch: agent revoked' : 'Agent frozen'}. Reason: ${reason || 'none given'}`,
        revoking ? 'revoke' : 'freeze',
      );
      return Response.json({ success: true, status: revoking ? 'revoked' : 'frozen', nonce });
    }

    if (mode === 'reinstate') {
      await svc.entities.AgentIdentity.update(agent.id, {
        status: 'active',
        revoked_reason: '',
        drift_count: 0,
      });
      await audit(
        'AGENT_REINSTATED',
        agentId,
        `Agent reinstated and drift strikes cleared. Prior state: ${agent.status}. Reason: ${reason || 'none given'}`,
        'none',
      );
      return Response.json({ success: true, status: 'active', nonce });
    }

    return Response.json({ error: `Unknown mode "${mode}"` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}