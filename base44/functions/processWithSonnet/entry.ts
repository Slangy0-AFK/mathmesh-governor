import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { selectDecoys } from '../../shared/decoys.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { payload, action, agentId, context, model } = body;
    const selectedModel = typeof model === 'string' && model.trim().length > 0 ? model : 'automatic';

    if (!payload || typeof payload !== 'string' || payload.length < 3) {
      return Response.json({ error: 'Invalid payload' }, { status: 400 });
    }
    if (payload.length > 8000) {
      return Response.json({ error: 'Payload too large' }, { status: 400 });
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

    return Response.json({
      response: responseText,
      model: selectedModel,
      inputLength: payload.length,
      outputLength: responseText.length,
      contextInjected: !!(context && context.trim().length > 0),
      contextLength: context ? context.length : 0,
      decoyIds: decoys.decoyIds,
      decoyPlacement: decoys.placement,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}