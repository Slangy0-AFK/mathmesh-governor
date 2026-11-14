import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { authenticateRequest } from './auth.js';
import { entityStore, tokenLedger } from './db.js';
import { invokeModel } from './model.js';

const functionNames = new Set([
  'admissionControl', 'anchorAuditChain', 'egressProxy', 'harnessSelfTest', 'health', 'issueAgentKey',
  'killSwitch', 'metrics', 'processWithSonnet', 'ragRetrieve', 'recordAudit',
  'runDriftEval', 'semanticDedupCheck', 'testExternalModel', 'tripwireCheck',
  'verifyAuditChain', 'verifyOutput',
]);

const entities = new Proxy({}, {
  get: (_target, name) => typeof name === 'string' ? entityStore(name) : undefined,
});

/**
 * Wrap invokeModel to attach usage metadata while maintaining backward compatibility.
 * For structured responses (objects), the usage is attached as a non-enumerable property.
 * For text responses (strings), we return the original string for backward compatibility,
 * but the usage is still available through the processWithSonnet path which handles it specially.
 */
function createInvokeLLMWrapper() {
  return async (args) => {
    const result = await invokeModel(args);
    if (typeof result === 'object' && result !== null && 'response' in result && 'usage' in result) {
      const { response, usage } = result;
      if (typeof response === 'string') {
        return response;
      }
      Object.defineProperty(response, '__usage__', {
        value: usage,
        writable: false,
        enumerable: false,
        configurable: false,
      });
      return response;
    }
    return result;
  };
}

export function createAppClientFromRequest(request) {
  const serviceRole = { entities, tokenLedger, integrations: { Core: { InvokeLLM: createInvokeLLMWrapper() } } };
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