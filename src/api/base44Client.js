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

// Expose the authenticated client for live backend tests. Harmless in production:
// it is the same client the app already uses, and lets the e2e suite call the
// deployed functions through the app's own authenticated SDK.
if (typeof window !== 'undefined') {
  window.__base44 = base44;
}