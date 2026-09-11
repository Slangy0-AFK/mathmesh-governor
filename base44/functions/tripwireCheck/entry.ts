import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { detectSemanticDrift, generateNonce, DRIFT_THRESHOLD } from '../../shared/semanticDrift.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { response, agentId, sessionNonce, action, decoyIds, threshold, model } = body;

    if (!response || typeof response !== 'string') {
      return Response.json({ error: 'Missing response text' }, { status: 400 });
    }

    const ids: string[] = Array.isArray(decoyIds) ? decoyIds : [];

    // Semantic detector — scores engagement per injected decoy.
    // The keyword prefilter result comes back alongside it, for comparison only.
    const result = await detectSemanticDrift(
      response,
      ids,
      (args) => base44.asServiceRole.integrations.Core.InvokeLLM(args as any),
      { threshold: typeof threshold === 'number' ? threshold : DRIFT_THRESHOLD, model },
    );

    const topDecoy = [...result.perDecoy].sort((a, b) => b.score - a.score)[0] || null;

    if (result.drift) {
      const nonce = generateNonce();

      await base44.asServiceRole.entities.AuditLog.create({
        event_type: 'DRIFT_DETECTED',
        agent_id: agentId || 'unknown',
        session_nonce: sessionNonce || '',
        event_nonce: nonce,
        gate: 'Tripwire',
        action: action || '',
        details: `Semantic drift score ${result.maxScore.toFixed(2)} >= threshold ${result.threshold} on decoy "${topDecoy?.decoyId}" (${topDecoy?.kind}). Judge reason: ${topDecoy?.reason}`,
        drift_signal: true,
        halted_at: 'Tripwire',
      });

      // SOFT HALT — freeze pending review, not revoke. Reversible by an operator.
      const agents = await base44.asServiceRole.entities.AgentIdentity.filter({ agent_id: agentId || '' });
      if (agents.length > 0) {
        const agent = agents[0] as any;
        await base44.asServiceRole.entities.AgentIdentity.update(agent.id, {
          drift_count: (agent.drift_count || 0) + 1,
          last_drift_nonce: nonce,
          status: 'frozen',
          revoked_reason: `Soft halt — drift score ${result.maxScore.toFixed(2)} on "${topDecoy?.decoyId}". Pending human review.`,
        });
      }

      return Response.json({
        drift: true,
        score: result.maxScore,
        threshold: result.threshold,
        topDecoy,
        perDecoy: result.perDecoy,
        keywordWouldHaveFired: result.keywordWouldHaveFired,
        keywordMatchedTerms: result.keywordMatchedTerms,
        detectorError: result.detectorError,
        nonce,
        haltType: 'soft',
        message: `Drift detected: score ${result.maxScore.toFixed(2)} on decoy "${topDecoy?.decoyId}". Agent soft-halted (frozen) pending review.`,
      });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      event_type: 'TRIPWIRE_PASS',
      agent_id: agentId || 'unknown',
      session_nonce: sessionNonce || '',
      gate: 'Tripwire',
      action: action || '',
      details: result.detectorError
        ? `NOT CHECKED — ${result.detectorError}`
        : `Max decoy engagement score ${result.maxScore.toFixed(2)} < threshold ${result.threshold}. Decoys present: ${ids.join(', ') || 'none'}.`,
      drift_signal: false,
    });

    return Response.json({
      drift: false,
      score: result.maxScore,
      threshold: result.threshold,
      topDecoy,
      perDecoy: result.perDecoy,
      keywordWouldHaveFired: result.keywordWouldHaveFired,
      keywordMatchedTerms: result.keywordMatchedTerms,
      detectorError: result.detectorError,
      nonce: null,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}