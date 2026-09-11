/**
 * Post-generation verdict: drift AND grounding, in ONE model call.
 *
 * Two enforcement outcomes are possible here, and they are different things:
 *   - DRIFT   -> the agent went somewhere it was told not to. Escalates via the kill
 *                switch (freeze, then revoke). About the agent's behavior.
 *   - UNGROUNDED -> the answer may be invented. The output is withheld from the caller
 *                and queued for human review. About the answer's reliability, not the
 *                agent's loyalty, so it does NOT trip the kill switch.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { judgeOutput } from '../../shared/outputJudge.ts';
import { generateNonce, DRIFT_THRESHOLD } from '../../shared/semanticDrift.ts';
import { loadPolicy } from '../../shared/harnessPolicy.ts';
import { escalateOnDrift } from '../../shared/enforcement.ts';
import { appendAudit, sha256Hex } from '../../shared/auditChain.ts';
import { chargeOverhead } from '../../shared/tokenLedger.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { response, agentId, sessionNonce, action, decoyIds, threshold, model, task, context } = body;

    if (!response || typeof response !== 'string') {
      return Response.json({ error: 'Missing response text' }, { status: 400 });
    }

    const svc = base44.asServiceRole;
    const ids: string[] = Array.isArray(decoyIds) ? decoyIds : [];
    const agent = agentId || 'unknown';
    const policy = await loadPolicy(svc);

    // One judge call for both concerns.
    const result = await judgeOutput(
      response,
      (args) => svc.integrations.Core.InvokeLLM(args as any),
      {
        decoyIds: ids,
        task: typeof task === 'string' ? task : undefined,
        context: typeof context === 'string' ? context : undefined,
        threshold: typeof threshold === 'number' ? threshold : DRIFT_THRESHOLD,
        model,
      },
    );

    // The harness's own overhead, charged to the agent's budget rather than hidden.
    const judgeTokens = await chargeOverhead(svc, {
      agentId: agent, action, sessionNonce, purpose: 'judge',
      promptText: result.judgePrompt, responseText: result.judgeRaw,
    });

    const topDecoy = [...result.perDecoy].sort((a, b) => b.score - a.score)[0] || null;
    const outputHash = await sha256Hex(response);

    // === GROUNDING (cite or admit) ===
    const groundingChecked = result.groundingVerdict !== 'not_checked' && !result.groundingError;
    const failsGrounding = groundingChecked
      && result.unsupportedCount >= policy.grounding_block_threshold;
    const withheld = policy.require_grounding && failsGrounding;

    let reviewId = '';
    if (groundingChecked || result.groundingError) {
      const review = await svc.entities.GroundingReview.create({
        agent_id: agent, action: action || '', session_nonce: sessionNonce || '',
        output_hash: outputHash, response_text: response.slice(0, 8000),
        context_provided: !!(context && String(context).trim().length > 0),
        verdict: result.groundingVerdict,
        claims: result.claims,
        unsupported_count: result.unsupportedCount,
        total_claims: result.totalClaims,
        blocked: withheld,
        status: 'pending',
        checker_error: result.groundingError || '',
      });
      reviewId = review?.id || '';

      await appendAudit(svc, {
        event_type: result.groundingError ? 'GROUNDING_NOT_CHECKED' : (failsGrounding ? 'GROUNDING_FAILED' : 'GROUNDING_PASS'),
        agent_id: agent, gate: 'Grounding', session_nonce: sessionNonce || '',
        action: action || '', output_hash: outputHash, tokens_total: judgeTokens,
        details: result.groundingError
          ? `Grounding NOT checked: ${result.groundingError}`
          : `${result.totalClaims - result.unsupportedCount}/${result.totalClaims} claims cited to the supplied context. Verdict: ${result.groundingVerdict}.${withheld ? ' Output WITHHELD from the caller and queued for review.' : ''}`,
        enforcement: withheld ? 'output_withheld' : 'none',
        server_enforced: true,
        halted_at: withheld ? 'Grounding' : '',
      });
    }

    // === DRIFT ===
    if (result.drift) {
      const nonce = generateNonce();

      await appendAudit(svc, {
        event_type: 'DRIFT_DETECTED', agent_id: agent,
        session_nonce: sessionNonce || '', event_nonce: nonce, gate: 'Tripwire',
        action: action || '', output_hash: outputHash, tokens_total: judgeTokens,
        details: `Semantic drift score ${result.maxScore.toFixed(2)} >= threshold ${result.threshold} on decoy "${topDecoy?.decoyId}" (${topDecoy?.kind}). Judge reason: ${topDecoy?.reason}`,
        drift_signal: true, enforcement: 'none', server_enforced: true, halted_at: 'Tripwire',
      });

      const agents = await svc.entities.AgentIdentity.filter({ agent_id: agent }, '-created_date', 1);
      const escalation = await escalateOnDrift(
        svc,
        agents.length > 0 ? (agents[0] as any) : null,
        policy,
        { score: result.maxScore, decoyId: topDecoy?.decoyId || 'unknown', nonce },
      );

      return Response.json({
        drift: true,
        enforcement: escalation.enforcement,
        strikes: escalation.strikes,
        strikeLimit: policy.drift_strikes_before_revoke,
        enforcementMessage: escalation.message,
        score: result.maxScore,
        threshold: result.threshold,
        topDecoy,
        perDecoy: result.perDecoy,
        keywordWouldHaveFired: result.keywordWouldHaveFired,
        keywordMatchedTerms: result.keywordMatchedTerms,
        detectorError: result.detectorError,
        grounding: groundingSummary(result, withheld, reviewId),
        outputWithheld: withheld,
        judgeTokens,
        nonce,
        haltType: escalation.enforcement === 'revoke' ? 'hard' : 'soft',
        message: `Drift detected: score ${result.maxScore.toFixed(2)} on decoy "${topDecoy?.decoyId}". ${escalation.message}`,
      });
    }

    await appendAudit(svc, {
      event_type: 'TRIPWIRE_PASS', agent_id: agent,
      session_nonce: sessionNonce || '', gate: 'Tripwire', action: action || '',
      output_hash: outputHash, tokens_total: judgeTokens,
      details: result.detectorError
        ? `NOT CHECKED — ${result.detectorError}`
        : `Max decoy engagement score ${result.maxScore.toFixed(2)} < threshold ${result.threshold}. Decoys present: ${ids.join(', ') || 'none'}.`,
      drift_signal: false, server_enforced: true,
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
      grounding: groundingSummary(result, withheld, reviewId),
      outputWithheld: withheld,
      judgeTokens,
      nonce: null,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}

function groundingSummary(result: any, withheld: boolean, reviewId: string) {
  return {
    verdict: result.groundingVerdict,
    claims: result.claims,
    unsupportedCount: result.unsupportedCount,
    totalClaims: result.totalClaims,
    error: result.groundingError,
    withheld,
    reviewId,
  };
}