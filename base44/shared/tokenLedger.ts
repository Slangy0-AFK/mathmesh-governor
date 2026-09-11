/**
 * Token budget — the actual fix for token exhaustion.
 *
 * A requests-per-window cap does not bound spend: twenty 8000-character requests cost
 * roughly forty times twenty short ones. This ledger enforces the thing that actually
 * runs out, in estimated tokens, per agent, per window.
 *
 * Two honesty notes that must not be buried:
 *
 * 1. Every count here is an ESTIMATE. InvokeLLM does not report provider usage, so
 *    tokens are approximated at 4 characters per token. Treat the numbers as a budget
 *    unit, not as a bill.
 *
 * 2. The harness's own overhead is charged to the same budget. The drift judge and the
 *    dedup check are model calls the harness chose to make, and a token-saving harness
 *    that hides its own consumption is just moving the cost somewhere unmeasured.
 */

import type { HarnessPolicy } from './harnessPolicy.ts';

export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface BudgetVerdict {
  allowed: boolean;
  reason: string;
  spent: number;
  limit: number;
  requested: number;
  windowSeconds: number;
  remaining: number;
}

/** Estimated tokens already committed by this agent inside the token window. */
export async function windowSpend(svc: any, agentId: string, windowSeconds: number): Promise<number> {
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const rows = await svc.entities.TokenSpend.filter({ agent_id: agentId }, '-created_date', 500);
  return rows
    .filter((r: any) => r.created_date >= windowStart && r.phase !== 'refunded')
    .reduce((sum: number, r: any) => sum + (r.tokens_total || 0), 0);
}

/**
 * Charge a request against the budget BEFORE the model call, from an estimate of the
 * prompt. Reserving first is what makes this a bound rather than a report: a check
 * that only records spend afterwards has already let the tokens go.
 */
export async function reserveTokens(
  svc: any,
  policy: HarnessPolicy,
  input: { agentId: string; action: string; sessionNonce?: string; promptText: string; expectedOutputChars?: number; purpose?: string },
): Promise<BudgetVerdict & { reservationId?: string }> {
  const inTokens = estimateTokens(input.promptText);
  // Output is unknown before the call, so assume it is as large as the input, floored
  // at 256 tokens. Guessing low here would let a request slip past its own budget.
  const outTokens = Math.max(256, estimateTokens('x'.repeat(input.expectedOutputChars || input.promptText.length)));
  const requested = inTokens + outTokens;

  const limit = policy.max_tokens_per_window;
  const spent = await windowSpend(svc, input.agentId, policy.token_window_seconds);

  const base: BudgetVerdict = {
    allowed: true, reason: '', spent, limit, requested,
    windowSeconds: policy.token_window_seconds,
    remaining: Math.max(0, limit - spent),
  };

  if (requested > policy.max_tokens_per_request) {
    const verdict = {
      ...base, allowed: false,
      reason: `Single request is ~${requested} estimated tokens, over the ${policy.max_tokens_per_request}-token per-request ceiling. One oversized payload must not be able to drain a window.`,
    };
    if (!policy.enforce_token_budget) return { ...verdict, allowed: true, reason: `${verdict.reason} NOT ENFORCED — budget enforcement is off, so this was recorded and allowed.` };
    return verdict;
  }

  if (spent + requested > limit) {
    const verdict = {
      ...base, allowed: false,
      reason: `Token budget exhausted: ~${spent} of ${limit} estimated tokens already spent in the last ${policy.token_window_seconds}s, and this request needs ~${requested} more.`,
    };
    if (!policy.enforce_token_budget) return { ...verdict, allowed: true, reason: `${verdict.reason} NOT ENFORCED — budget enforcement is off.` };
    return verdict;
  }

  const row = await svc.entities.TokenSpend.create({
    agent_id: input.agentId, action: input.action || '', session_nonce: input.sessionNonce || '',
    phase: 'reserved', purpose: input.purpose || 'generation',
    tokens_in: inTokens, tokens_out: outTokens, tokens_total: requested, estimated: true,
    note: `Reserved before the call from a chars/4 estimate. Output assumed at ${outTokens} tokens.`,
  });

  return {
    ...base, allowed: true, reservationId: row?.id,
    reason: `Reserved ~${requested} tokens. ~${spent + requested} of ${limit} used in this ${policy.token_window_seconds}s window.`,
    remaining: Math.max(0, limit - spent - requested),
  };
}

/** Reconcile a reservation to the real sizes once the call has returned. */
export async function reconcileTokens(
  svc: any,
  reservationId: string | undefined,
  actual: { promptText: string; responseText: string; note?: string },
): Promise<{ tokens: number }> {
  const inTokens = estimateTokens(actual.promptText);
  const outTokens = estimateTokens(actual.responseText);
  const total = inTokens + outTokens;
  if (reservationId) {
    await svc.entities.TokenSpend.update(reservationId, {
      phase: 'actual', tokens_in: inTokens, tokens_out: outTokens, tokens_total: total,
      note: actual.note || 'Reconciled to the real prompt and response sizes after the call.',
    });
  }
  return { tokens: total };
}

/** Release a reservation whose call never happened. */
export async function refundTokens(svc: any, reservationId: string | undefined, why: string): Promise<void> {
  if (!reservationId) return;
  await svc.entities.TokenSpend.update(reservationId, { phase: 'refunded', note: `Refunded: ${why}` });
}

/** Charge the harness's own overhead honestly, against the same budget. */
export async function chargeOverhead(
  svc: any,
  input: { agentId: string; action?: string; sessionNonce?: string; purpose: string; promptText: string; responseText: string },
): Promise<number> {
  const inTokens = estimateTokens(input.promptText);
  const outTokens = estimateTokens(input.responseText);
  const total = inTokens + outTokens;
  await svc.entities.TokenSpend.create({
    agent_id: input.agentId, action: input.action || '', session_nonce: input.sessionNonce || '',
    phase: 'actual', purpose: input.purpose,
    tokens_in: inTokens, tokens_out: outTokens, tokens_total: total, estimated: true,
    note: 'Harness overhead — a call the harness made on its own behalf, charged to the same budget rather than hidden.',
  });
  return total;
}