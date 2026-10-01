import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

//Create a client with authentication required
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

// Expose the SDK only in an explicitly configured evaluation deployment.
if (typeof window !== 'undefined' && import.meta.env.VITE_E2E_EXPOSE_BASE44 === 'true') {
  window.__base44 = base44;
}