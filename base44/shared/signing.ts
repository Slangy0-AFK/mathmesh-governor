/**
 * Output signing — HMAC-SHA256 over the facts of an output.
 *
 * The plain SHA-256 hash already recorded proves "this text is byte-identical to
 * something we stored". It proves nothing about origin, because anyone can compute
 * it. Signing the same facts with a server-held secret means a stored output can be
 * shown to have come from this harness: the signature cannot be produced without
 * HARNESS_SIGNING_SECRET, which never leaves the server and is never sent to an agent.
 *
 * The signed message binds the output to the agent, session and action, so a valid
 * signature cannot be lifted from one output and attached to another.
 */

import { secrets } from 'base44:runtime';

export interface SigningSubject {
  agentId: string;
  sessionNonce: string;
  action: string;
  outputHash: string;
}

function canonicalMessage(s: SigningSubject): string {
  // Fixed field order with a delimiter that cannot appear in a hash or nonce, so two
  // different subjects can never serialise to the same message.
  return ['v1', s.agentId, s.sessionNonce, s.action, s.outputHash].join('\n');
}

async function hmacKey(): Promise<CryptoKey> {
  const secret = secrets.get('HARNESS_SIGNING_SECRET');
  if (!secret) throw new Error('HARNESS_SIGNING_SECRET is not set — cannot sign or verify outputs.');
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signOutput(subject: SigningSubject): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalMessage(subject)));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyOutputSignature(subject: SigningSubject, signature: string): Promise<boolean> {
  if (!signature) return false;
  const expected = await signOutput(subject);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}