/**
 * Enforcement — the parts of the harness that actually stop an agent.
 *
 * Every check here runs server-side against persisted state, so a caller cannot
 * skip it by editing the client. That is the whole point: the browser-side gates
 * are advisory, these are binding.
 */

export interface AgentRecord {
  id: string;
  agent_id: string;
  role: string;
  status: string;
  allowed_actions?: string[];
  drift_count?: number;
  halt_count?: number;
  total_runs?: number;
  rate_limit_hits?: number;
  loop_trips?: number;
}

export const ROLE_DEFAULTS: Record<string, string[]> = {
  admin: ['*'],
  reader: ['Fetch_Database_Record', 'Query_Web_Search'],
  writer: ['Fetch_Database_Record', 'Query_Web_Search', 'Write_Database_Record', 'Call_API_Tool'],
  tool_caller: ['Call_API_Tool', 'Route_To_Web', 'Query_Web_Search'],
};

/** Tool gate — is this action permitted for this identity? */
export function checkToolGate(agent: AgentRecord, action: string): { allowed: boolean; reason: string } {
  const explicit = Array.isArray(agent.allowed_actions) ? agent.allowed_actions : [];
  if (explicit.includes('*')) return { allowed: true, reason: `Wildcard allowlist for role "${agent.role}"` };
  if (explicit.includes(action)) return { allowed: true, reason: `Explicitly allowlisted for ${agent.agent_id}` };
  const defaults = ROLE_DEFAULTS[agent.role] || [];
  if (defaults.includes('*') || defaults.includes(action)) {
    return { allowed: true, reason: `Permitted by role defaults for "${agent.role}"` };
  }
  return { allowed: false, reason: `Action "${action}" is not in the allowlist for role "${agent.role}"` };
}

/**
 * Recent admitted requests for one agent, newest first.
 * One read serves both the rate limiter and the loop breaker.
 */
async function recentAdmissions(serviceRole: any, agentId: string, lookback = 100) {
  const rows = await serviceRole.entities.AuditLog.filter(
    { agent_id: agentId, event_type: 'ADMISSION_PASS' },
    '-created_date',
    lookback,
  );
  return rows || [];
}

export interface AdmissionChecks {
  rateLimited: boolean;
  rateReason: string;
  windowCount: number;
  looping: boolean;
  loopReason: string;
  repeatCount: number;
}

/**
 * Rate limit + loop breaker, both measured from the persisted admission log.
 *
 * Counting from the log rather than an in-memory counter means limits survive a
 * restart and cannot be reset by reloading the page. It also means the limiter is
 * only as accurate as the log: two requests arriving in the same instant can both
 * read a stale count, so treat this as a cost/runaway bound, not a hard quota.
 */
export async function runAdmissionChecks(
  serviceRole: any,
  agentId: string,
  action: string,
  policy: { max_runs_per_window: number; window_seconds: number; loop_repeat_limit: number },
): Promise<AdmissionChecks> {
  const rows = await recentAdmissions(serviceRole, agentId);
  const cutoff = Date.now() - policy.window_seconds * 1000;

  const inWindow = rows.filter((r: any) => {
    const t = new Date(r.created_date).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });

  const rateLimited = inWindow.length >= policy.max_runs_per_window;

  // Leading run of identical actions — a persistent version of the Base 60 breaker.
  let repeatCount = 0;
  for (const r of rows) {
    if ((r.action || '') === action) repeatCount++;
    else break;
  }
  const looping = repeatCount >= policy.loop_repeat_limit;

  return {
    rateLimited,
    rateReason: rateLimited
      ? `Rate limit exceeded: ${inWindow.length} admitted requests in the last ${policy.window_seconds}s, limit is ${policy.max_runs_per_window}.`
      : '',
    windowCount: inWindow.length,
    looping,
    loopReason: looping
      ? `Circuit breaker: "${action}" repeated ${repeatCount} times in a row (limit ${policy.loop_repeat_limit}).`
      : '',
    repeatCount,
  };
}

export type Enforcement = 'freeze' | 'revoke';

/**
 * The kill switch, with escalation.
 *
 * First trip freezes (reversible, an operator can reinstate). Once an agent has
 * accumulated the configured number of strikes it is revoked, which admission
 * control treats as terminal until a human explicitly reinstates it.
 */
export async function escalateOnDrift(
  serviceRole: any,
  agent: AgentRecord | null,
  policy: { drift_strikes_before_revoke: number; auto_revoke_on_drift: boolean },
  detail: { score: number; decoyId: string; nonce: string },
): Promise<{ enforcement: Enforcement; strikes: number; message: string }> {
  const strikes = (agent?.drift_count || 0) + 1;
  const shouldRevoke = policy.auto_revoke_on_drift && strikes >= policy.drift_strikes_before_revoke;
  const enforcement: Enforcement = shouldRevoke ? 'revoke' : 'freeze';

  const reason = shouldRevoke
    ? `REVOKED by kill switch — drift strike ${strikes} of ${policy.drift_strikes_before_revoke}. Score ${detail.score.toFixed(2)} on decoy "${detail.decoyId}". Requires operator reinstatement.`
    : `Frozen — drift strike ${strikes} of ${policy.drift_strikes_before_revoke}. Score ${detail.score.toFixed(2)} on decoy "${detail.decoyId}". Reversible pending review.`;

  if (agent) {
    await serviceRole.entities.AgentIdentity.update(agent.id, {
      drift_count: strikes,
      last_drift_nonce: detail.nonce,
      status: shouldRevoke ? 'revoked' : 'frozen',
      revoked_reason: reason,
      revoked_at: new Date().toISOString(),
    });
  }

  await serviceRole.entities.AuditLog.create({
    event_type: shouldRevoke ? 'AGENT_REVOKED' : 'AGENT_FROZEN',
    agent_id: agent?.agent_id || 'unknown',
    event_nonce: detail.nonce,
    gate: 'Kill Switch',
    details: reason,
    drift_signal: true,
    enforcement,
    server_enforced: true,
  });

  return { enforcement, strikes, message: reason };
}