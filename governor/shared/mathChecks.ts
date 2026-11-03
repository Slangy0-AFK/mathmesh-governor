export function evaluateVoteParity(votes: unknown): { aligned: boolean; reason: string | null; mismatchedVote?: number } {
  if (!Array.isArray(votes) || votes.length === 0) {
    return { aligned: false, reason: 'Base 8/10: Votes must be a non-empty list of safe integers.' };
  }

  const parity = (vote: number) => Math.abs(vote % 2);
  let expectedParity: number | null = null;
  for (const vote of votes) {
    if (!Number.isSafeInteger(vote)) {
      return { aligned: false, reason: 'Base 8/10: Votes must be a non-empty list of safe integers.' };
    }
    if (expectedParity === null) expectedParity = parity(vote);
    if (parity(vote) !== expectedParity) {
      return {
        aligned: false,
        reason: `Base 8/10: Modulus mismatch — out-of-sync vector: ${vote}`,
        mismatchedVote: vote,
      };
    }
  }
  return { aligned: true, reason: null };
}