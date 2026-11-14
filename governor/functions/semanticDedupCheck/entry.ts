import { createAppClientFromRequest } from '../../../server/runtime.js';

export default async function(req: Request): Promise<Response> {
  try {
    const appClient = createAppClientFromRequest(req);
    const user = await appClient.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin only — semantic checks spend model credits.' }, { status: 403 });

    const body = await req.json();
    const { currentAction, recentActions, agentId, model } = body;
    const selectedModel = typeof model === 'string' && model.trim().length > 0 ? model : 'automatic';

    if (!currentAction || typeof currentAction !== 'string') {
      return Response.json({ error: 'currentAction required' }, { status: 400 });
    }
    if (!Array.isArray(recentActions) || recentActions.length === 0) {
      return Response.json({ isDuplicate: false, checked: true, reason: 'No history to compare' });
    }

    const recentList = recentActions.slice(-5).map((a: string, i: number) => `${i + 1}. ${a}`).join('\n');

    const prompt = `You are a semantic deduplication gate in an agentic harness. Agent "${agentId}" wants to perform this action:

"${currentAction}"

Here are its recent actions:
${recentList}

Determine if the current action is SEMANTICALLY DUPLICATIVE of any recent action — meaning it's attempting the same intent/goal even if worded differently. This catches loops that textual matching misses.

Respond as JSON: {"isDuplicate": boolean, "matchedAction": string or null, "reason": "brief explanation"}
- isDuplicate=true ONLY if the current action is clearly the same intent as a recent one.
- Be conservative: similar but distinct actions should return false.`;

    const result = await appClient.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      model: selectedModel,
      response_json_schema: {
        type: 'object',
        properties: {
          isDuplicate: { type: 'boolean' },
          matchedAction: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['isDuplicate', 'reason'],
      },
    });

    if (!result || typeof result !== 'object' || typeof result.isDuplicate !== 'boolean' || typeof result.reason !== 'string') {
      return Response.json({ error: 'Semantic deduplication returned an invalid verdict.' }, { status: 502 });
    }
    const dedupResult = { ...result, checked: true };

    return Response.json(dedupResult);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}