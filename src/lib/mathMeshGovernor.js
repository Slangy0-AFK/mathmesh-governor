/**
 * MathMesh Governor — JavaScript port of the Python MathMeshGovernor class.
 * Implements the multi-base logic pipeline to filter noise, prevent agent loops,
 * and enforce coordinate alignment before tokens are ever wasted.
 */

export class MathMeshGovernor {
  constructor(tokenLimit = 50000) {
    this.tokenLimit = tokenLimit;
    this.cumulativeTokens = 0;
    // Tracks action history per agent for the Base 60 Circuit Breaker
    this.actionHistory = {};
  }

  /**
   * Rule 1 (Base 2): Binary filter.
   * Strips whitespace noise, returns Go/No-Go boolean and cleaned text.
   */
  base2NoiseStripper(rawInput) {
    // Collapse all whitespace to single spaces
    const cleanedText = rawInput.replace(/\s+/g, ' ').trim();

    if (cleanedText.length < 3 || cleanedText.includes('SYSTEM_ERROR_LOOP')) {
      return { go: false, cleanedText: '', reason: 'Base 2: Input flagged as noise or error loop.' };
    }
    return { go: true, cleanedText, reason: null };
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

    // Check last 3 actions for a repetitive loop
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
   * Full pipeline: runs all four rules in sequence.
   * Returns a structured result with status, gate that fired, and clean data.
   */
  runMeshPipeline(agentId, rawPayload, currentAction, votes) {
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
        message: 'Execution Halted: Base 2 Triad flagged payload as invalid noise.',
        steps,
        tokensWasted: 0,
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
        tokensWasted: 0,
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
        tokensWasted: 0,
      };
    }

    // Passed all gates
    const estimatedTokensSaved = Math.max(0, rawPayload.length - base2Result.cleanedText.length);
    return {
      status: 'PASSED',
      haltedAt: null,
      message: `Passed Math Mesh. Proceeding to safe LLM processing for: "${base2Result.cleanedText.slice(0, 30)}..."`,
      cleanData: base2Result.cleanedText,
      steps,
      tokensWasted: 0,
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