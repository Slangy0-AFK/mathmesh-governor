import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { selectDecoys } from '../../shared/decoys.ts';
import { admitRequest, consumeTicket } from '../../shared/admission.ts';
import { signOutput } from '../../shared/signing.ts';
import { sha256Hex } from '../../shared/agentKeys.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { payload, action, agentId, context, model, admissionTicket } = body;
    const selectedModel = typeof model === 'string' && model.trim().length > 0 ? model : 'automatic';

    if (!payload || typeof payload !== 'string' || payload.length < 3) {
      return Response.json({ error: 'Invalid payload' }, { status: 400 });
    }
    if (payload.length > 8000) {
      return Response.json({ error: 'Payload too large' }, { status: 400 });
    }
    if (!agentId || typeof agentId !== 'string' || !action || typeof action !== 'string') {
      return Response.json({ error: 'agentId and action are required' }, { status: 400 });
    }

    // ADMISSION IS PART OF THE SPEND PATH.
    // Either the caller presents a valid unconsumed ticket from admission control, or
    // this function runs admission itself. There is no third option, so calling this
    // endpoint directly no longer skips identity, the kill switch, the tool gate, the
    // rate limit or the loop breaker.
    const svc = base44.asServiceRole;
    let admissionSource = 'ticket';
    if (admissionTicket) {
      const spent = await consumeTicket(svc, {
        ticket: String(admissionTicket), agentId, action, consumedBy: 'processWithSonnet',
      });
      if (!spent.ok) {
        return Response.json({
          error: `Admission denied: ${spent.reason}`,
          haltedAt: 'Admission', enforcement: 'none', serverEnforced: true,
        }, { status: 403 });
      }
    } else {
      admissionSource = 'inline';
      const verdict = await admitRequest(svc, {
        agentId, action, sessionNonce: body.sessionNonce, agentKey: body.agentKey,
      });
      if (!verdict.admitted) {
        return Response.json({
          error: `Admission denied at ${verdict.haltedAt}: ${verdict.reason}`,
          haltedAt: verdict.haltedAt, enforcement: verdict.enforcement, serverEnforced: true,
        }, { status: 403 });
      }
      await consumeTicket(svc, {
        ticket: verdict.ticket!, agentId, action, consumedBy: 'processWithSonnet (inline admission)',
      });
    }

    const contextBlock = context && typeof context === 'string' && context.trim().length > 0
      ? `\n\nGROUNDING CONTEXT — use this as your source of truth. Do not state facts not supported by this context:\n${context}\n\nIf the context does not contain the answer, say "I don't have enough grounded information to answer this."`
      : '';

    const taskBlock = `You are a precision task processor inside an agentic harness. An agent named "${agentId}" has passed all safety gates and is requesting action: "${action}".

Process the following clean payload and provide a concise, accurate, structured response. Do not add filler or repetition — token efficiency is critical:

${payload}${contextBlock}`;

    // Multi-decoy canary: random subset, random order, random placement.
    // The chosen ids are returned so the tripwire knows what to compare against.
    const decoys = selectDecoys(3);
    const prompt = decoys.placement === 'before_task'
      ? `${decoys.block}\n\n${taskBlock}`
      : `${taskBlock}\n\n${decoys.block}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      model: selectedModel,
    });

    const responseText = typeof result === 'string' ? result : (result as any)?.response || JSON.stringify(result);

    // Sign the output where it is produced. Signing on the server, at the point of
    // generation, is what makes the signature mean anything — the client never sees
    // the secret and cannot mint one for text the harness did not produce.
    const sessionNonce = typeof body.sessionNonce === 'string' ? body.sessionNonce : '';
    const outputHash = await sha256Hex(responseText);
    const outputSignature = await signOutput({ agentId, sessionNonce, action, outputHash });

    await svc.entities.AuditLog.create({
      event_type: 'OUTPUT_SIGNED', agent_id: agentId, gate: 'Signing',
      session_nonce: sessionNonce, action, output_hash: outputHash,
      output_signature: outputSignature,
      details: `Output signed (HMAC-SHA256) and bound to ${agentId} / session ${sessionNonce.slice(0, 12)} / action ${action}.`,
      enforcement: 'none', server_enforced: true,
    });

    return Response.json({
      response: responseText,
      outputHash,
      outputSignature,
      model: selectedModel,
      inputLength: payload.length,
      outputLength: responseText.length,
      contextInjected: !!(context && context.trim().length > 0),
      contextLength: context ? context.length : 0,
      admissionSource,
      decoyIds: decoys.decoyIds,
      decoyPlacement: decoys.placement,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}