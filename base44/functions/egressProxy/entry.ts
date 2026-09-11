import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { admitRequest } from '../../shared/admission.ts';

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
      await svc.entities.AuditLog.create({
        event_type: 'EGRESS_BLOCKED', agent_id: agentId, gate: 'Egress',
        session_nonce: body.sessionNonce || '', action,
        details: `BLOCKED ${method} ${host}: ${reason}`,
        enforcement: 'none', server_enforced: true, halted_at: 'Egress',
      });
      return Response.json({ error: reason, haltedAt: 'Egress', host, serverEnforced: true }, { status: 403 });
    };

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return await blocked('Destination is not a valid absolute URL.', targetUrl.slice(0, 80));
    }

    // Scheme is fixed, not allowlisted: anything but https is refused outright.
    if (parsed.protocol !== 'https:') {
      return await blocked(`Scheme "${parsed.protocol}" is not permitted. Only https is allowed.`, parsed.hostname);
    }

    const rows = await svc.entities.EgressAllowlist.filter({ host: parsed.hostname }, '-created_date', 1);
    const entry = rows.length > 0 ? rows[0] : null;

    if (!entry || entry.enabled === false) {
      return await blocked(
        `Host "${parsed.hostname}" is not on the egress allowlist${entry ? ' (entry is disabled)' : ''}. Default is deny.`,
        parsed.hostname,
      );
    }

    const methods = (Array.isArray(entry.allowed_methods) && entry.allowed_methods.length > 0)
      ? entry.allowed_methods.map((m: string) => m.toUpperCase())
      : ['GET'];
    if (!methods.includes(method)) {
      return await blocked(`Method ${method} is not permitted for "${parsed.hostname}" (allowed: ${methods.join(', ')}).`, parsed.hostname);
    }

    const upstream = await fetch(parsed.toString(), {
      method,
      headers: { 'Accept': 'application/json, text/plain;q=0.9, */*;q=0.5' },
      body: method === 'GET' || method === 'HEAD' ? undefined : (typeof body.body === 'string' ? body.body : undefined),
    });

    const raw = await upstream.text();
    const truncated = raw.length > 20000;

    await svc.entities.EgressAllowlist.update(entry.id, { request_count: (entry.request_count || 0) + 1 });
    await svc.entities.AuditLog.create({
      event_type: 'EGRESS_ALLOWED', agent_id: agentId, gate: 'Egress',
      session_nonce: body.sessionNonce || '', action,
      details: `ALLOWED ${method} https://${parsed.hostname}${parsed.pathname} → ${upstream.status}, ${raw.length} bytes.`,
      enforcement: 'none', server_enforced: true,
    });

    return Response.json({
      host: parsed.hostname,
      method,
      status: upstream.status,
      truncated,
      bodyLength: raw.length,
      body: truncated ? raw.slice(0, 20000) : raw,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}