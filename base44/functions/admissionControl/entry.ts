import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { loadPolicy } from '../../shared/harnessPolicy.ts';
import { checkToolGate, runAdmissionChecks } from '../../shared/enforcement.ts';
import { generateNonce } from '../../shared/semanticDrift.ts';

/**
 * Admission control — the binding gate in front of every agent request.
 *
 * Runs BEFORE any model spend and decides, server-side:
 *   1. Global stop      — is the whole harness halted?
 *   2. Identity         — is this agent registered?
 *   3. Lifecycle        — is it revoked (terminal) or frozen (held)?
 *   4. Tool gate        — is this action in its allowlist?
 *   5. Rate limit       — has it exceeded its per-identity budget?
 *   6. Loop breaker     — is it repeating the same action?
 *
 * The client cannot skip this: the verdict, and the admission log the limits are
 * measured from, both live on the server.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
    const action = typeof body.action === 'string' ? body.action.trim() : '';
    const sessionNonce = typeof body.sessionNonce === 'string' ? body.sessionNonce : '';

    if (!agentId || !action) {
      return Response.json({ error: 'agentId and action are required' }, { status: 400 });
    }

    const svc = base44.asServiceRole;
    const policy = await loadPolicy(svc);

    const deny = async (
      haltedAt: string,
      reason: string,
      eventType: string,
      enforcement: string,
      extra: Record<string, unknown> = {},
    ) => {
      const nonce = generateNonce();
      await svc.entities.AuditLog.create({
        event_type: eventType,
        agent_id: agentId,
        session_nonce: sessionNonce,
        event_nonce: nonce,
        gate: 'Admission',
        action,
        details: reason,
        enforcement,
        server_enforced: true,
        halted_at: haltedAt,
      });
      return Response.json({
        admitted: false, haltedAt, reason, enforcement, nonce, policy, ...extra,
      });
    };

    // 1. Global emergency stop — nothing runs while this is engaged.
    if (policy.kill_all) {
      return await deny(
        'Kill Switch',
        `Global emergency stop is engaged. ${policy.kill_all_reason || 'No reason recorded.'}`,
        'ADMISSION_DENIED',
        'kill_all',
      );
    }

    // 2. Identity.
    const found = await svc.entities.AgentIdentity.filter({ agent_id: agentId }, '-created_date', 1);
    let agent = found.length > 0 ? found[0] : null;

    if (!agent) {
      // Least privilege on first sight: an unknown agent is registered as a reader,
      // never an admin. It has to be granted anything beyond read actions.
      agent = await svc.entities.AgentIdentity.create({
        agent_id: agentId,
        role: 'reader',
        status: 'active',
        allowed_actions: [],
        session_nonce: sessionNonce,
        total_runs: 0, halt_count: 0, drift_count: 0, rate_limit_hits: 0, loop_trips: 0,
      });
      await svc.entities.AuditLog.create({
        event_type: 'IDENTITY_VERIFIED',
        agent_id: agentId,
        session_nonce: sessionNonce,
        gate: 'Admission',
        action,
        details: `First sighting of "${agentId}" — auto-registered with least privilege (role: reader). Grant additional actions explicitly in the registry.`,
        enforcement: 'none',
        server_enforced: true,
      });
    }

    // 3. Lifecycle — revoked is terminal, frozen is a hold.
    if (agent.status === 'revoked') {
      return await deny(
        'Kill Switch',
        `Agent is REVOKED and cannot run. ${agent.revoked_reason || ''} An operator must reinstate it.`,
        'ADMISSION_DENIED',
        'revoke',
        { agent },
      );
    }
    if (agent.status === 'frozen') {
      return await deny(
        'Kill Switch',
        `Agent is FROZEN pending review. ${agent.revoked_reason || ''} An operator must reinstate it.`,
        'ADMISSION_DENIED',
        'freeze',
        { agent },
      );
    }

    // 4. Tool gate.
    const gate = checkToolGate(agent, action);
    if (!gate.allowed) {
      await svc.entities.AgentIdentity.update(agent.id, { halt_count: (agent.halt_count || 0) + 1 });
      return await deny('Tool Gate', gate.reason, 'TOOL_GATE_DENIED', 'none', { agent, role: agent.role });
    }

    // 5 + 6. Rate limit and loop breaker, measured from the persisted admission log.
    const checks = await runAdmissionChecks(svc, agentId, action, policy);

    if (checks.rateLimited) {
      await svc.entities.AgentIdentity.update(agent.id, {
        rate_limit_hits: (agent.rate_limit_hits || 0) + 1,
        halt_count: (agent.halt_count || 0) + 1,
      });
      return await deny('Rate Limit', checks.rateReason, 'RATE_LIMIT_EXCEEDED', 'rate_limited', {
        agent, windowCount: checks.windowCount,
      });
    }

    if (checks.looping) {
      await svc.entities.AgentIdentity.update(agent.id, {
        loop_trips: (agent.loop_trips || 0) + 1,
        halt_count: (agent.halt_count || 0) + 1,
      });
      return await deny('Base 60', checks.loopReason, 'LOOP_BREAKER_TRIPPED', 'none', {
        agent, repeatCount: checks.repeatCount,
      });
    }

    // Admitted. This record is what the rate limiter and loop breaker count next time.
    await svc.entities.AuditLog.create({
      event_type: 'ADMISSION_PASS',
      agent_id: agentId,
      session_nonce: sessionNonce,
      gate: 'Admission',
      action,
      details: `Admitted. Role "${agent.role}" (${gate.reason}). ${checks.windowCount + 1}/${policy.max_runs_per_window} in the ${policy.window_seconds}s window. Consecutive repeats of this action: ${checks.repeatCount}.`,
      enforcement: 'none',
      server_enforced: true,
    });

    await svc.entities.AgentIdentity.update(agent.id, {
      total_runs: (agent.total_runs || 0) + 1,
      session_nonce: sessionNonce,
    });

    return Response.json({
      admitted: true,
      agent,
      role: agent.role,
      toolGateReason: gate.reason,
      windowCount: checks.windowCount + 1,
      windowLimit: policy.max_runs_per_window,
      windowSeconds: policy.window_seconds,
      repeatCount: checks.repeatCount,
      loopLimit: policy.loop_repeat_limit,
      policy,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}