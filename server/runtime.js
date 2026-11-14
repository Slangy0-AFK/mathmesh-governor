import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { authenticateRequest } from './auth.js';
import { entityStore } from './db.js';
import { invokeModel } from './model.js';

const functionNames = new Set([
  'admissionControl', 'egressProxy', 'harnessSelfTest', 'health', 'issueAgentKey',
  'killSwitch', 'metrics', 'processWithSonnet', 'ragRetrieve', 'recordAudit',
  'runDriftEval', 'semanticDedupCheck', 'testExternalModel', 'tripwireCheck',
  'verifyAuditChain', 'verifyOutput',
]);

const entities = new Proxy({}, {
  get: (_target, name) => typeof name === 'string' ? entityStore(name) : undefined,
});

export function createAppClientFromRequest(request) {
  const serviceRole = { entities, integrations: { Core: { InvokeLLM: invokeModel } } };
  return {
    auth: { me: () => authenticateRequest(request) },
    asServiceRole: serviceRole,
    functions: {
      async invoke(name, payload = {}) {
        const response = await invokeFunction(name, payload, request);
        const data = await response.json();
        if (!response.ok) {
          const error = new Error(data.error || `Function ${name} failed.`);
          error.response = { status: response.status, data };
          throw error;
        }
        return { data };
      },
    },
  };
}

export async function invokeFunction(name, payload = {}, sourceRequest) {
  if (!functionNames.has(name)) return Response.json({ error: 'Function not found.' }, { status: 404 });
  const modulePath = path.resolve('governor', 'functions', name, 'entry.ts');
  const module = await import(pathToFileURL(modulePath).href);
  const headers = new Headers(sourceRequest?.headers || {});
  headers.set('content-type', 'application/json');
  const request = new Request(`http://localhost/api/functions/${name}`, {
    method: 'POST', headers, body: JSON.stringify(payload),
  });
  return await module.default(request);
}