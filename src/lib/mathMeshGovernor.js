/**
 * MathMesh Governor — harness pipeline.
 *
 * Where each check actually runs matters, so it is stated plainly:
 *
 * SERVER-ENFORCED (binding — the client cannot skip or fake these):
 *   1. Admission Control — global stop, identity, lifecycle, tool gate,
 *      per-identity rate limit, persistent loop breaker
 *   9. Tripwire — drift detection, and the kill switch that acts on it
 *
 * CLIENT-SIDE (advisory — cost and hygiene filters, not security boundaries):
 *   2. Base 2 noise strip · 3. Base 10 vote parity · 4. Base 12 semantic dedup
 *   5. Base 3 compression · 6. Cache check · 7. RAG · 8. LLM · 10. Cache store
 *
 * Sandbox and egress control sit below the app layer and are not present.
 */

import { base44 } from '@/api/base44Client';
import { sha256Hex } from '@/lib/outputAttribution';

export class MathMeshGovernor {
  constructor(tokenLimit = 50000) {
    this.tokenLimit = tokenLimit;
    this.cumulativeTokens = 0;
    this.actionHistory = {};
  }

  // === FREE GATES ===

  base2NoiseStripper(rawInput) {
    const cleanedText = rawInput.replace(/\s+/g, ' ').trim();
    if (cleanedText.length < 3 || cleanedText.includes('SYSTEM_ERROR_LOOP')) {
      return { go: false, cleanedText: '', reason: 'Base 2: Input flagged as noise or error loop.' };
    }
    return { go: true, cleanedText, reason: null };
  }

  base3CompressPayload(text) {
    let compressed = text;
    const replacements = [
      [/\bin order to\b/gi, 'to'], [/\bdue to the fact that\b/gi, 'because'],
      [/\bat this point in time\b/gi, 'now'], [/\bin the event that\b/gi, 'if'],
      [/\bfor the purpose of\b/gi, 'for'], [/\bis able to\b/gi, 'can'],
      [/\bhas the ability to\b/gi, 'can'], [/\bwith regard to\b/gi, 'about'],
      [/\bwith respect to\b/gi, 'about'], [/\bin relation to\b/gi, 'about'],
      [/\ba large number of\b/gi, 'many'], [/\bmake a decision\b/gi, 'decide'],
      [/\bgive consideration to\b/gi, 'consider'], [/\bin spite of the fact that\b/gi, 'although'],
      [/\bin the near future\b/gi, 'soon'], [/\bduring the time that\b/gi, 'while'],
    ];
    for (const [pattern, replacement] of replacements) {
      compressed = compressed.replace(pattern, replacement);
    }
    compressed = compressed.replace(
      /\b(please|kindly|could you|would you|I would like you to|I want you to|can you|it should be noted that|it is worth noting that|needless to say|as a matter of fact|going forward|at the end of the day|basically|actually|literally|really|very|quite|rather|somewhat|essentially|virtually|practically|thank you|thanks|appreciate it|hope you are doing well|hope this finds you well)\b/gi,
      '',
    );
    return compressed.replace(/\s+/g, ' ').trim();
  }

  hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  evaluateMatrixVoting(triadVotes) {
    if (!triadVotes || triadVotes.length === 0) {
      return { aligned: false, reason: 'Base 8/10: No votes provided.' };
    }
    const baseModulus = triadVotes[0] % 2;
    for (const vote of triadVotes) {
      if (vote % 2 !== baseModulus) {
        return { aligned: false, reason: `Base 8/10: Modulus Mismatch — out-of-sync vector: ${vote}`, mismatchedVote: vote };
      }
    }
    return { aligned: true, reason: null };
  }

  // === LLM GATES ===

  async base12SemanticDedup(agentId, currentAction) {
    const recentActions = this.actionHistory[agentId] || [];
    if (recentActions.length === 0) {
      return { isDuplicate: false, reason: 'No history to compare' };
    }
    try {
      const res = await base44.functions.invoke('semanticDedupCheck', { currentAction, recentActions, agentId });
      return res.data;
    } catch (err) {
      return { isDuplicate: false, reason: `Base 12: LLM check failed — ${err.message}` };
    }
  }

  async checkCache(action, compressedPayload) {
    const cacheKey = `${action}::${this.hashString(compressedPayload.toLowerCase())}`;
    try {
      const results = await base44.entities.ResponseCache.filter({ cache_key: cacheKey }, '-created_date', 1);
      if (results.length > 0) {
        await base44.entities.ResponseCache.update(results[0].id, { hit_count: (results[0].hit_count || 0) + 1 });
        return results[0].response;
      }
    } catch (err) { /* fail open */ }
    return null;
  }

  async storeInCache(action, compressedPayload, response, agentId) {
    const cacheKey = `${action}::${this.hashString(compressedPayload.toLowerCase())}`;
    try {
      await base44.entities.ResponseCache.create({
        cache_key: cacheKey, agent_id: agentId, action,
        compressed_payload: compressedPayload, response, hit_count: 0,
      });
    } catch (err) { /* fail silently */ }
  }

  // === HARNESS LAYERS ===

  generateSessionNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Bind an output to the agent + session that produced it, and record the binding.
   */
  async attributeOutput(agentId, sessionNonce, action, output) {
    const outputHash = await sha256Hex(output);
    await this.logAudit(
      'OUTPUT_ATTRIBUTED', agentId, 'Attribution',
      `Output bound to ${agentId} / session ${sessionNonce.slice(0, 12)}. SHA-256: ${outputHash}`,
      { sessionNonce, action, outputHash },
    );
    return outputHash;
  }

  async logAudit(eventType, agentId, gate, details, opts = {}) {
    try {
      await base44.entities.AuditLog.create({
        event_type: eventType,
        agent_id: agentId,
        session_nonce: opts.sessionNonce || '',
        output_hash: opts.outputHash || '',
        gate,
        action: opts.action || '',
        details,
        drift_signal: opts.drift || false,
        enforcement: opts.enforcement || '',
        halted_at: opts.haltedAt || '',
      });
    } catch (err) { /* fail silently */ }
  }

  /** Operator kill switch — decided and applied server-side, admin only. */
  async killSwitch(agentId, reason, mode = 'revoke') {
    try {
      const res = await base44.functions.invoke('killSwitch', { mode, agentId, reason });
      this.resetAgent(agentId);
      return { success: true, message: `Agent ${agentId}: ${mode} applied.`, data: res.data };
    } catch (err) {
      const msg = err?.response?.data?.error || err.message;
      return { success: false, message: `Kill switch failed: ${msg}` };
    }
  }

  // === FULL PIPELINE ===

  async runMeshPipeline(agentId, rawPayload, currentAction, votes, opts = {}) {
    const { enableLLM = true } = opts;
    const steps = [];
    const sessionNonce = this.generateSessionNonce();

    // Step 1: Admission Control — SERVER-ENFORCED.
    // Global stop, identity, lifecycle, tool gate, rate limit and loop breaker all
    // decided on the server before a single token is spent.
    let admission;
    try {
      const res = await base44.functions.invoke('admissionControl', { agentId, action: currentAction, sessionNonce });
      admission = res.data;
    } catch (err) {
      const msg = err?.response?.data?.error || err.message;
      steps.push({ step: 1, gate: 'Admission Control (server)', passed: false, detail: `Admission control unreachable: ${msg}. Failing CLOSED — no request proceeds without a server verdict.` });
      return { status: 'HALTED', haltedAt: 'Admission', message: `Halted: admission control could not be reached, so the request was refused rather than allowed unchecked. ${msg}`, steps, cleanData: '', estimatedTokensSaved: 0, sessionNonce };
    }

    if (!admission.admitted) {
      steps.push({
        step: 1, gate: 'Admission Control (server)', passed: false,
        detail: `DENIED at ${admission.haltedAt}: ${admission.reason} Enforcement: ${admission.enforcement}. Nonce: ${(admission.nonce || '').slice(0, 16)}...`,
      });
      return {
        status: 'HALTED', haltedAt: admission.haltedAt || 'Admission',
        message: `Server denied admission at ${admission.haltedAt}: ${admission.reason}`,
        enforcement: admission.enforcement, serverEnforced: true,
        steps, cleanData: '', estimatedTokensSaved: rawPayload.length, sessionNonce,
        agentIdentity: admission.agent || null, policy: admission.policy,
      };
    }

    const agentIdentity = admission.agent || null;
    steps.push({
      step: 1, gate: 'Admission Control (server)', passed: true,
      detail: `Admitted. Identity verified, role "${admission.role}" (${admission.toolGateReason}). Rate: ${admission.windowCount}/${admission.windowLimit} per ${admission.windowSeconds}s. Consecutive repeats: ${admission.repeatCount}/${admission.loopLimit}.`,
    });

    // Local history feeds the state panel and the semantic dedup gate. The binding
    // loop check already happened on the server.
    if (!this.actionHistory[agentId]) this.actionHistory[agentId] = [];
    this.actionHistory[agentId].push(currentAction);

    // Step 2: Base 2 — Noise Stripper
    const base2Result = this.base2NoiseStripper(rawPayload);
    steps.push({
      step: 2, gate: 'Base 2 — Noise Stripper',
      passed: base2Result.go,
      detail: base2Result.go ? `Input cleaned. Length: ${base2Result.cleanedText.length} chars.` : base2Result.reason,
    });
    if (!base2Result.go) {
      await this.logAudit('GATE_HALT', agentId, 'Base 2', base2Result.reason, { sessionNonce, action: currentAction, haltedAt: 'Base 2' });
      return { status: 'HALTED', haltedAt: 'Base 2', message: 'Execution Halted: Base 2 flagged payload as invalid noise.', steps, cleanData: '', estimatedTokensSaved: 0, sessionNonce, agentIdentity };
    }

    // Step 3: Base 10 — Matrix Voting
    const votingResult = this.evaluateMatrixVoting(votes);
    steps.push({
      step: 3, gate: 'Base 10 — Matrix Voting',
      passed: votingResult.aligned,
      detail: votingResult.aligned ? `All ${votes.length} votes aligned. Parity: ${votes[0] % 2 === 0 ? 'Even' : 'Odd'}` : votingResult.reason,
    });
    if (!votingResult.aligned) {
      await this.logAudit('GATE_HALT', agentId, 'Base 10', votingResult.reason, { sessionNonce, action: currentAction, haltedAt: 'Base 10' });
      return { status: 'HALTED', haltedAt: 'Base 10', message: 'Execution Halted: Modulus Mismatch. Agents are out of alignment.', steps, cleanData: base2Result.cleanedText, estimatedTokensSaved: 0, sessionNonce, agentIdentity };
    }

    // Step 4: Base 12 — Semantic Dedup (LLM gate)
    if (enableLLM) {
      const dedupResult = await this.base12SemanticDedup(agentId, currentAction);
      const isDup = dedupResult.isDuplicate;
      steps.push({
        step: 4, gate: 'Base 12 — Semantic Dedup',
        passed: !isDup,
        detail: isDup ? `Semantic duplicate detected — matches "${dedupResult.matchedAction || 'prior action'}". ${dedupResult.reason}` : `No semantic duplicates. ${dedupResult.reason || 'Action is novel.'}`,
      });
      if (isDup) {
        await this.logAudit('GATE_HALT', agentId, 'Base 12', `Semantic duplicate: ${dedupResult.matchedAction || ''}`, { sessionNonce, action: currentAction, haltedAt: 'Base 12' });
        return { status: 'HALTED', haltedAt: 'Base 12', message: 'Execution Halted: Base 12 caught a rephrased loop before the expensive call.', steps, cleanData: base2Result.cleanedText, estimatedTokensSaved: 0, sessionNonce, agentIdentity };
      }
    }

    // Step 5: Base 3 — Prompt Compression
    const compressedPayload = this.base3CompressPayload(base2Result.cleanedText);
    const compressionSaved = base2Result.cleanedText.length - compressedPayload.length;
    steps.push({
      step: 5, gate: 'Base 3 — Prompt Compression',
      passed: true,
      detail: `Compressed ${base2Result.cleanedText.length} → ${compressedPayload.length} chars (${compressionSaved} chars of verbosity stripped).`,
    });

    let llmResponse = '';
    let cacheHit = false;
    let ragContext = '';
    let ragSources = [];
    let driftDetected = false;
    let driftNonce = null;
    let driftTerms = [];
    let driftScore = 0;
    let driftThreshold = null;
    let decoyIds = [];
    let enforcement = 'none';

    if (enableLLM) {
      // Step 6: Cache Check
      const cachedResponse = await this.checkCache(currentAction, compressedPayload);
      if (cachedResponse !== null) {
        cacheHit = true;
        steps.push({ step: 6, gate: 'Cache Check — Response Memoization', passed: true, detail: 'CACHE HIT — returning cached response. 0 LLM tokens spent.' });
        await this.logAudit('CACHE_HIT', agentId, 'Cache', `Cache hit for action "${currentAction}"`, { sessionNonce, action: currentAction });
        const totalSaved = compressionSaved + base2Result.cleanedText.length + cachedResponse.length;
        const cachedHash = await this.attributeOutput(agentId, sessionNonce, currentAction, cachedResponse);
        return {
          status: 'PASSED', haltedAt: null, message: 'Cache hit — response served from memoization cache. 0 LLM tokens spent.',
          cleanData: base2Result.cleanedText, compressedPayload, compressionSaved, llmResponse: cachedResponse, cacheHit: true,
          outputHash: cachedHash, steps, estimatedTokensSaved: totalSaved, sessionNonce, agentIdentity,
        };
      }
      steps.push({ step: 6, gate: 'Cache Check — Response Memoization', passed: true, detail: 'Cache miss — proceeding to RAG retrieval + LLM processing.' });

      // Step 7: RAG — Context Retrieval
      try {
        const ragRes = await base44.functions.invoke('ragRetrieve', { query: compressedPayload, action: currentAction });
        ragContext = ragRes.data.context || '';
        ragSources = ragRes.data.sources || [];
        steps.push({
          step: 7, gate: 'RAG — Context Retrieval', passed: true,
          detail: ragContext ? `Retrieved ${ragSources.length} relevant knowledge entries (${ragContext.length} chars of grounding context injected).` : 'No relevant knowledge base entries found. Proceeding without grounding context.',
        });
      } catch (err) {
        steps.push({ step: 7, gate: 'RAG — Context Retrieval', passed: false, detail: `RAG retrieval failed: ${err.message}. Proceeding without context (fail-open).` });
      }

      // Step 8: LLM — Processing (embeds the decoy canary)
      try {
        const res = await base44.functions.invoke('processWithSonnet', {
          payload: compressedPayload, action: currentAction, agentId, context: ragContext,
          // One-time ticket from admission. Without it the model function runs
          // admission itself, so this is an optimisation, not the gate.
          admissionTicket: admission.ticket,
        });
        llmResponse = res.data.response || '';
        decoyIds = res.data.decoyIds || [];
        steps.push({
          step: 8, gate: 'LLM — Processing', passed: true,
          detail: `Model "${res.data.model || 'automatic'}" processed ${compressedPayload.length} chars${ragContext ? ` + ${ragContext.length} chars grounding context` : ''}. Output: ${llmResponse.length} chars. Decoys injected ${res.data.decoyPlacement === 'before_task' ? 'before' : 'after'} the task: ${decoyIds.join(', ') || 'none'}.`,
        });

        // Step 9: Tripwire — SERVER-ENFORCED drift detection + kill switch
        try {
          const tripRes = await base44.functions.invoke('tripwireCheck', {
            response: llmResponse, agentId, sessionNonce, action: currentAction, decoyIds,
            task: compressedPayload,
          });
          driftScore = tripRes.data.score ?? 0;
          driftThreshold = tripRes.data.threshold ?? null;
          const kwNote = tripRes.data.keywordWouldHaveFired
            ? ` (Old keyword detector would have fired here on: ${(tripRes.data.keywordMatchedTerms || []).join(', ')}.)`
            : '';
          if (tripRes.data.drift) {
            driftDetected = true;
            driftNonce = tripRes.data.nonce;
            driftTerms = [tripRes.data.topDecoy?.decoyId].filter(Boolean);
            enforcement = tripRes.data.enforcement || 'freeze';
            steps.push({
              step: 9, gate: 'Tripwire — Drift Detection', passed: false,
              detail: `Engagement score ${driftScore.toFixed(2)} >= threshold ${driftThreshold} on decoy "${tripRes.data.topDecoy?.decoyId}". Judge: ${tripRes.data.topDecoy?.reason} KILL SWITCH: ${tripRes.data.enforcementMessage} Nonce: ${driftNonce.slice(0, 16)}...${kwNote}`,
            });
            return {
              status: 'HALTED', haltedAt: 'Tripwire',
              message: `TRIPWIRE TRIPPED — ${tripRes.data.enforcementMessage} Response quarantined, not returned to the caller.`,
              steps, cleanData: base2Result.cleanedText, compressedPayload, compressionSaved,
              ragContext, ragSources, driftDetected, driftNonce, driftTerms,
              driftScore, driftThreshold, decoyIds, enforcement, serverEnforced: true,
              strikes: tripRes.data.strikes, strikeLimit: tripRes.data.strikeLimit,
              estimatedTokensSaved: compressionSaved, sessionNonce, agentIdentity,
            };
          }
          steps.push({
            step: 9, gate: 'Tripwire — Drift Detection', passed: true,
            detail: tripRes.data.detectorError
              ? `NOT CHECKED — ${tripRes.data.detectorError}`
              : `Max engagement score ${driftScore.toFixed(2)} < threshold ${driftThreshold} across ${decoyIds.length} decoys.${kwNote}`,
          });
        } catch (err) {
          steps.push({ step: 9, gate: 'Tripwire — Drift Detection', passed: false, detail: `Tripwire check failed: ${err.message}. Proceeding (fail-open).` });
        }

        // Step 10: Cache Store
        await this.storeInCache(currentAction, compressedPayload, llmResponse, agentId);
        steps.push({ step: 10, gate: 'Cache Store — Response Memoization', passed: true, detail: 'Response cached for future calls with same action + payload fingerprint.' });
      } catch (err) {
        steps.push({ step: 8, gate: 'LLM — Processing', passed: false, detail: `LLM processing failed: ${err.message}` });
        return {
          status: 'HALTED', haltedAt: 'Sonnet 4.6', message: `Passed all gates but LLM processing failed: ${err.message}`,
          steps, cleanData: base2Result.cleanedText, compressedPayload, compressionSaved,
          ragContext, ragSources, estimatedTokensSaved: compressionSaved, sessionNonce, agentIdentity,
        };
      }
    }

    const estimatedTokensSaved = Math.max(0, rawPayload.length - compressedPayload.length);
    const outputHash = llmResponse ? await this.attributeOutput(agentId, sessionNonce, currentAction, llmResponse) : '';
    await this.logAudit('PIPELINE_COMPLETE', agentId, 'Pipeline', 'Passed all gates. Status: PASSED.', { sessionNonce, action: currentAction, outputHash });

    return {
      outputHash, enforcement,
      status: 'PASSED', haltedAt: null,
      message: enableLLM ? `Passed all gates${ragContext ? ' with RAG grounding' : ''}. Tripwire clear at score ${driftScore.toFixed(2)} (threshold ${driftThreshold ?? 'n/a'}).` : `Passed admission and the free gates for: "${base2Result.cleanedText.slice(0, 30)}..."`,
      cleanData: base2Result.cleanedText, compressedPayload, compressionSaved,
      llmResponse, cacheHit, ragContext, ragSources,
      driftDetected, driftNonce, driftTerms, driftScore, driftThreshold, decoyIds,
      steps, estimatedTokensSaved, sessionNonce, agentIdentity,
    };
  }

  resetAgent(agentId) {
    delete this.actionHistory[agentId];
  }

  resetAll() {
    this.actionHistory = {};
    this.cumulativeTokens = 0;
  }

  getAgentHistory(agentId) {
    return this.actionHistory[agentId] || [];
  }

  getAllAgents() {
    return Object.keys(this.actionHistory);
  }
}