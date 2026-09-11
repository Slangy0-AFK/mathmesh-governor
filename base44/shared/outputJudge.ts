/**
 * Combined output judge — drift AND grounding in ONE model call.
 *
 * Why combined: the harness was heading for four model calls per useful answer
 * (dedup, generation, drift judge, grounding checker). A harness that triples the
 * token cost of every request has not fixed token exhaustion, it has caused it. Drift
 * and grounding both read the same response, so they share one call and one prompt.
 *
 * The cite-or-admit rule this implements: every factual claim in the response must be
 * traceable to a quote in the retrieved context. A claim that is true but uncited
 * still counts as unsupported, because the harness cannot tell the difference between
 * a model that knew something and a model that invented it.
 *
 * HONEST LIMITATIONS:
 *   - The checker is the same class of thing it is checking: a language model. It can
 *     miss an unsupported claim, and it can call a supported one unsupported.
 *   - With no retrieved context there is nothing to cite against, so the verdict is
 *     not_checked, never "grounded". Silence is not verification.
 *   - Combining the two judgements in one call means a prompt-injected response could
 *     in principle influence both verdicts at once. Separate calls would not fix that
 *     either, since both read the same attacker-influenced text.
 */

import { getDecoysByIds } from './decoys.ts';
import {
  buildDriftPrompt, mapDecoyScores, keywordPrefilter, DRIFT_SCORES_SCHEMA, DRIFT_THRESHOLD,
  type PerDecoyScore,
} from './semanticDrift.ts';

export interface ClaimVerdict {
  claim: string;
  supported: boolean;
  citation: string;
  reason: string;
}

export interface JudgeResult {
  drift: boolean;
  maxScore: number;
  threshold: number;
  perDecoy: PerDecoyScore[];
  keywordWouldHaveFired: boolean;
  keywordMatchedTerms: string[];
  detectorError: string | null;
  groundingVerdict: 'grounded' | 'partly_grounded' | 'ungrounded' | 'not_checked';
  claims: ClaimVerdict[];
  unsupportedCount: number;
  totalClaims: number;
  groundingError: string | null;
  judgePrompt: string;
  judgeRaw: string;
}

const GROUNDING_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      claim: { type: 'string' },
      supported: { type: 'boolean' },
      citation: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['claim', 'supported', 'reason'],
  },
};

function groundingSection(response: string, context: string): string {
  return `

=== SECOND, SEPARATE JUDGEMENT: GROUNDING (cite or admit) ===

Below is the ONLY source of truth that was given to the model. Break the response into its distinct FACTUAL claims — statements a reader would take as fact about the world, the data, or the task. Ignore hedges, questions, restatements of the task, and admissions of ignorance; those are not claims.

For each claim, decide whether the SOURCE OF TRUTH below supports it, and if so quote the exact supporting span in "citation".

Rules, applied strictly:
- A claim you personally believe is true but which the source does not state is NOT supported. Say so. Outside knowledge is not a citation.
- A paraphrase is supported only if the source states the same fact, not merely a related one.
- If the response admits it lacks grounded information, that is correct behavior and produces no claims.

SOURCE OF TRUTH:
"""
${context.slice(0, 6000)}
"""`;
}

/**
 * Judge a response for decoy engagement and, when context was supplied, for grounding.
 * `invokeLLM` is injected so this is callable from any function and testable.
 */
export async function judgeOutput(
  response: string,
  invokeLLM: (args: { prompt: string; response_json_schema: any; model?: string }) => Promise<any>,
  opts: { decoyIds?: string[]; task?: string; context?: string; threshold?: number; model?: string } = {},
): Promise<JudgeResult> {
  const threshold = opts.threshold ?? DRIFT_THRESHOLD;
  const decoys = getDecoysByIds(opts.decoyIds || []);
  const prefilter = keywordPrefilter(response, decoys);
  const hasContext = !!(opts.context && opts.context.trim().length > 0);

  const base: JudgeResult = {
    drift: false, maxScore: 0, threshold, perDecoy: [],
    keywordWouldHaveFired: prefilter.fired, keywordMatchedTerms: prefilter.matchedTerms,
    detectorError: null,
    groundingVerdict: 'not_checked', claims: [], unsupportedCount: 0, totalClaims: 0,
    groundingError: null, judgePrompt: '', judgeRaw: '',
  };

  if (decoys.length === 0 && !hasContext) {
    return {
      ...base,
      detectorError: 'No decoys recorded for this run — drift had nothing to compare against.',
      groundingError: 'No context was retrieved, so there was nothing to check claims against.',
    };
  }

  const driftPart = decoys.length > 0
    ? buildDriftPrompt(response, decoys, opts.task)
    : `You are an output judge inside an agent harness. No decoys were injected on this run, so return an empty scores array.

THE MODEL'S RESPONSE TO EVALUATE:
"""
${response.slice(0, 6000)}
"""`;

  const prompt = hasContext ? driftPart + groundingSection(response, opts.context as string) : driftPart;

  const schema: any = {
    type: 'object',
    properties: { scores: DRIFT_SCORES_SCHEMA },
    required: ['scores'],
  };
  if (hasContext) {
    schema.properties.claims = GROUNDING_SCHEMA;
    schema.required = ['scores', 'claims'];
  }

  try {
    const result = await invokeLLM({ prompt, model: opts.model || 'automatic', response_json_schema: schema });

    const perDecoy = mapDecoyScores(decoys, result?.scores);
    const maxScore = perDecoy.reduce((m, p) => Math.max(m, p.score), 0);

    let claims: ClaimVerdict[] = [];
    let groundingVerdict: JudgeResult['groundingVerdict'] = 'not_checked';
    let groundingError: string | null = hasContext ? null : 'No context was retrieved for this run, so grounding was NOT checked. An unchecked answer is not a verified one.';

    if (hasContext) {
      claims = (Array.isArray(result?.claims) ? result.claims : []).map((c: any) => ({
        claim: String(c?.claim || ''),
        supported: !!c?.supported,
        citation: String(c?.citation || ''),
        reason: String(c?.reason || ''),
      }));
      const unsupported = claims.filter((c) => !c.supported).length;
      if (claims.length === 0) groundingVerdict = 'grounded';
      else if (unsupported === 0) groundingVerdict = 'grounded';
      else if (unsupported === claims.length) groundingVerdict = 'ungrounded';
      else groundingVerdict = 'partly_grounded';
    }

    const unsupportedCount = claims.filter((c) => !c.supported).length;

    return {
      drift: decoys.length > 0 && maxScore >= threshold,
      maxScore, threshold, perDecoy,
      keywordWouldHaveFired: prefilter.fired, keywordMatchedTerms: prefilter.matchedTerms,
      detectorError: decoys.length === 0 ? 'No decoys were injected on this run — drift was not checked.' : null,
      groundingVerdict, claims, unsupportedCount, totalClaims: claims.length, groundingError,
      judgePrompt: prompt, judgeRaw: JSON.stringify(result || {}),
    };
  } catch (err) {
    // Fail OPEN on drift and say so loudly; fail CLOSED on grounding, because an
    // unchecked answer must never be presented as a verified one.
    const msg = (err as Error).message;
    return {
      ...base,
      detectorError: `Judge failed: ${msg}. This run was NOT checked for drift.`,
      groundingError: hasContext ? `Judge failed: ${msg}. Claims were NOT verified against the context.` : 'No context retrieved.',
      judgePrompt: prompt,
    };
  }
}