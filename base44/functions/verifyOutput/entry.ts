import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { verifyOutputSignature } from '../../shared/signing.ts';

/**
 * Verify that a piece of text was produced by this harness.
 *
 * Two distinct claims, kept distinct in the response:
 *   matched  — the text hashes to a recorded output (anyone could check this)
 *   verified — the recorded signature is valid for that output's agent, session and
 *              action under the server-held secret (only this harness can produce it)
 *
 * A match without a valid signature means the run predates signing, or the record was
 * tampered with. Both are reported plainly rather than rounded up to "verified".
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text || text.length > 100000) {
      return Response.json({ error: 'text is required and must be under 100000 characters' }, { status: 400 });
    }

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const outputHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const runs = await base44.asServiceRole.entities.PipelineRun.filter({ output_hash: outputHash }, '-created_date', 10);

    const results = [];
    for (const run of runs) {
      const verified = await verifyOutputSignature(
        {
          agentId: run.agent_id,
          sessionNonce: run.session_nonce || '',
          action: run.action,
          outputHash,
        },
        run.output_signature || '',
      );
      results.push({
        runId: run.id,
        agentId: run.agent_id,
        action: run.action,
        status: run.status,
        sessionNonce: run.session_nonce || '',
        createdDate: run.created_date,
        hasSignature: !!(run.output_signature || ''),
        verified,
        verdict: verified
          ? 'SIGNATURE VALID — this text provably came from this harness, produced by this agent in this session.'
          : (run.output_signature
            ? 'SIGNATURE INVALID — the recorded signature does not match these facts. Treat this record as untrustworthy.'
            : 'UNSIGNED RUN — the text matches a recorded output, but this run has no signature, so origin is not proven.'),
      });
    }

    return Response.json({
      outputHash,
      matched: results.length > 0,
      anyVerified: results.some((r) => r.verified),
      results,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}