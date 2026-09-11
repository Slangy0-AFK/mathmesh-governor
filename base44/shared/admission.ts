/**
 * Admission — the single binding gate, callable from any function that spends money.
 *
 * This lives in shared code on purpose. An earlier version ran admission in its own
 * function, which meant a caller could simply not call it and go straight to the
 * model. Now every spend path calls admitRequest() itself, so skipping the gate is
 * not a thing a caller can choose to do.
 *
 * Rate limiting is reserve-then-rank, not count-then-act: each request first writes
 * its own reservation, then checks whether it is among the first N in the window.
 * Concurrent requests therefore cannot all read a stale count and all be admitted.
 */

import { loadPolicy, type HarnessPolicy } from './harnessPolicy.ts';
import { checkToolGate } from './enforcement.ts';
import { generateNonce } from './semanticDrift.ts';
import { verifyAgentKey } from './agentKeys.ts';
import { appendAudit } from './auditChain.ts';
import { windowSpend } from './tokenLedger.ts';

export interface AdmissionVerdict {
  admitted: boolean;
  haltedAt?: string;
  reason?: string;
  enforcement?: string;
  nonce?: string;
  ticket?: string;
  agent?: any;
  role?: string;
  toolGateReason?: string;
  keyReason?: string;
  authenticated?: boolean;
  windowCount?: number;
  windowLimit?: number;
  windowSeconds?: number;
  repeatCount?: number;
  loopLimit?: number;
  tokensSpent?: number;
  tokenLimit?: number;
  tokenWindowSeconds?: number;
  policy?: HarnessPolicy;
}

async function audit(svc: any, fields: Record<string, unknown>) {
  try {
    // Chained writer, so an admission decision cannot be quietly edited out later.
    await appendAudit(svc, { server_enforced: true, gate: 'Admission', ...fields });
  } catch { /* auditing must never be the reason a deny fails to apply */ }
}

/**
 * Decide whether this agent may proceed. On success an unconsumed one-time ticket is
 * returned; the spend path must consume it via consumeTicket().
 */
export async function admitRequest(
  svc: any,
  input: { agentId: string; action: string; sessionNonce?: string; agentKey?: string },
): Promise<AdmissionVerdict> {
  const agentId = (input.agentId || '').trim();
  const action = (input.action || '').trim();
  const sessionNonce = input.sessionNonce || '';

  const policy = await loadPolicy(svc);

  const deny = async (
    haltedAt: string,
    reason: string,
    eventType: string,
    enforcement: string,
    extra: Record<string, unknown> = {},
  ): Promise<AdmissionVerdict> => {
    const nonce = generateNonce();
    await audit(svc, {
      event_type: eventType, agent_id: agentId, session_nonce: sessionNonce,
      event_nonce: nonce, action, details: reason, enforcement, halted_at: haltedAt,
    });
    return { admitted: false, haltedAt, reason, enforcement, nonce, policy, ...extra };
  };

  // 1. Global emergency stop.
  if (policy.kill_all) {
    return await deny('Kill Switch', `Global emergency stop is engaged. ${policy.kill_all_reason || 'No reason recorded.'}`, 'ADMISSION_DENIED', 'kill_all');
  }

  // 2. Identity.
  const found = await svc.entities.AgentIdentity.filter({ agent_id: agentId }, '-created_date', 1);
  let agent = found.length > 0 ? found[0] : null;

  // An unknown id used to be auto-registered as a reader. That is convenient and it
  // is also a hole: a frozen agent could walk away from its own record by picking a
  // new name. While keys are required, an unknown id is simply refused.
  if (!agent && policy.require_agent_key) {
    return await deny(
      'Identity',
      `Unknown agent "${agentId}". Key authentication is required, so unregistered identities are refused rather than auto-registered. An operator must register this agent and issue it a key.`,
      'IDENTITY_DENIED', 'none',
    );
  }

  if (!agent) {
    agent = await svc.entities.AgentIdentity.create({
      agent_id: agentId, role: 'reader', status: 'active', allowed_actions: [],
      session_nonce: sessionNonce,
      total_runs: 0, halt_count: 0, drift_count: 0, rate_limit_hits: 0, loop_trips: 0,
    });
    await audit(svc, {
      event_type: 'IDENTITY_VERIFIED', agent_id: agentId, session_nonce: sessionNonce, action,
      details: `First sighting of "${agentId}" — auto-registered with least privilege (role: reader).`,
      enforcement: 'none',
    });
  }

  // 2b. Authentication — prove the identity before honouring anything attached to it.
  //     This runs before lifecycle and the tool gate on purpose: an unverified caller
  //     must not be able to learn an agent's status or permissions by probing.
  const keyVerdict = await verifyAgentKey(agent, input.agentKey, policy.require_agent_key);
  if (!keyVerdict.ok) {
    await svc.entities.AgentIdentity.update(agent.id, {
      key_auth_failures: (agent.key_auth_failures || 0) + 1,
      halt_count: (agent.halt_count || 0) + 1,
    });
    return await deny('Identity', keyVerdict.reason, 'IDENTITY_DENIED', 'none');
  }

  // 3. Lifecycle — revoked is terminal, frozen is a hold.
  if (agent.status === 'revoked') {
    return await deny('Kill Switch', `Agent is REVOKED and cannot run. ${agent.revoked_reason || ''} An operator must reinstate it.`, 'ADMISSION_DENIED', 'revoke', { agent });
  }
  if (agent.status === 'frozen') {
    return await deny('Kill Switch', `Agent is FROZEN pending review. ${agent.revoked_reason || ''} An operator must reinstate it.`, 'ADMISSION_DENIED', 'freeze', { agent });
  }

  // 4. Tool gate.
  const gate = checkToolGate(agent, action);
  if (!gate.allowed) {
    await svc.entities.AgentIdentity.update(agent.id, { halt_count: (agent.halt_count || 0) + 1 });
    return await deny('Tool Gate', gate.reason, 'TOOL_GATE_DENIED', 'none', { agent, role: agent.role });
  }

  // 5. Reserve a slot BEFORE deciding, so simultaneous requests are ordered rather
  //    than all reading the same pre-insert count.
  const ticket = generateNonce();
  const reservation = await svc.entities.AdmissionTicket.create({
    ticket, agent_id: agentId, action, session_nonce: sessionNonce, consumed: false, rejected: false,
  });

  const windowStart = new Date(Date.now() - policy.window_seconds * 1000).toISOString();
  const recent = await svc.entities.AdmissionTicket.filter({ agent_id: agentId }, '-created_date', 200);

  const inWindow = recent
    .filter((t: any) => !t.rejected && t.created_date >= windowStart)
    // Deterministic ordering, with id as the tiebreak for identical timestamps, so
    // every concurrent request computes the same ranking.
    .sort((a: any, b: any) => (a.created_date === b.created_date ? String(a.id).localeCompare(String(b.id)) : String(a.created_date).localeCompare(String(b.created_date))));

  const position = inWindow.findIndex((t: any) => t.id === reservation.id) + 1;

  if (position > policy.max_runs_per_window) {
    await svc.entities.AdmissionTicket.update(reservation.id, { rejected: true });
    await svc.entities.AgentIdentity.update(agent.id, {
      rate_limit_hits: (agent.rate_limit_hits || 0) + 1,
      halt_count: (agent.halt_count || 0) + 1,
    });
    return await deny(
      'Rate Limit',
      `Rate limit exceeded: request ${position} of a ${policy.max_runs_per_window}-per-${policy.window_seconds}s budget for this agent.`,
      'RATE_LIMIT_EXCEEDED', 'rate_limited',
      { agent, windowCount: position },
    );
  }

  // 6. Loop breaker — consecutive identical actions, excluding this reservation.
  const priorNewestFirst = inWindow
    .filter((t: any) => t.id !== reservation.id)
    .reverse();
  let repeatCount = 0;
  for (const t of priorNewestFirst) {
    if (t.action === action) repeatCount++;
    else break;
  }
  if (repeatCount >= policy.loop_repeat_limit) {
    await svc.entities.AdmissionTicket.update(reservation.id, { rejected: true });
    await svc.entities.AgentIdentity.update(agent.id, {
      loop_trips: (agent.loop_trips || 0) + 1,
      halt_count: (agent.halt_count || 0) + 1,
    });
    return await deny(
      'Base 60',
      `Circuit breaker: "${action}" repeated ${repeatCount} times in a row (limit ${policy.loop_repeat_limit}).`,
      'LOOP_BREAKER_TRIPPED', 'none',
      { agent, repeatCount },
    );
  }

  // 7. Token budget — the bound that actually corresponds to exhaustion. This is a
  //    cheap pre-check on what the agent has already spent; the exact reservation for
  //    this request happens in the spend path, where the real prompt exists.
  let tokensSpent = 0;
  try {
    tokensSpent = await windowSpend(svc, agentId, policy.token_window_seconds);
  } catch { /* ledger unreadable — the spend path still reserves, so do not deny here */ }

  if (policy.enforce_token_budget && tokensSpent >= policy.max_tokens_per_window) {
    await svc.entities.AdmissionTicket.update(reservation.id, { rejected: true });
    await svc.entities.AgentIdentity.update(agent.id, { halt_count: (agent.halt_count || 0) + 1 });
    return await deny(
      'Token Budget',
      `Token budget exhausted: ~${tokensSpent} of ${policy.max_tokens_per_window} estimated tokens spent in the last ${policy.token_window_seconds}s. Counts include the harness's own judge calls.`,
      'TOKEN_BUDGET_EXCEEDED', 'budget_exhausted',
      { agent, tokensSpent, tokenLimit: policy.max_tokens_per_window },
    );
  }

  await audit(svc, {
    event_type: 'ADMISSION_PASS', agent_id: agentId, session_nonce: sessionNonce, action,
    tokens_total: 0,
    details: `Admitted. ${keyVerdict.reason} Role "${agent.role}" (${gate.reason}). ${position}/${policy.max_runs_per_window} in the ${policy.window_seconds}s window. Consecutive repeats: ${repeatCount}.`,
    enforcement: 'none',
  });
  await svc.entities.AgentIdentity.update(agent.id, {
    total_runs: (agent.total_runs || 0) + 1,
    session_nonce: sessionNonce,
  });

  return {
    admitted: true, ticket, agent, role: agent.role, toolGateReason: gate.reason,
    keyReason: keyVerdict.reason, authenticated: !!(agent.key_hash || '').trim(),
    windowCount: position, windowLimit: policy.max_runs_per_window,
    windowSeconds: policy.window_seconds, repeatCount, loopLimit: policy.loop_repeat_limit,
    tokensSpent, tokenLimit: policy.max_tokens_per_window,
    tokenWindowSeconds: policy.token_window_seconds,
    policy,
  };
}

/**
 * Spend an admission ticket. Returns false if the ticket is unknown, already spent,
 * or issued for a different agent or action — so one admission cannot be replayed
 * across many model calls, and a ticket cannot be reused under a different identity.
 */
export async function consumeTicket(
  svc: any,
  input: { ticket: string; agentId: string; action: string; consumedBy: string },
): Promise<{ ok: boolean; reason: string }> {
  if (!input.ticket) return { ok: false, reason: 'No admission ticket presented.' };
  const rows = await svc.entities.AdmissionTicket.filter({ ticket: input.ticket }, '-created_date', 1);
  if (rows.length === 0) return { ok: false, reason: 'Admission ticket not found.' };
  const t = rows[0];
  if (t.rejected) return { ok: false, reason: 'Admission ticket was refused at admission.' };
  if (t.consumed) return { ok: false, reason: 'Admission ticket has already been spent.' };
  if (t.agent_id !== input.agentId) return { ok: false, reason: 'Admission ticket was issued to a different agent.' };
  if (t.action !== input.action) return { ok: false, reason: 'Admission ticket was issued for a different action.' };
  await svc.entities.AdmissionTicket.update(t.id, { consumed: true, consumed_by: input.consumedBy });
  return { ok: true, reason: 'Ticket valid and now spent.' };
}