const SAFE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bin the event that\b/gi, 'if'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bhas the ability to\b/gi, 'can'],
  [/\bis able to\b/gi, 'can'],
  [/\bwith regard to\b/gi, 'about'],
  [/\bwith respect to\b/gi, 'about'],
  [/\ba large number of\b/gi, 'many'],
];

export interface InputOptimization {
  text: string;
  originalChars: number;
  optimizedChars: number;
  savedChars: number;
  estimatedTokensSaved: number;
  compressionRatio: number;
}

/** Conservative, deterministic reduction before token reservation and model spend. */
export function optimizeModelInput(input: string): InputOptimization {
  let text = input.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of SAFE_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\s+/g, ' ').trim();

  const originalChars = input.length;
  const optimizedChars = text.length;
  const savedChars = Math.max(0, originalChars - optimizedChars);

  return {
    text,
    originalChars,
    optimizedChars,
    savedChars,
    estimatedTokensSaved: Math.floor(savedChars / 4),
    compressionRatio: originalChars > 0 ? optimizedChars / originalChars : 1,
  };
}