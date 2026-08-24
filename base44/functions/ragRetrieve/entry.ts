import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { query, action } = body;

    if (!query || typeof query !== 'string' || query.length < 3) {
      return Response.json({ error: 'Invalid query' }, { status: 400 });
    }

    // Fetch all KB entries (service role — KB is shared app knowledge)
    const allEntries = await base44.asServiceRole.entities.KnowledgeBase.list();

    // Filter by action_scope: include '*' (all), empty, or matching action
    const scoped = allEntries.filter((e: any) =>
      !e.action_scope || e.action_scope === '*' || e.action_scope === action
    );

    if (scoped.length === 0) {
      return Response.json({ context: '', sources: [], entryCount: 0, totalEntries: 0 });
    }

    // Build entry summaries for LLM relevance scoring
    const entrySummaries = scoped.map((e: any, i: number) =>
      `[${i}] Title: ${e.title}\n    Content: ${(e.content || '').slice(0, 500)}`
    ).join('\n\n');

    // Use LLM to determine which entries are relevant to the query
    const prompt = `You are a retrieval system inside an agentic harness. Given this query:
"${query}"

And these knowledge base entries:
${entrySummaries}

Which entries contain information directly relevant to answering this query? Return a JSON object with the array of entry indices that are relevant. Only include entries that contain factual information useful for answering the query. If none are relevant, return an empty array.

Return JSON: {"relevant_indices": [0, 2, 5]}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          relevant_indices: {
            type: 'array',
            items: { type: 'number' }
          }
        },
        required: ['relevant_indices']
      },
      model: 'claude_sonnet_4_6',
    });

    const indices = (result as any)?.relevant_indices || [];
    const selectedEntries = indices
      .map((i: number) => scoped[i])
      .filter((e: any) => e != null);

    // Build context string from selected entries
    const context = selectedEntries.map((e: any) =>
      `[Source: ${e.title}${e.source ? ' — ' + e.source : ''}]\n${e.content}`
    ).join('\n\n---\n\n');

    const sources = selectedEntries.map((e: any) => ({
      id: e.id,
      title: e.title,
      source: e.source || '',
    }));

    return Response.json({
      context,
      sources,
      entryCount: selectedEntries.length,
      totalEntries: scoped.length,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}