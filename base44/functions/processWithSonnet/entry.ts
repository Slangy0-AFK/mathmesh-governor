import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { payload, action, agentId } = body;

    if (!payload || typeof payload !== 'string' || payload.length < 3) {
      return Response.json({ error: 'Invalid payload' }, { status: 400 });
    }
    if (payload.length > 8000) {
      return Response.json({ error: 'Payload too large' }, { status: 400 });
    }

    const prompt = `You are a precision task processor inside an agentic harness. An agent named "${agentId}" has passed all safety gates and is requesting action: "${action}".

Process the following clean payload and provide a concise, accurate, structured response. Do not add filler or repetition — token efficiency is critical:

${payload}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      model: 'claude_sonnet_4_6',
    });

    const responseText = typeof result === 'string' ? result : (result as any)?.response || JSON.stringify(result);

    return Response.json({
      response: responseText,
      model: 'claude_sonnet_4_6',
      inputLength: payload.length,
      outputLength: responseText.length,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}