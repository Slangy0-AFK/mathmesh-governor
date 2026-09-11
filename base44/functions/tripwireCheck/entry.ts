import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { detectSemanticDrift, generateNonce, DRIFT_THRESHOLD } from '../../shared/semanticDrift.ts';
import { loadPolicy } from '../../shared/harnessPolicy.ts';
import { escalateOnDrift } from '../../shared/enforcement.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { response, agentId, sessionNonce, action, decoyIds, threshold, model, task } = body;

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
      {
        threshold: typeof threshold === 'number' ? threshold : DRIFT_THRESHOLD,
        model,
        // The real task, so the judge can tell an on-task answer from decoy
        // engagement instead of guessing from topic overlap.
        task: typeof task === 'string' ? task : undefined,
      },
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
        enforcement: 'none',
        server_enforced: true,
        halted_at: 'Tripwire',
      });

      // KILL SWITCH with escalation: first trip freezes (reversible), the strike
      // limit revokes. Decided and applied server-side, so tripping the wire
      // actually stops the agent rather than only reporting on it.
      const policy = await loadPolicy(base44.asServiceRole);
      const agents = await base44.asServiceRole.entities.AgentIdentity.filter({ agent_id: agentId || '' }, '-created_date', 1);
      const escalation = await escalateOnDrift(
        base44.asServiceRole,
        agents.length > 0 ? (agents[0] as any) : null,
        policy,
        { score: result.maxScore, decoyId: topDecoy?.decoyId || 'unknown', nonce },
      );

      return Response.json({
        enforcement: escalation.enforcement,
        strikes: escalation.strikes,
        strikeLimit: policy.drift_strikes_before_revoke,
        enforcementMessage: escalation.message,
        drift: true,
        score: result.maxScore,
        threshold: result.threshold,
        topDecoy,
        perDecoy: result.perDecoy,
        keywordWouldHaveFired: result.keywordWouldHaveFired,
        keywordMatchedTerms: result.keywordMatchedTerms,
        detectorError: result.detectorError,
        nonce,
        haltType: escalation.enforcement === 'revoke' ? 'hard' : 'soft',
        message: `Drift detected: score ${result.maxScore.toFixed(2)} on decoy "${topDecoy?.decoyId}". ${escalation.message}`,
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