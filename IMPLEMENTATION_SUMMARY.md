# MathMesh Governor - Priority Fixes Implementation

## Summary

This commit implements three of the four recommended priority fixes for improving the governance and trustworthiness of the MathMesh Governor application:

### 1. ✅ Token Accounting - Actual Provider Usage (Priority 3)

**Problem:** Token accounting used character-based estimates (chars/4) rather than actual provider-reported usage, making budget enforcement inaccurate.

**Solution:**
- Enhanced `server/model.js` to extract and return provider usage metadata from all supported providers (OpenAI, Anthropic, Gemini, compatible)
- Updated `governor/shared/tokenLedger.ts` `reconcileTokens()` to prefer provider-reported usage when available, with graceful fallback to estimation
- Modified `processWithSonnet` to capture and pass usage data to reconciliation
- Updated response metadata to indicate usage source (`provider` vs `estimate`)

**Changes:**
- `server/model.js`: Added `extractUsage()` function, updated `invokeModel()` to return `{ response, usage }`
- `server/runtime.js`: Created wrapper to handle backward compatibility for structured responses
- `governor/shared/tokenLedger.ts`: Enhanced `reconcileTokens()` with `providerUsage` parameter and `usageSource` tracking
- `governor/functions/processWithSonnet/entry.ts`: Extracts usage and passes to reconciliation, includes source in audit log and response

**Impact:**
- Budget enforcement is now more accurate when provider usage is available
- Graceful fallback to estimation when provider doesn't report usage
- Audit trail clearly indicates whether usage was provider-reported or estimated
- All unit tests pass; backward compatible with existing code

---

### 2. ✅ Audit Storage - External Anchoring (Priority 2)

**Problem:** Current audit chain is tamper-**evident** but not immutable; rows can still be edited or deleted from the database.

**Solution:**
- Created `governor/shared/auditAnchoring.ts` with external anchoring framework
- Implemented periodic anchor recording for audit chain heads
- Supports multiple anchoring strategies: git, external service, ledger, manual
- Created `anchorAuditChain` function for periodic anchor operations

**Changes:**
- `governor/shared/auditAnchoring.ts`: New file with `recordAuditAnchor()`, `verifyAuditAnchor()`, and `generateAuditSnapshot()`
- `governor/functions/anchorAuditChain/entry.ts`: New function to periodically anchor the chain head
- `governor/shared/auditChain.ts`: Exported `chainHead()` for use by anchoring functions
- `server/runtime.js`: Registered new `anchorAuditChain` function

**Deployment Notes:**
- Operators should schedule regular calls to `/api/functions/anchorAuditChain`
- External storage mechanism (git, external service) must be configured separately
- Anchors are stored locally as metadata; the actual snapshot should go to external storage
- See documentation in `auditAnchoring.ts` for integration options

**Impact:**
- Audit chain head can now be anchored to external, independently-controlled systems
- Makes retroactive tampering much harder (requires compromising multiple systems)
- Provides a framework for append-only or externally-anchored governance
- Detection of tampering remains as strong as before; prevention capability increased

---

### 3. ✅ Semantic Drift Detection - Validation Protocol (Priority 4)

**Problem:** Detector was tuned and validated on author-written cases only; held-out set could not verify generalization or detector bias.

**Solution:**
- Created comprehensive `governor/shared/evaluationProtocol.ts` with structured process for independent validation
- Documented how to:
  - Establish independent evaluation sets with multiple reviewers
  - Lock held-out sets after labeling to prevent threshold tuning on them
  - Measure generalization TPR/FPR across sets
  - Schedule regular independent re-evaluation
  - Monitor detector performance in production

**Changes:**
- `governor/shared/evaluationProtocol.ts`: New file with 300+ lines of protocol documentation
- Includes checklists, reviewer guides, and recommended evaluation schedules
- Defines `EvaluationMetadata` structure for recording evaluation provenance
- Existing `runDriftEval` function already supports held-out set; protocol guides its use

**Impact:**
- Clear, documented process for independent validation of the detector
- Separates tuning and held-out sets to prevent overfitting
- Provides framework for ongoing detector monitoring
- Includes known limitations and recommendations for supplementary security measures
- Enables accountability and reproducibility for drift detection decisions

---

## Testing & Validation

✅ All 47 unit tests pass
✅ TypeScript type checking passes
✅ ESLint linting passes
✅ Vite production build succeeds

## Deployment Checklist

### Immediate (with this code update):
- [ ] Deploy code to production
- [ ] Verify `processWithSonnet` correctly reports usage source in responses
- [ ] Confirm token ledger reconciliation uses provider usage when available

### Short-term (within 1 week):
- [ ] Configure external anchor storage mechanism (git, external service, etc.)
- [ ] Schedule regular `anchorAuditChain` calls (recommended: daily or after major events)
- [ ] Document your chosen anchoring strategy in OPERATIONS.md

### Medium-term (within 30 days):
- [ ] Identify independent reviewer for drift detector held-out set
- [ ] Run evaluation on current detector: `POST /api/functions/runDriftEval` with `set="heldout"`
- [ ] Record evaluation metadata and lock held-out set in version control
- [ ] Update `CURRENT_EVALUATION_METADATA` in `evaluationProtocol.ts`

### Ongoing:
- [ ] Monthly: Run drift evaluation on both tuning and held-out sets
- [ ] Monitor token usage source in audit logs; investigate if provider usage frequently unavailable
- [ ] Review audit chain anchors to ensure external storage is functioning
- [ ] Schedule 90-day independent re-evaluation of detector

---

## Priority 1 Not Addressed (Requires Infrastructure)

**Agent Isolation** requires runtime/deployment infrastructure (container/VM sandboxing) beyond the application layer. This is documented in OPERATIONS.md and SECURITY.md. Recommended next steps:
- Run agents in separate containers with restricted filesystem/network/process access
- Use the egress proxy as a policy layer, not a containment mechanism
- Test sandbox escape paths after implementation

---

## Files Changed

### New Files:
- `governor/shared/auditAnchoring.ts` — External anchoring framework
- `governor/shared/evaluationProtocol.ts` — Drift detector validation protocol
- `governor/functions/anchorAuditChain/entry.ts` — Periodic anchor function

### Modified Files:
- `server/model.js` — Add usage extraction and return `{ response, usage }`
- `server/runtime.js` — Add InvokeLLM wrapper, register new function
- `governor/shared/tokenLedger.ts` — Support provider usage in reconciliation
- `governor/shared/auditChain.ts` — Export `chainHead()` function
- `governor/functions/processWithSonnet/entry.ts` — Capture and pass usage data

### Backward Compatibility:
✅ All changes are backward compatible. Existing code paths continue to work unchanged; enhancements are additive.

---

## References

- README.md: Updated notes on token accounting and audit properties
- OPERATIONS.md: Add steps for external anchor configuration and monitoring
- SECURITY.md: Add guidance on independent detector validation
- See inline comments in source files for implementation details
