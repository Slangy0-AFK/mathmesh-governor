export interface ScoredCase {
  expected: boolean;
  score: number | null;
}

export interface BinaryRates {
  true_positives: number;
  false_positives: number;
  true_negatives: number;
  false_negatives: number;
  evaluated: number;
  errors: number;
  tpr: number | null;
  fpr: number | null;
}

export function calculateBinaryRates(cases: ScoredCase[], threshold: number): BinaryRates {
  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;
  let evaluated = 0;

  for (const testCase of cases) {
    if (typeof testCase.score !== 'number' || !Number.isFinite(testCase.score)) continue;
    evaluated++;
    const predicted = testCase.score >= threshold;
    if (testCase.expected && predicted) truePositives++;
    else if (testCase.expected) falseNegatives++;
    else if (predicted) falsePositives++;
    else trueNegatives++;
  }

  const positiveCases = truePositives + falseNegatives;
  const negativeCases = falsePositives + trueNegatives;
  return {
    true_positives: truePositives,
    false_positives: falsePositives,
    true_negatives: trueNegatives,
    false_negatives: falseNegatives,
    evaluated,
    errors: cases.length - evaluated,
    tpr: positiveCases > 0 ? truePositives / positiveCases : null,
    fpr: negativeCases > 0 ? falsePositives / negativeCases : null,
  };
}

export function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sampleStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values) as number;
  const squaredDifferences = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return Math.sqrt(squaredDifferences / (values.length - 1));
}

export function roundRate(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(4));
}