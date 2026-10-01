import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { admitRequest } from '../../shared/admission.ts';
import { appendAudit } from '../../shared/auditChain.ts';
import { checkEgressPermission, parseEgressTarget } from '../../shared/egressPolicy.ts';

/**
 * Egress proxy — the only outbound network path the harness controls.
 *
 * SCOPE, STATED HONESTLY: this governs calls an agent makes THROUGH the app. It is a
 * real control over that path — an agent cannot reach a host that is not on the
 * allowlist, and every attempt is logged with its identity. It is NOT network
 * isolation: an agent with any other route to the internet is unaffected by it.
 * That would require a sandbox below the app layer, which does not exist here.
 *
 * Admission runs first, so egress inherits identity, keys, the kill switch, the tool
 * gate, the rate limit and the loop breaker.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
    const action = typeof body.action === 'string' ? body.action.trim() : '';
    const targetUrl = typeof body.url === 'string' ? body.url.trim() : '';
    const method = (typeof body.method === 'string' ? body.method : 'GET').toUpperCase();

    if (!agentId || !action || !targetUrl) {
      return Response.json({ error: 'agentId, action and url are required' }, { status: 400 });
    }

    const svc = base44.asServiceRole;

    const verdict = await admitRequest(svc, {
      agentId, action, sessionNonce: body.sessionNonce, agentKey: body.agentKey,
    });
    if (!verdict.admitted) {
      return Response.json({
        error: `Admission denied at ${verdict.haltedAt}: ${verdict.reason}`,
        haltedAt: verdict.haltedAt, enforcement: verdict.enforcement, serverEnforced: true,
      }, { status: 403 });
    }

    const blocked = async (reason: string, host: string) => {
      await appendAudit(svc, {
        event_type: 'EGRESS_BLOCKED', agent_id: agentId, gate: 'Egress',
        session_nonce: body.sessionNonce || '', action,
        details: `BLOCKED ${method} ${host}: ${reason}`,
        enforcement: 'none', server_enforced: true, halted_at: 'Egress',
      });
      return Response.json({ error: reason, haltedAt: 'Egress', host, serverEnforced: true }, { status: 403 });
    };

    const parsed = parseEgressTarget(targetUrl, method);
    if (!parsed.allowed) return await blocked(parsed.reason, parsed.host);

    const { target } = parsed;
    const rows = await svc.entities.EgressAllowlist.filter({ host: target.host }, '-created_date', 1);
    const entry = rows.length > 0 ? rows[0] : null;
    const permission = checkEgressPermission(target, entry);
    if (!permission.allowed) return await blocked(permission.reason, target.host);

    const upstream = await fetch(target.url, {
      method,
      redirect: 'manual',
      headers: { 'Accept': 'application/json, text/plain;q=0.9, */*;q=0.5' },
      body: method === 'GET' || method === 'HEAD' ? undefined : (typeof body.body === 'string' ? body.body : undefined),
    });

    const raw = await upstream.text();
    const truncated = raw.length > 20000;

    await svc.entities.EgressAllowlist.update(entry.id, { request_count: (entry.request_count || 0) + 1 });
    await appendAudit(svc, {
      event_type: 'EGRESS_ALLOWED', agent_id: agentId, gate: 'Egress',
      session_nonce: body.sessionNonce || '', action,
      details: `ALLOWED ${method} https://${target.host}${new URL(target.url).pathname} → ${upstream.status}, ${raw.length} bytes.`,
      enforcement: 'none', server_enforced: true,
    });

    return Response.json({
      host: target.host,
      method: target.method,
      status: upstream.status,
      truncated,
      bodyLength: raw.length,
      body: truncated ? raw.slice(0, 20000) : raw,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}