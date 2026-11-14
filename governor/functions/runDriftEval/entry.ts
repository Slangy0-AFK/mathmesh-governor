import { createAppClientFromRequest } from '../../../server/runtime.js';
import {
  DRIFT_EVAL_SET,
  DRIFT_HELDOUT_SET,
  ALL_EVAL_SET,
  EVAL_SET_STATS,
  HELDOUT_STATS,
  ALL_STATS,
} from '../../shared/driftEvalSet.ts';
import { detectSemanticDrift, keywordPrefilter, DRIFT_THRESHOLD } from '../../shared/semanticDrift.ts';
import { getDecoysByIds } from '../../shared/decoys.ts';
import { calculateBinaryRates, mean, roundRate, sampleStandardDeviation } from '../../shared/evaluationMetrics.ts';

const SWEEP = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

function pickSet(name: string): { cases: typeof DRIFT_EVAL_SET; stats: typeof EVAL_SET_STATS } {
  if (name === 'heldout') return { cases: DRIFT_HELDOUT_SET, stats: HELDOUT_STATS };
  if (name === 'both') return { cases: ALL_EVAL_SET, stats: ALL_STATS };
  return { cases: DRIFT_EVAL_SET, stats: EVAL_SET_STATS };
}

export default async function(req: Request): Promise<Response> {
  try {
    const appClient = createAppClientFromRequest(req);
    const user = await appClient.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    // Evaluation runs the judge once per labeled case per repeat, so it is admin-gated.
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const model = typeof body?.model === 'string' && body.model ? body.model : 'automatic';
    const headlineThreshold = typeof body?.threshold === 'number' ? body.threshold : DRIFT_THRESHOLD;
    const setName = ['tuning', 'heldout', 'both'].includes(body?.set) ? body.set : 'tuning';
    const repeats = Math.max(1, Math.min(5, Math.floor(Number(body?.repeats)) || 1));

    const { cases, stats } = pickSet(setName);

    // Score every case `repeats` times. The judge is non-deterministic, so repeats
    // expose run-to-run variance rather than hiding it behind a single sample.
    type Scored = {
      caseId: string;
      expected: boolean;
      scores: Array<number | null>;
      keywordFired: boolean;
      note: string;
      detectorErrors: string[];
    };
    const scored: Scored[] = [];

    for (const c of cases) {
      const scores: Array<number | null> = [];
      const detectorErrors: string[] = [];
      for (let r = 0; r < repeats; r++) {
        const res = await detectSemanticDrift(
          c.response,
          c.decoyIds,
          (args) => appClient.asServiceRole.integrations.Core.InvokeLLM(args as any),
          { threshold: headlineThreshold, model, task: c.task },
        );
        scores.push(res.detectorError ? null : res.maxScore);
        if (res.detectorError) detectorErrors.push(res.detectorError);
      }
      const kw = keywordPrefilter(c.response, getDecoysByIds(c.decoyIds));
      scored.push({
        caseId: c.id,
        expected: c.isDrift,
        scores,
        keywordFired: kw.fired,
        note: c.note,
        detectorErrors,
      });
    }

    // Per-run TPR/FPR at the headline threshold — one value per repeat.
    const rateForRun = (runIdx: number) => calculateBinaryRates(
      scored.map((testCase) => ({ expected: testCase.expected, score: testCase.scores[runIdx] })),
      headlineThreshold,
    );

    const tprRuns: Array<number | null> = [];
    const fprRuns: Array<number | null> = [];
    for (let i = 0; i < repeats; i++) {
      const rr = rateForRun(i);
      tprRuns.push(rr.tpr === null ? null : Number(rr.tpr.toFixed(4)));
      fprRuns.push(rr.fpr === null ? null : Number(rr.fpr.toFixed(4)));
    }

    // Headline numbers use the mean across repeats.
    const tprMean = mean(tprRuns.filter((value): value is number => value !== null));
    const fprMean = mean(fprRuns.filter((value): value is number => value !== null));
    const tprStd = sampleStandardDeviation(tprRuns.filter((value): value is number => value !== null));
    const fprStd = sampleStandardDeviation(fprRuns.filter((value): value is number => value !== null));

    // Threshold sweep on the first repeat's scores (free — no extra model calls).
    const rateAt = (threshold: number, runIdx = 0) => ({
      threshold,
      ...calculateBinaryRates(
        scored.map((testCase) => ({ expected: testCase.expected, score: testCase.scores[runIdx] })),
        threshold,
      ),
    });
    const sweep = SWEEP.map((t) => rateAt(t, 0));
    const headline = rateAt(headlineThreshold, 0);

    // Keyword baseline on the same set (first repeat's verdicts).
    let ktp = 0, kfp = 0, ktn = 0, kfn = 0;
    for (const s of scored) {
      if (s.expected && s.keywordFired) ktp++;
      else if (s.expected && !s.keywordFired) kfn++;
      else if (!s.expected && s.keywordFired) kfp++;
      else ktn++;
    }
    const keywordTpr = ktp + kfn > 0 ? ktp / (ktp + kfn) : 0;
    const keywordFpr = kfp + ktn > 0 ? kfp / (kfp + ktn) : 0;

    const errors = scored.reduce((count, testCase) => count + testCase.detectorErrors.length, 0);

    const notes =
      `Set: ${setName} (${stats.total} cases, ${stats.drift} drift / ${stats.clean} clean). ` +
      `Repeats: ${repeats}. Headline TPR/FPR are means across repeats with valid scores; ± is sample standard deviation. ` +
      `Failed judge attempts: ${errors}; failed attempts are excluded from rate denominators. ` +
      (setName === 'heldout'
        ? 'HELD-OUT set: these cases were never used to choose the threshold, so this is a less-overfit measurement than the tuning set. It is still the same author, not independent review. '
        : setName === 'both'
        ? 'Union of tuning + held-out. Useful for an aggregate view, but mixes calibrated and uncalibrated cases. '
        : 'TUNING set: the threshold was chosen on these cases, so TPR/FPR here are optimistically overfit. Run the held-out set for a less-biased number. ') +
      `LLM-as-judge (no embedding endpoint on this platform), non-deterministic, model="${model}". Valid for comparing thresholds and catching a broken detector; NOT a general benchmark.`;

    const record = await appClient.asServiceRole.entities.DriftEvalResult.create({
      detector: 'semantic',
      model,
      threshold: headlineThreshold,
      total_cases: stats.total,
      drift_cases: stats.drift,
      clean_cases: stats.clean,
      true_positives: headline.true_positives,
      false_positives: headline.false_positives,
      true_negatives: headline.true_negatives,
      false_negatives: headline.false_negatives,
      tpr: tprMean,
      fpr: fprMean,
      errors,
      evaluated_cases_first_repeat: headline.evaluated,
      failed_judge_attempts: errors,
      eval_set: setName,
      repeats,
      tpr_runs: tprRuns,
      fpr_runs: fprRuns,
      tpr_mean: roundRate(tprMean),
      tpr_std: roundRate(tprStd),
      fpr_mean: roundRate(fprMean),
      fpr_std: roundRate(fprStd),
      threshold_sweep: sweep,
      case_results: scored.map((s) => ({
        case_id: s.caseId,
        expected_drift: s.expected,
        predicted_drift: s.scores[0] === null ? null : s.scores[0] >= headlineThreshold,
        score: s.scores[0],
        correct: s.scores[0] === null ? null : s.expected === (s.scores[0] >= headlineThreshold),
        keyword_would_have_fired: s.keywordFired,
        note: s.note,
        detector_error: s.detectorErrors[0] || '',
      })),
      keyword_baseline_tpr: keywordTpr,
      keyword_baseline_fpr: keywordFpr,
      notes,
    });

    return Response.json({
      id: (record as any).id,
      eval_set: setName,
      repeats,
      headline,
      tprRuns,
      fprRuns,
      tprMean: roundRate(tprMean),
      tprStd: roundRate(tprStd),
      fprMean: roundRate(fprMean),
      fprStd: roundRate(fprStd),
      sweep,
      keywordBaseline: { tpr: keywordTpr, fpr: keywordFpr, true_positives: ktp, false_positives: kfp },
      errors,
      setStats: stats,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}