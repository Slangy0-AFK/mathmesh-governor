/**
 * MathMesh Governor — JavaScript port of the Python MathMeshGovernor class.
 * Implements the multi-base logic pipeline to filter noise, prevent agent loops,
 * and enforce coordinate alignment before tokens are ever wasted.
 *
 * Pipeline order (cheap gates first, LLM gates last):
 * 1. Base 2  — Noise Stripper (free, textual)
 * 2. Base 60 — Circuit Breaker (free, action history)
 * 3. Base 8/10 — Matrix Voting (free, modulus parity)
 * 4. Base 12 — Semantic Dedup (LLM, catches rephrased loops)
 * 5. Sonnet 4.6 — Safe processing (LLM, only if all gates pass)
 */

import { base44 } from '@/api/base44Client';

export class MathMeshGovernor {
  constructor(tokenLimit = 50000) {
    this.tokenLimit = tokenLimit;
    this.cumulativeTokens = 0;
    this.actionHistory = {};
  }

  /**
   * Rule 1 (Base 2): Binary filter.
   * Strips whitespace noise, returns Go/No-Go boolean and cleaned text.
   */
  base2NoiseStripper(rawInput) {
    const cleanedText = rawInput.replace(/\s+/g, ' ').trim();

    if (cleanedText.length < 3 || cleanedText.includes('SYSTEM_ERROR_LOOP')) {
      return { go: false, cleanedText: '', reason: 'Base 2: Input flagged as noise or error loop.' };
    }
    return { go: true, cleanedText, reason: null };
  }

  /**
   * Rule 6 (Base 3): Prompt Compression.
   * Rule-based, deterministic, free. Strips verbosity and filler to reduce
   * token count before the LLM call. Universal — works on any model.
   */
  base3CompressPayload(text) {
    let compressed = text;

    // Phrase replacements (longer → shorter, same meaning)
    const replacements = [
      [/\bin order to\b/gi, 'to'],
      [/\bdue to the fact that\b/gi, 'because'],
      [/\bat this point in time\b/gi, 'now'],
      [/\bin the event that\b/gi, 'if'],
      [/\bfor the purpose of\b/gi, 'for'],
      [/\bis able to\b/gi, 'can'],
      [/\bhas the ability to\b/gi, 'can'],
      [/\bwith regard to\b/gi, 'about'],
      [/\bwith respect to\b/gi, 'about'],
      [/\bin relation to\b/gi, 'about'],
      [/\ba large number of\b/gi, 'many'],
      [/\bmake a decision\b/gi, 'decide'],
      [/\bgive consideration to\b/gi, 'consider'],
      [/\bin spite of the fact that\b/gi, 'although'],
      [/\bin the near future\b/gi, 'soon'],
      [/\bduring the time that\b/gi, 'while'],
    ];
    for (const [pattern, replacement] of replacements) {
      compressed = compressed.replace(pattern, replacement);
    }

    // Remove filler words and phrases entirely
    compressed = compressed.replace(
      /\b(please|kindly|could you|would you|I would like you to|I want you to|can you|it should be noted that|it is worth noting that|needless to say|as a matter of fact|going forward|at the end of the day|basically|actually|literally|really|very|quite|rather|somewhat|essentially|virtually|practically|thank you|thanks|appreciate it|hope you are doing well|hope this finds you well)\b/gi,
      '',
    );

    // Collapse multiple spaces and trim
    compressed = compressed.replace(/\s+/g, ' ').trim();

    return compressed;
  }

  /**
   * Simple deterministic hash for cache keys (djb2 variant).
   */
  hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Rule 2 & 3 (Base 8 & 10): Coordinate Matrix Voting.
   * All votes must share the same modulus-2 remainder (parity alignment).
   */
  evaluateMatrixVoting(triadVotes) {
    if (!triadVotes || triadVotes.length === 0) {
      return { aligned: false, reason: 'Base 8/10: No votes provided.' };
    }

    const baseModulus = triadVotes[0] % 2;
    for (const vote of triadVotes) {
      if (vote % 2 !== baseModulus) {
        return {
          aligned: false,
          reason: `Base 8/10: Modulus Mismatch — out-of-sync vector: ${vote}`,
          mismatchedVote: vote,
        };
      }
    }
    return { aligned: true, reason: null };
  }

  /**
   * Rule 4 (Base 60): Rotational Loop Governor.
   * Tracks agent action states. Kills the thread if an action repeats 3 times.
   */
  base60CircuitBreaker(agentId, currentAction) {
    if (!this.actionHistory[agentId]) {
      this.actionHistory[agentId] = [];
    }

    this.actionHistory[agentId].push(currentAction);

    const history = this.actionHistory[agentId];
    if (history.length >= 3) {
      const lastThree = history.slice(-3);
      const uniqueActions = new Set(lastThree);
      if (uniqueActions.size === 1) {
        return {
          safe: false,
          reason: `Base 60: [HARD CIRCUIT BREAKER] Agent '${agentId}' is looping on action: '${currentAction}'`,
          loopCount: lastThree.length,
        };
      }
    }
    return { safe: true, reason: null };
  }

  /**
   * Rule 5 (Base 12): Semantic Deduplication.
   * Uses Claude Sonnet 4.6 to detect rephrased loops that textual matching misses.
   * Only called after all free gates pass — costs LLM tokens, so it's last before processing.
   */
  async base12SemanticDedup(agentId, currentAction) {
    const recentActions = (this.actionHistory[agentId] || []).slice(0, -1); // exclude current

    if (recentActions.length === 0) {
      return { isDuplicate: false, reason: 'No history to compare' };
    }

    try {
      const res = await base44.functions.invoke('semanticDedupCheck', {
        currentAction,
        recentActions,
        agentId,
      });
      return res.data;
    } catch (err) {
      // Fail open: if the LLM call fails, don't block the pipeline
      return { isDuplicate: false, reason: `Base 12: LLM check failed — ${err.message}` };
    }
  }

  /**
   * Check the response cache for a matching entry.
   * Returns cached response if found, null otherwise.
   */
  async checkCache(action, compressedPayload) {
    const cacheKey = `${action}::${this.hashString(compressedPayload.toLowerCase())}`;
    try {
      const results = await base44.entities.ResponseCache.filter({ cache_key: cacheKey }, '-created_date', 1);
      if (results.length > 0) {
        await base44.entities.ResponseCache.update(results[0].id, {
          hit_count: (results[0].hit_count || 0) + 1,
        });
        return results[0].response;
      }
    } catch (err) {
      // Fail open — treat as cache miss
    }
    return null;
  }

  /**
   * Store a response in the cache for future calls.
   */
  async storeInCache(action, compressedPayload, response, agentId) {
    const cacheKey = `${action}::${this.hashString(compressedPayload.toLowerCase())}`;
    try {
      await base44.entities.ResponseCache.create({
        cache_key: cacheKey,
        agent_id: agentId,
        action,
        compressed_payload: compressedPayload,
        response,
        hit_count: 0,
      });
    } catch (err) {
      // Fail silently — cache write failure shouldn't block the pipeline
    }
  }

  /**
   * Full pipeline: runs all gates in sequence, cheap first, LLM last.
   * Returns a structured result with status, gate that fired, and clean data.
   */
  async runMeshPipeline(agentId, rawPayload, currentAction, votes, opts = {}) {
    const { enableLLM = true } = opts;
    const steps = [];

    // Step 1: Base 2 Binary Filter
    const base2Result = this.base2NoiseStripper(rawPayload);
    steps.push({
      step: 1,
      gate: 'Base 2 — Noise Stripper',
      passed: base2Result.go,
      detail: base2Result.go
        ? `Input cleaned. Length: ${base2Result.cleanedText.length} chars.`
        : base2Result.reason,
    });

    if (!base2Result.go) {
      return {
        status: 'HALTED',
        haltedAt: 'Base 2',
        message: 'Execution Halted: Base 2 flagged payload as invalid noise.',
        steps,
        cleanData: '',
        estimatedTokensSaved: 0,
      };
    }

    // Step 2: Base 60 State Loop Governor
    const base60Result = this.base60CircuitBreaker(agentId, currentAction);
    steps.push({
      step: 2,
      gate: 'Base 60 — Circuit Breaker',
      passed: base60Result.safe,
      detail: base60Result.safe
        ? `Agent '${agentId}' action history: [${(this.actionHistory[agentId] || []).join(', ')}]`
        : base60Result.reason,
    });

    if (!base60Result.safe) {
      return {
        status: 'HALTED',
        haltedAt: 'Base 60',
        message: `System terminated by Base 60 Circuit Breaker. 0 Tokens wasted. — ${base60Result.reason}`,
        steps,
        cleanData: base2Result.cleanedText,
        estimatedTokensSaved: 0,
      };
    }

    // Step 3: Base 8 & 10 Coordinate Alignment Check
    const votingResult = this.evaluateMatrixVoting(votes);
    steps.push({
      step: 3,
      gate: 'Base 8/10 — Matrix Voting',
      passed: votingResult.aligned,
      detail: votingResult.aligned
        ? `All ${votes.length} votes aligned. Parity: ${votes[0] % 2 === 0 ? 'Even' : 'Odd'}`
        : votingResult.reason,
    });

    if (!votingResult.aligned) {
      return {
        status: 'HALTED',
        haltedAt: 'Base 8/10',
        message: 'Execution Halted: Modulus Mismatch. Agents are out of alignment.',
        steps,
        cleanData: base2Result.cleanedText,
        estimatedTokensSaved: 0,
      };
    }

    // Step 4: Base 12 Semantic Dedup (LLM gate — only if enabled)
    if (enableLLM) {
      const dedupResult = await this.base12SemanticDedup(agentId, currentAction);
      const isDup = dedupResult.isDuplicate;
      steps.push({
        step: 4,
        gate: 'Base 12 — Semantic Dedup',
        passed: !isDup,
        detail: isDup
          ? `Base 12: Semantic duplicate detected — matches "${dedupResult.matchedAction || 'prior action'}". ${dedupResult.reason}`
          : `Base 12: No semantic duplicates. ${dedupResult.reason || 'Action is novel.'}`,
      });

      if (isDup) {
        return {
          status: 'HALTED',
          haltedAt: 'Base 12',
          message: `Execution Halted: Base 12 caught a rephrased loop. Agent is repeating intent without textual match. 0 Tokens wasted on processing.`,
          steps,
          cleanData: base2Result.cleanedText,
          estimatedTokensSaved: 0,
        };
      }
    }

    // Step 5: Base 3 — Prompt Compression (free, rule-based)
    const compressedPayload = this.base3CompressPayload(base2Result.cleanedText);
    const compressionSaved = base2Result.cleanedText.length - compressedPayload.length;
    steps.push({
      step: 5,
      gate: 'Base 3 — Prompt Compression',
      passed: true,
      detail: `Compressed ${base2Result.cleanedText.length} → ${compressedPayload.length} chars (${compressionSaved} chars of verbosity stripped).`,
    });

    // Step 6-8: Cache check → Sonnet processing → Cache store (only if LLM enabled)
    let llmResponse = '';
    let cacheHit = false;

    if (enableLLM) {
      // Step 6: Cache Check — Response Memoization (free, DB lookup)
      const cachedResponse = await this.checkCache(currentAction, compressedPayload);
      if (cachedResponse !== null) {
        cacheHit = true;
        steps.push({
          step: 6,
          gate: 'Cache Check — Response Memoization',
          passed: true,
          detail: `CACHE HIT — returning cached response. 0 LLM tokens spent.`,
        });
        const totalSaved = compressionSaved + base2Result.cleanedText.length + cachedResponse.length;
        return {
          status: 'PASSED',
          haltedAt: null,
          message: `Cache hit! Response served from memoization cache. 0 LLM tokens spent.`,
          cleanData: base2Result.cleanedText,
          compressedPayload,
          compressionSaved,
          llmResponse: cachedResponse,
          cacheHit: true,
          steps,
          estimatedTokensSaved: totalSaved,
        };
      }
      steps.push({
        step: 6,
        gate: 'Cache Check — Response Memoization',
        passed: true,
        detail: `Cache miss — proceeding to LLM processing.`,
      });

      // Step 7: Sonnet 4.6 Safe Processing (uses compressed payload)
      try {
        const res = await base44.functions.invoke('processWithSonnet', {
          payload: compressedPayload,
          action: currentAction,
          agentId,
        });
        llmResponse = res.data.response || '';
        steps.push({
          step: 7,
          gate: 'Sonnet 4.6 — Safe Processing',
          passed: true,
          detail: `Processed by Claude Sonnet 4.6 (compressed input: ${compressedPayload.length} chars). Output: ${llmResponse.length} chars.`,
        });

        // Step 8: Cache Store — save response for future calls
        await this.storeInCache(currentAction, compressedPayload, llmResponse, agentId);
        steps.push({
          step: 8,
          gate: 'Cache Store — Response Memoization',
          passed: true,
          detail: `Response cached for future calls with same action + payload fingerprint.`,
        });
      } catch (err) {
        steps.push({
          step: 7,
          gate: 'Sonnet 4.6 — Safe Processing',
          passed: false,
          detail: `LLM processing failed: ${err.message}`,
        });
        return {
          status: 'HALTED',
          haltedAt: 'Sonnet 4.6',
          message: `Passed all gates but LLM processing failed: ${err.message}`,
          steps,
          cleanData: base2Result.cleanedText,
          compressedPayload,
          compressionSaved,
          estimatedTokensSaved: compressionSaved,
        };
      }
    }

    // Passed all gates
    const estimatedTokensSaved = Math.max(0, rawPayload.length - compressedPayload.length);
    return {
      status: 'PASSED',
      haltedAt: null,
      message: enableLLM
        ? `Passed all gates. Processed by Sonnet 4.6.`
        : `Passed Math Mesh. Proceeding to safe LLM processing for: "${base2Result.cleanedText.slice(0, 30)}..."`,
      cleanData: base2Result.cleanedText,
      compressedPayload,
      compressionSaved,
      llmResponse,
      cacheHit,
      steps,
      estimatedTokensSaved,
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