/**
 * External anchoring for the audit chain.
 * 
 * The audit chain itself is tamper-EVIDENT but not immutable. External anchoring
 * provides a way to periodically record the state of the chain to an external,
 * independently controlled system. This makes retrospective modification harder:
 * an attacker would need to compromise both the internal database AND the external
 * anchor store.
 *
 * Common anchoring strategies:
 * 1. Signed commits to a public git repository
 * 2. Timestamped records in an external audit service
 * 3. Blockchain/ledger entries (if appropriate for your governance model)
 * 4. Physically signed printouts (for high-security environments)
 */

export interface AuditAnchor {
  seq: number;
  hash: string;
  timestamp: string;
  externalReference: string;
  anchorType: 'git' | 'service' | 'ledger' | 'manual';
  verified: boolean;
}

/**
 * Record an anchor point for the current chain head.
 * This should be called periodically (e.g., daily or after major events).
 *
 * The actual external storage is delegated to the operator's infrastructure.
 * This function records the anchor metadata so that future verifications can
 * cross-check against the external record.
 */
export async function recordAuditAnchor(
  svc: any,
  chainHead: { seq: number; hash: string },
  anchorType: AuditAnchor['anchorType'],
  externalReference: string,
): Promise<AuditAnchor> {
  const anchor: AuditAnchor = {
    seq: chainHead.seq,
    hash: chainHead.hash,
    timestamp: new Date().toISOString(),
    externalReference,
    anchorType,
    verified: false,
  };

  // Create an AuditAnchor entity to track all external anchors
  await svc.entities.AuditAnchor?.create(anchor).catch(() => {
    console.warn(`AuditAnchor entity not yet initialized; anchor metadata will not be persisted.`);
  });

  return anchor;
}

/**
 * Verify that an anchor point matches the chain head at that sequence.
 * This allows operators to confirm that the external record has not been
 * retroactively altered since the anchor was made.
 */
export async function verifyAuditAnchor(
  svc: any,
  anchor: AuditAnchor,
): Promise<{ verified: boolean; matches: boolean; detail: string }> {
  // Fetch the record at anchor.seq from the chain
  const rows = await svc.entities.AuditLog.list('-seq', 2000).catch(() => []);
  const ordered = [...rows].reverse();
  const recordAtSeq = ordered.find((r: any) => r.seq === anchor.seq);

  if (!recordAtSeq) {
    return {
      verified: false,
      matches: false,
      detail: `No record found at sequence ${anchor.seq}. Record may have been deleted.`,
    };
  }

  const matches = recordAtSeq.row_hash === anchor.hash;
  if (!matches) {
    return {
      verified: false,
      matches: false,
      detail: `Hash mismatch at sequence ${anchor.seq}. Expected ${anchor.hash}, got ${recordAtSeq.row_hash}. Record has been altered.`,
    };
  }

  // Verify the chain from this point forward is unbroken
  let valid = true;
  let expectedPrev = recordAtSeq.row_hash;
  for (let i = ordered.indexOf(recordAtSeq) + 1; i < ordered.length; i++) {
    const r = ordered[i];
    if (r.prev_hash !== expectedPrev) {
      valid = false;
      break;
    }
    expectedPrev = r.row_hash;
  }

  return {
    verified: valid,
    matches: true,
    detail: valid
      ? `Anchor at sequence ${anchor.seq} matches, and the chain from that point is unbroken.`
      : `Anchor matches at sequence ${anchor.seq}, but the chain after that point is broken.`,
  };
}

/**
 * Generate an audit snapshot suitable for external storage.
 * This includes enough information for an external verifier to independently
 * confirm that the chain state at this snapshot is unchanged.
 */
export function generateAuditSnapshot(
  chainHead: { seq: number; hash: string },
  timestamp: string,
  harnessBuild: string,
): string {
  return JSON.stringify({
    version: '1.0',
    timestamp,
    harnessBuild,
    chainHead: {
      seq: chainHead.seq,
      hash: chainHead.hash,
    },
    // In a real deployment, you would include additional metadata here:
    // - Operator signature (if using manual verification)
    // - Public key for verification
    // - Reference to external anchor location
  }, null, 2);
}
