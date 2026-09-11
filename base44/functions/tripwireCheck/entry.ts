import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { detectCanaryDrift, generateNonce } from '../../shared/canary.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { response, agentId, sessionNonce, action } = body;

    if (!response || typeof response !== 'string') {
      return Response.json({ error: 'Missing response text' }, { status: 400 });
    }

    // Drift detection — check if the LLM response engaged the canary decoy
    const driftResult = detectCanaryDrift(response);

    if (driftResult.drift) {
      // Generate 256-bit QRNG nonce (CSPRNG via Web Crypto API)
      const nonce = generateNonce();

      // Log halt event to audit (service role — append-only)
      await base44.asServiceRole.entities.AuditLog.create({
        event_type: 'DRIFT_DETECTED',
        agent_id: agentId || 'unknown',
        session_nonce: sessionNonce || '',
        event_nonce: nonce,
        gate: 'Tripwire',
        action: action || '',
        details: `Canary engagement detected (${driftResult.signalType} signal). Matched: ${driftResult.matchedTerms.join(', ')}`,
        drift_signal: true,
        halted_at: 'Tripwire',
      });

      // Freeze the agent + increment drift count
      const agents = await base44.asServiceRole.entities.AgentIdentity.filter({ agent_id: agentId || '' });
      if (agents.length > 0) {
        const agent = agents[0] as any;
        await base44.asServiceRole.entities.AgentIdentity.update(agent.id, {
          drift_count: (agent.drift_count || 0) + 1,
          last_drift_nonce: nonce,
          status: 'frozen',
          revoked_reason: `Tripwire drift: ${driftResult.matchedTerms.join(', ')}`,
        });
      }

      return Response.json({
        drift: true,
        matchedTerms: driftResult.matchedTerms,
        signalType: driftResult.signalType,
        nonce,
        message: 'TRIPWIRE TRIGGERED: Agent engaged canary decoy. Drift detected. Agent frozen. Halt event logged with QRNG nonce.',
      });
    }

    // No drift — log pass event
    await base44.asServiceRole.entities.AuditLog.create({
      event_type: 'TRIPWIRE_PASS',
      agent_id: agentId || 'unknown',
      session_nonce: sessionNonce || '',
      gate: 'Tripwire',
      action: action || '',
      details: 'No canary engagement detected. Agent behavior nominal.',
      drift_signal: false,
    });

    return Response.json({
      drift: false,
      matchedTerms: [],
      signalType: 'none',
      nonce: null,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}