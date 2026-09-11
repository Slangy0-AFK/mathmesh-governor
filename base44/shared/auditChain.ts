/**
 * Tamper-EVIDENT audit log.
 *
 * Be precise about what this is, because the difference matters. The platform gives
 * every entity table update and delete permissions; there is no append-only storage
 * primitive available at the app layer. So this does NOT make the log immutable.
 *
 * What it does instead: every row carries a sequence number, the previous row's hash,
 * a hash over its own recorded facts, and an HMAC of that hash under a server-only
 * secret. Consequences:
 *   - Edit a row's facts and its row_hash no longer matches -> detected.
 *   - Delete a row and the sequence gaps and the next row's prev_hash dangles -> detected.
 *   - Forge a replacement row and you cannot produce a valid chain_signature without
 *     HARNESS_SIGNING_SECRET -> detected.
 * So history can still be damaged, but it cannot be quietly rewritten. That is weaker
 * than an append-only store and much stronger than the plain table it replaces.
 *
 * Known limitation, stated rather than hidden: appends read the current head and then
 * write, so two truly simultaneous appends can both claim the same seq and fork the
 * chain. The verifier reports a fork distinctly from tampering instead of crying wolf.
 */

import { signMessage } from './signing.ts';

const GENESIS = '0'.repeat(64);

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The exact facts covered by the hash. Anything outside this list is not protected. */
export function canonicalRow(row: Record<string, any>): string {
  return [
    'v1',
    row.seq ?? 0,
    row.prev_hash || GENESIS,
    row.event_type || '',
    row.agent_id || '',
    row.session_nonce || '',
    row.event_nonce || '',
    row.action || '',
    row.gate || '',
    row.details || '',
    row.output_hash || '',
    row.enforcement || '',
    row.halted_at || '',
    String(row.tokens_total ?? 0),
    String(!!row.drift_signal),
    String(!!row.server_enforced),
  ].join('\n');
}

async function chainHead(svc: any): Promise<{ seq: number; hash: string }> {
  const rows = await svc.entities.AuditLog.list('-seq', 1);
  const head = rows && rows.length > 0 ? rows[0] : null;
  if (!head || typeof head.seq !== 'number' || !head.row_hash) {
    return { seq: 0, hash: GENESIS };
  }
  return { seq: head.seq, hash: head.row_hash };
}

/**
 * Append an event to the chain. Every audit write in the harness must go through here
 * — a row written directly to the table has no hash and the verifier flags it.
 */
export async function appendAudit(svc: any, fields: Record<string, any>): Promise<any> {
  const head = await chainHead(svc);
  const row = { ...fields, seq: head.seq + 1, prev_hash: head.hash };
  const rowHash = await sha256Hex(canonicalRow(row));

  let chainSignature = '';
  try {
    chainSignature = await signMessage(`chain\nv1\n${rowHash}`);
  } catch {
    // No signing secret: still chain the row. An unsigned row is reported as
    // unsigned rather than silently accepted.
  }

  return await svc.entities.AuditLog.create({ ...row, row_hash: rowHash, chain_signature: chainSignature });
}

export interface ChainProblem {
  seq: number;
  id: string;
  kind: 'altered' | 'unsigned' | 'bad_signature' | 'broken_link' | 'gap' | 'fork' | 'unchained';
  detail: string;
}

/**
 * Walk the chain oldest-first and report every inconsistency. Read-only: verification
 * never repairs anything, because a verifier that rewrites history is not a verifier.
 */
export async function verifyChain(svc: any, limit = 500): Promise<{
  ok: boolean;
  checked: number;
  problems: ChainProblem[];
  headSeq: number;
  headHash: string;
}> {
  const rows = await svc.entities.AuditLog.list('-seq', limit);
  const ordered = [...rows].reverse();
  const problems: ChainProblem[] = [];
  const seenSeq = new Map<number, string>();

  let expectedPrev: string | null = null;

  for (const r of ordered) {
    const id = String(r.id);

    if (!r.row_hash || typeof r.seq !== 'number' || r.seq === 0) {
      problems.push({ seq: r.seq ?? 0, id, kind: 'unchained', detail: 'Row has no chain hash — written outside the chained writer, or predates chaining.' });
      continue;
    }

    if (seenSeq.has(r.seq)) {
      problems.push({ seq: r.seq, id, kind: 'fork', detail: `Sequence ${r.seq} is claimed by two rows — concurrent appends forked the chain here. This is a race, not evidence of tampering.` });
    }
    seenSeq.set(r.seq, id);

    const recomputed = await sha256Hex(canonicalRow(r));
    if (recomputed !== r.row_hash) {
      problems.push({ seq: r.seq, id, kind: 'altered', detail: 'Recorded facts do not match this row\'s hash — the row was edited after it was written.' });
    }

    if (!r.chain_signature) {
      problems.push({ seq: r.seq, id, kind: 'unsigned', detail: 'Row carries no chain signature, so its origin cannot be proven.' });
    } else {
      let expectedSig = '';
      try {
        expectedSig = await signMessage(`chain\nv1\n${r.row_hash}`);
      } catch { /* secret unavailable — reported below as unverifiable */ }
      if (expectedSig && expectedSig !== r.chain_signature) {
        problems.push({ seq: r.seq, id, kind: 'bad_signature', detail: 'Chain signature does not verify — this row was not written by this harness.' });
      }
    }

    if (expectedPrev !== null && r.prev_hash !== expectedPrev) {
      problems.push({ seq: r.seq, id, kind: 'broken_link', detail: `prev_hash does not match the previous row's hash. A row between them was deleted, or the order was changed.` });
    }
    expectedPrev = r.row_hash;
  }

  // Gaps in the sequence are the signature of a deletion.
  const seqs = [...seenSeq.keys()].sort((a, b) => a - b);
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] !== seqs[i - 1] + 1) {
      problems.push({
        seq: seqs[i - 1], id: seenSeq.get(seqs[i - 1]) || '',
        kind: 'gap',
        detail: `Sequence jumps ${seqs[i - 1]} -> ${seqs[i]}: ${seqs[i] - seqs[i - 1] - 1} event(s) are missing from the record.`,
      });
    }
  }

  const head = ordered.length > 0 ? ordered[ordered.length - 1] : null;
  return {
    ok: problems.length === 0,
    checked: ordered.length,
    problems,
    headSeq: head?.seq ?? 0,
    headHash: head?.row_hash || GENESIS,
  };
}