/**
 * Agent keys — turning a claimed identity into an authenticated one.
 *
 * Before this, `agentId` was just a string a caller typed, so every downstream
 * control (tool gate, rate limit, kill switch) only governed a cooperative agent.
 * Now each registered agent holds a secret key. Only its SHA-256 hash is stored,
 * so the plaintext exists exactly once: at issue time, in the operator's hands.
 *
 * What this does buy: a caller cannot act as another agent without that agent's
 * key, and cannot escape a freeze by inventing a fresh agent id.
 * What it does not buy: a key that leaks is the identity. Rotate on suspicion.
 */

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 256 bits of CSPRNG, prefixed so a leaked key is recognisable in a log. */
export function generateAgentKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `mmk_${body}`;
}

/** Length-independent, non-short-circuiting compare, so timing leaks nothing. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface KeyVerdict {
  ok: boolean;
  reason: string;
}

/**
 * Verify a presented key against a stored agent record.
 *
 * `requireKey` is the policy switch. When it is off, an agent with no key on file
 * is allowed through unauthenticated — which is the old, weaker behaviour, and is
 * reported as such rather than quietly passing.
 */
export async function verifyAgentKey(
  agent: { key_hash?: string; agent_id: string },
  presentedKey: string | undefined,
  requireKey: boolean,
): Promise<KeyVerdict> {
  const stored = (agent.key_hash || '').trim();
  const presented = (presentedKey || '').trim();

  if (!stored) {
    if (requireKey) {
      return {
        ok: false,
        reason: `Agent "${agent.agent_id}" has no key on file. An operator must issue one before it can run while key authentication is required.`,
      };
    }
    return { ok: true, reason: 'UNAUTHENTICATED — no key on file and key authentication is disabled by policy.' };
  }

  if (!presented) {
    return { ok: false, reason: 'No agent key presented. This identity is key-protected.' };
  }

  const presentedHash = await sha256Hex(presented);
  if (!constantTimeEqual(presentedHash, stored)) {
    return { ok: false, reason: 'Agent key does not match the key on file for this identity.' };
  }

  return { ok: true, reason: 'Agent key verified against stored hash.' };
}