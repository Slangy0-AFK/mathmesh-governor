// === Output Attribution ===
//
// Review point: "every output should be attributable to the agent that produced it."
//
// Each output is hashed with SHA-256 and the digest is stored on the run alongside
// the agent id and session nonce. Given a piece of text found later, recomputing the
// digest finds the run, the agent and the session that produced it.
//
// HONEST LIMITATIONS — this is attribution, not proof:
//   - The digest is unkeyed. It proves two texts are identical; it does NOT prove
//     who wrote one. Anyone who can write to the log could add a matching record.
//     Real non-repudiation needs a signing key the app layer cannot reach.
//   - Lookup requires the text to be byte-identical. One edited character, or a
//     paraphrase, and the match is gone. There is no fuzzy attribution here.
//   - It attributes outputs this harness recorded. An agent that bypasses the
//     harness produces nothing to attribute.

/** SHA-256 hex digest of a string, via the browser SubtleCrypto API. */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}