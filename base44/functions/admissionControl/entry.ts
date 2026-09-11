import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { admitRequest } from '../../shared/admission.ts';

/**
 * Admission control endpoint — a thin wrapper over the shared admission gate.
 *
 * The decision itself lives in shared/admission.ts because every function that can
 * spend money calls it directly. Skipping this endpoint no longer skips the gate:
 * it only means the spend path runs admission itself instead.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
    const action = typeof body.action === 'string' ? body.action.trim() : '';

    if (!agentId || !action) {
      return Response.json({ error: 'agentId and action are required' }, { status: 400 });
    }

    const verdict = await admitRequest(base44.asServiceRole, {
      agentId, action,
      sessionNonce: typeof body.sessionNonce === 'string' ? body.sessionNonce : '',
    });

    return Response.json(verdict);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}