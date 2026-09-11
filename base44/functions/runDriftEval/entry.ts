import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { DRIFT_EVAL_SET, EVAL_SET_STATS } from '../../shared/driftEvalSet.ts';
import { detectSemanticDrift, keywordPrefilter, DRIFT_THRESHOLD } from '../../shared/semanticDrift.ts';
import { getDecoysByIds } from '../../shared/decoys.ts';

const SWEEP = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    // Evaluation runs the judge once per labeled case, so it is admin-gated to
    // stop any logged-in user from burning credits on a full sweep.
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const model = typeof body?.model === 'string' && body.model ? body.model : 'automatic';
    const headlineThreshold = typeof body?.threshold === 'number' ? body.threshold : DRIFT_THRESHOLD;

    const scored: Array<{
      caseId: string;
      expected: boolean;
      score: number;
      keywordFired: boolean;
      note: string;
      detectorError: string | null;
    }> = [];

    // Score every case once. Thresholding happens afterwards so the sweep is free.
    for (const c of DRIFT_EVAL_SET) {
      const res = await detectSemanticDrift(
        c.response,
        c.decoyIds,
        (args) => base44.asServiceRole.integrations.Core.InvokeLLM(args as any),
        { threshold: headlineThreshold, model },
      );
      const kw = keywordPrefilter(c.response, getDecoysByIds(c.decoyIds));
      scored.push({
        caseId: c.id,
        expected: c.isDrift,
        score: res.maxScore,
        keywordFired: kw.fired,
        note: c.note,
        detectorError: res.detectorError,
      });
    }

    const rateAt = (threshold: number) => {
      let tp = 0, fp = 0, tn = 0, fn = 0;
      for (const s of scored) {
        const predicted = s.score >= threshold;
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

    const sweep = SWEEP.map(rateAt);
    const headline = rateAt(headlineThreshold);

    // Same set, old keyword detector — the honest baseline to beat.
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

    const record = await base44.asServiceRole.entities.DriftEvalResult.create({
      detector: 'semantic',
      model,
      threshold: headlineThreshold,
      total_cases: EVAL_SET_STATS.total,
      drift_cases: EVAL_SET_STATS.drift,
      clean_cases: EVAL_SET_STATS.clean,
      true_positives: headline.true_positives,
      false_positives: headline.false_positives,
      true_negatives: headline.true_negatives,
      false_negatives: headline.false_negatives,
      tpr: headline.tpr,
      fpr: headline.fpr,
      errors,
      threshold_sweep: sweep,
      case_results: scored.map((s) => ({
        case_id: s.caseId,
        expected_drift: s.expected,
        predicted_drift: s.score >= headlineThreshold,
        score: s.score,
        correct: s.expected === s.score >= headlineThreshold,
        keyword_would_have_fired: s.keywordFired,
        note: s.note,
        detector_error: s.detectorError || '',
      })),
      keyword_baseline_tpr: keywordTpr,
      keyword_baseline_fpr: keywordFpr,
      notes:
        'Measured on a 24-case hand-labeled set written by the same author as the detector. LLM-as-judge, not embedding similarity — this platform exposes no embedding endpoint. The judge is non-deterministic, so repeat runs will vary. Valid for comparing thresholds and for catching a broken detector; NOT a general benchmark and not a property of the harness in the wild.',
    });

    return Response.json({
      id: (record as any).id,
      headline,
      sweep,
      keywordBaseline: { tpr: keywordTpr, fpr: keywordFpr, true_positives: ktp, false_positives: kfp },
      errors,
      setStats: EVAL_SET_STATS,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}