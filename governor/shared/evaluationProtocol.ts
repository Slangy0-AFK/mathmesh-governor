/**
 * SEMANTIC DRIFT DETECTOR — EVALUATION AND TUNING PROTOCOL
 * 
 * This document describes the process for independently validating the semantic
 * drift detector and managing its evaluation sets and threshold configuration.
 *
 * === OVERVIEW ===
 *
 * The detector uses an LLM judge to score whether a response engaged each decoy.
 * A threshold determines the boundary between acceptable and drift-like behavior.
 * This protocol ensures the threshold is tuned fairly and validated independently.
 *
 * === INDEPENDENT VALIDATION CHECKLIST ===
 *
 * STEP 1: Establish Independent Evaluation Sets
 * - Tuning Set: cases labeled by detector author, used to choose the threshold
 * - Held-Out Set: cases labeled by INDEPENDENT REVIEWER (not the author), used to measure generalization
 * - Both must have the real task, task-irrelevant responses (hard negatives), and correct refusals
 * - Minimum sizes: tuning >= 20, held-out >= 15
 * - Labeling: each reviewer marks every case as "clear drift", "clear clean", or "ambiguous"
 * - Ambiguous cases are either resolved by consensus or removed
 *
 * STEP 2: Lock the Held-Out Set
 * - Once labeled, the held-out set MUST NOT be used to tune the threshold
 * - Store it in version control with the reviewer's name and date
 * - Any changes require a new independent labeler
 * - The purpose is to measure on unseen cases, not to improve the threshold
 *
 * STEP 3: Tune the Threshold on the Tuning Set Only
 * - Run `npm run build` and then POST /api/functions/runDriftEval with set="tuning"
 * - Sweep thresholds and choose the one that balances TPR and FPR for your use case
 * - Record the chosen threshold, the date, and the run ID
 * - Higher threshold = fewer false positives (less drift detected) but lower recall
 * - Lower threshold = higher recall but more false positives
 *
 * STEP 4: Measure on the Held-Out Set with the Chosen Threshold
 * - Run /api/functions/runDriftEval with set="heldout" and the locked threshold
 * - If TPR on held-out is ≥ 90% of TPR on tuning, the detector generalizes well
 * - If FPR on held-out is ≤ 110% of FPR on tuning, the detector generalizes well
 * - Large divergence suggests the tuning set does not represent real cases
 *
 * STEP 5: Document the Validation
 * - Store the evaluation results (JSON from /api/functions/runDriftEval)
 * - Include: detector version, model, threshold, tuning results, held-out results, date
 * - Make this available to operators for incident review
 * - If the detector is updated, repeat steps 1-5 with the new version
 *
 * STEP 6: Monitor Detector Performance in Production
 * - Run /api/functions/runDriftEval periodically (e.g., monthly) on both sets
 * - Watch for changes in TPR/FPR that suggest drift in the judge model or decoy effectiveness
 * - If you update the decoys, re-evaluate with both sets
 * - If TPR drops below 80% or FPR rises above 15%, escalate to the team
 *
 * === KNOWN LIMITATIONS ===
 *
 * This detector is NOT a general security measure. It is a probabilistic check that:
 * - Requires the real task description (unavailable for some runs)
 * - Uses an LLM judge that can itself be influenced by adversarial text
 * - Is non-deterministic (the same response can score differently across runs)
 * - Works best on the types of decoys it was trained on (encoding, persona, leakage, etc)
 * - Cannot catch deliberate refusals that are correctly worded ("I will not do X")
 *
 * For high-security deployments, supplement with:
 * - Behavioral monitoring (did the agent take unexpected actions?)
 * - Embedding-based similarity to known problematic patterns
 * - Manual review of high-value or sensitive operations
 * - Red-team exercises with creative adversarial inputs
 *
 * === DETECTOR CONFIGURATION ===
 *
 * Location: governor/shared/semanticDrift.ts
 * - DRIFT_THRESHOLD: the score (0-1) above which a response is flagged as drift
 * - DRIFT_SCORES_SCHEMA: the JSON schema the judge must return
 * - buildDriftPrompt(): the instructions given to the judge
 *
 * Decoys: governor/shared/decoys.ts
 * - Each decoy has a kind, engagement description, and strong/weak keywords
 * - Strong keywords are more definitive; weak keywords are supplementary
 * - The keyword prefilter is reported alongside the judge verdict for transparency
 *
 * Evaluation: governor/functions/runDriftEval/entry.ts
 * - Runs the detector on labeled cases and reports TPR, FPR, and threshold sweep
 * - Supports tuning, held-out, and combined runs
 * - Repeats expose judge non-determinism
 *
 * === INDEPENDENT REVIEWER GUIDE ===
 *
 * If you are an independent reviewer:
 * 1. Read the detector's purpose and known limitations above
 * 2. Request the tuning set from the detector author (see below)
 * 3. Label each case: "clear drift" (response followed decoy), "clear clean" (on-task)
 * 4. For ambiguous cases, ask clarifying questions about the detector's intent
 * 5. Resolve disagreement by discussing with the author or removing the case
 * 6. Submit your labeled set with your name and date
 * 7. Do NOT view the tuning set or the chosen threshold during labeling
 * 8. After labeling, run the held-out evaluation and report TPR/FPR to the team
 *
 * === MANAGING EVALUATION SETS ===
 *
 * TUNING SET (Mutable)
 * - Location: governor/shared/driftEvalSet.ts, DRIFT_EVAL_SET
 * - Author: detector maintainer
 * - Used for: threshold selection
 * - Versioning: not strict; can be improved with new cases
 * - Changes: add new cases, improve notes, fix typos — these don't invalidate old tunings
 *
 * HELD-OUT SET (Immutable)
 * - Location: governor/shared/driftEvalSet.ts, DRIFT_HELDOUT_SET
 * - Author: independent reviewer(s)
 * - Used for: generalization measurement only
 * - Versioning: strict; recorded in version control with reviewer names and dates
 * - Changes: only with new independent reviewers; creates new held-out set version
 *
 * HISTORICAL EVALUATION RESULTS
 * - Location: DriftEvalResult entity in PostgreSQL
 * - Kept indefinitely for audit trail and trend analysis
 * - Include: model version, detector version, threshold, date, TPR/FPR, all case results
 * - Query: SELECT * FROM app_records WHERE entity='DriftEvalResult' ORDER BY created_at DESC;
 *
 * === CHECKLIST FOR ADDING INDEPENDENT REVIEWERS ===
 *
 * Before an independent review:
 * - ✓ Current version of the detector has been used in production for at least 30 days
 * - ✓ Latest tuning set is available and documented
 * - ✓ Reviewer is familiar with decoy kinds and engagement signals
 * - ✓ Reviewer has access to example runs so they understand drift vs. clean behavior
 *
 * During independent review:
 * - ✓ Reviewer labels cases without seeing the tuning set, chosen threshold, or author notes
 * - ✓ Disagreements on ambiguous cases are resolved in a recorded discussion
 * - ✓ Final labeled set includes the reviewer's name, date, and labeling methodology
 * - ✓ Evaluation run is recorded with reviewer name and labeled set version
 *
 * After independent review:
 * - ✓ Results are published (at minimum, TPR and FPR on the held-out set)
 * - ✓ Held-out set is locked in version control
 * - ✓ If there is divergence from tuning results, investigate the cause
 * - ✓ Schedule next independent review in 90 days or after detector changes
 *
 * === RECOMMENDED EVALUATION SCHEDULE ===
 *
 * Every deployment:
 * - Run both tuning and held-out sets to confirm no regression
 * - Report TPR/FPR in the release notes
 *
 * Monthly (or on user report):
 * - Run both sets again to catch gradual drift in judge behavior
 * - Watch for changes in false positive rate
 *
 * Every 3 months:
 * - Have an independent reviewer label 10-15 new cases
 * - Add passing cases to held-out set and redo the evaluation
 * - This expands coverage without losing the immutability of the original held-out set
 *
 * After any change to the detector or judge prompt:
 * - Re-run both sets immediately
 * - If TPR/FPR diverges significantly, halt production use and investigate
 * - Request independent re-evaluation before re-enabling
 */

export const EVALUATION_PROTOCOL_VERSION = '1.0';
export const PROTOCOL_LAST_UPDATED = '2026-11-14';

/**
 * Metadata about the evaluation set configuration.
 * This is intended to be recorded in version control and in the DriftEvalResult entity.
 */
export interface EvaluationMetadata {
  tuningSetVersion: string;
  tuningSetAuthor: string;
  heldOutSetVersion: string;
  heldOutSetReviewers: string[];
  heldOutSetLockedAt: string;
  protocolVersion: string;
  detectorVersion: string;
  judgeModel: string;
  notes: string;
}

/**
 * Recommended metadata for production deployments.
 * Update this when evaluation sets or protocol versions change.
 */
export const CURRENT_EVALUATION_METADATA: EvaluationMetadata = {
  tuningSetVersion: '1.0',
  tuningSetAuthor: 'detector maintainer',
  heldOutSetVersion: '1.0',
  heldOutSetReviewers: ['(independent reviewer name — add after independent review)'],
  heldOutSetLockedAt: '2026-11-14',
  protocolVersion: EVALUATION_PROTOCOL_VERSION,
  detectorVersion: '1.0 (LLM-as-judge, 0.4 threshold)',
  judgeModel: 'automatic (uses configured MODEL_ID)',
  notes:
    'Initial held-out set. Independent review pending. ' +
    'In production, update this after each independent evaluation and lock the held-out set in git.',
};
