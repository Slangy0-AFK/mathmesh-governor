import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
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

const SWEEP = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function std(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function pickSet(name: string): { cases: typeof DRIFT_EVAL_SET; stats: typeof EVAL_SET_STATS } {
  if (name === 'heldout') return { cases: DRIFT_HELDOUT_SET, stats: HELDOUT_STATS };
  if (name === 'both') return { cases: ALL_EVAL_SET, stats: ALL_STATS };
  return { cases: DRIFT_EVAL_SET, stats: EVAL_SET_STATS };
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
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
      scores: number[];
      keywordFired: boolean;
      note: string;
      detectorError: string | null;
    };
    const scored: Scored[] = [];

    for (const c of cases) {
      const scores: number[] = [];
      let detectorError: string | null = null;
      for (let r = 0; r < repeats; r++) {
        const res = await detectSemanticDrift(
          c.response,
          c.decoyIds,
          (args) => base44.asServiceRole.integrations.Core.InvokeLLM(args as any),
          { threshold: headlineThreshold, model, task: c.task },
        );
        scores.push(res.maxScore);
        if (res.detectorError) detectorError = res.detectorError;
      }
      const kw = keywordPrefilter(c.response, getDecoysByIds(c.decoyIds));
      scored.push({
        caseId: c.id,
        expected: c.isDrift,
        scores,
        keywordFired: kw.fired,
        note: c.note,
        detectorError,
      });
    }

    // Per-run TPR/FPR at the headline threshold — one value per repeat.
    const rateForRun = (runIdx: number) => {
      let tp = 0, fp = 0, tn = 0, fn = 0;
      for (const s of scored) {
        const predicted = s.scores[runIdx] >= headlineThreshold;
        if (s.expected && predicted) tp++;
        else if (s.expected && !predicted) fn++;
        else if (!s.expected && predicted) fp++;
        else tn++;
      }
      return {
        tpr: tp + fn > 0 ? tp / (tp + fn) : 0,
        fpr: fp + tn > 0 ? fp / (fp + tn) : 0,
        true_positives: tp, false_positives: fp, true_negatives: tn, false_negatives: fn,
      };
    };

    const tprRuns: number[] = [];
    const fprRuns: number[] = [];
    for (let i = 0; i < repeats; i++) {
      const rr = rateForRun(i);
      tprRuns.push(Number(rr.tpr.toFixed(4)));
      fprRuns.push(Number(rr.fpr.toFixed(4)));
    }

    // Headline numbers use the mean across repeats.
    const tprMean = mean(tprRuns);
    const fprMean = mean(fprRuns);
    const tprStd = std(tprRuns);
    const fprStd = std(fprRuns);

    // Threshold sweep on the first repeat's scores (free — no extra model calls).
    const rateAt = (threshold: number, runIdx = 0) => {
      let tp = 0, fp = 0, tn = 0, fn = 0;
      for (const s of scored) {
        const predicted = s.scores[runIdx] >= threshold;
        if (s.expected && predicted) tp++;
        else if (s.expected && !predicted) fn++;
        else if (!s.expected && predicted) fp++;
        else tn++;
      }
      return {
        threshold,
        true_positives: tp,
        false_positives: fp,
        true_negatives: tn,
        false_negatives: fn,
        tpr: tp + fn > 0 ? tp / (tp + fn) : 0,
        fpr: fp + tn > 0 ? fp / (fp + tn) : 0,
      };
    };
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

    const errors = scored.filter((s) => s.detectorError).length;

    const notes =
      `Set: ${setName} (${stats.total} cases, ${stats.drift} drift / ${stats.clean} clean). ` +
      `Repeats: ${repeats}. Headline TPR/FPR are the mean across repeats; ± is one standard deviation. ` +
      (setName === 'heldout'
        ? 'HELD-OUT set: these cases were never used to choose the threshold, so this is a less-overfit measurement than the tuning set. It is still the same author, not independent review. '
        : setName === 'both'
        ? 'Union of tuning + held-out. Useful for an aggregate view, but mixes calibrated and uncalibrated cases. '
        : 'TUNING set: the threshold was chosen on these cases, so TPR/FPR here are optimistically overfit. Run the held-out set for a less-biased number. ') +
      `LLM-as-judge (no embedding endpoint on this platform), non-deterministic, model="${model}". Valid for comparing thresholds and catching a broken detector; NOT a general benchmark.`;

    const record = await base44.asServiceRole.entities.DriftEvalResult.create({
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
      eval_set: setName,
      repeats,
      tpr_runs: tprRuns,
      fpr_runs: fprRuns,
      tpr_mean: Number(tprMean.toFixed(4)),
      tpr_std: Number(tprStd.toFixed(4)),
      fpr_mean: Number(fprMean.toFixed(4)),
      fpr_std: Number(fprStd.toFixed(4)),
      threshold_sweep: sweep,
      case_results: scored.map((s) => ({
        case_id: s.caseId,
        expected_drift: s.expected,
        predicted_drift: s.scores[0] >= headlineThreshold,
        score: s.scores[0],
        correct: s.expected === (s.scores[0] >= headlineThreshold),
        keyword_would_have_fired: s.keywordFired,
        note: s.note,
        detector_error: s.detectorError || '',
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
      tprMean: Number(tprMean.toFixed(4)),
      tprStd: Number(tprStd.toFixed(4)),
      fprMean: Number(fprMean.toFixed(4)),
      fprStd: Number(fprStd.toFixed(4)),
      sweep,
      keywordBaseline: { tpr: keywordTpr, fpr: keywordFpr, true_positives: ktp, false_positives: kfp },
      errors,
      setStats: stats,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}