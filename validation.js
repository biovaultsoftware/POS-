// BalanceChain Validation Module
// Implements all 8 validation rules from protocol specification

import {
  MIN_BLOCK_INTERVAL_MS,
  UTC_TOLERANCE_MS,
  DAILY_CAP,
  MONTHLY_CAP,
  YEARLY_CAP,
  GENESIS_HASH
} from './constants.js';

import { 
  verify, 
  importPublicKeyJwk,
  sha256Hex 
} from './crypto.js';

import { 
  getSignableContent, 
  validateSegmentStructure 
} from './segment.js';

import { 
  getChainHead, 
  getChainLen, 
  nonceExists,
  getSTABySeq
} from './idb.js';

// ============================================================================
// VALIDATION RESULT TYPE
// ============================================================================

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} ok - Whether validation passed
 * @property {string} [reason] - Failure reason code
 * @property {string} [message] - Human-readable message
 * @property {number} [rule] - Rule number that failed (1-8)
 */

/**
 * Create a validation failure result
 * @param {number} rule - Rule number
 * @param {string} reason - Reason code
 * @param {string} message - Human message
 * @returns {ValidationResult}
 */
function fail(rule, reason, message) {
  return { ok: false, rule, reason, message };
}

/**
 * Create a validation success result
 * @returns {ValidationResult}
 */
function pass() {
  return { ok: true };
}

// ============================================================================
// MAIN VALIDATION FUNCTION
// ============================================================================

/**
 * Validate a segment against all 8 rules
 * @param {IDBDatabase} db - Database instance
 * @param {Object} segment - Segment to validate
 * @param {Object} [options] - Validation options
 * @param {Object} [options.capsTracker] - Caps tracker instance
 * @param {boolean} [options.skipLivenessCheck] - Skip biometric check (for testing)
 * @returns {Promise<ValidationResult>}
 */
export async function validateSegment(db, segment, options = {}) {
  // Pre-check: Structure validation
  const structureCheck = validateSegmentStructure(segment);
  if (!structureCheck.valid) {
    return fail(0, 'invalid_structure', structureCheck.reason);
  }
  
  // Rule 1: Counter relationship (unlocker.counter > unlocked.counter)
  const rule1 = await validateCounterRelationship(db, segment);
  if (!rule1.ok) return rule1;
  
  // Rule 2: Caps within limits (daily/monthly/yearly)
  const rule2 = await validateCaps(db, segment, options.capsTracker);
  if (!rule2.ok) return rule2;
  
  // Rule 3: Rate limit (1 block per second per human)
  const rule3 = await validateRateLimit(db, segment);
  if (!rule3.ok) return rule3;
  
  // Rule 4: Biometric liveness (if not skipped)
  if (!options.skipLivenessCheck) {
    const rule4 = await validateLiveness(segment);
    if (!rule4.ok) return rule4;
  }
  
  // Rule 5: Owner transition (current_owner != previous_owner for transfers)
  const rule5 = validateOwnerTransition(segment);
  if (!rule5.ok) return rule5;
  
  // Rule 6: History hash matches (prev_hash links correctly)
  const rule6 = await validateHistoryHash(db, segment);
  if (!rule6.ok) return rule6;
  
  // Rule 7: Sequence validation
  const rule7 = await validateSequence(db, segment);
  if (!rule7.ok) return rule7;
  
  // Rule 8: Signature verification
  const rule8 = await validateSignature(segment);
  if (!rule8.ok) return rule8;
  
  // Rule 9: Nonce replay protection
  const rule9 = await validateNonce(db, segment);
  if (!rule9.ok) return rule9;
  
  return pass();
}

// ============================================================================
// INDIVIDUAL RULE VALIDATORS
// ============================================================================

/**
 * Rule 1: Validate counter relationship
 * unlocker.counter > unlocked.counter
 * @param {IDBDatabase} db 
 * @param {Object} segment 
 * @returns {Promise<ValidationResult>}
 */
export async function validateCounterRelationship(db, segment) {
  // For segments that reference unlocker/unlocked
  if (segment.unlocker_ref && segment.unlocked_ref) {
    // Extract sequence numbers from refs
    const unlockerSeq = parseInt(segment.unlocker_ref.split(':')[0], 10);
    const unlockedSeq = parseInt(segment.unlocked_ref.split(':')[0], 10);
    
    if (isNaN(unlockerSeq) || isNaN(unlockedSeq)) {
      return fail(1, 'invalid_refs', 'Invalid unlocker/unlocked references');
    }
    
    if (unlockerSeq <= unlockedSeq) {
      return fail(1, 'counter_order', 
        `Unlocker counter (${unlockerSeq}) must be > unlocked counter (${unlockedSeq})`);
    }
    
    // Verify referenced segments exist
    const unlockerSeg = await getSTABySeq(db, unlockerSeq);
    const unlockedSeg = await getSTABySeq(db, unlockedSeq);
    
    if (!unlockerSeg || !unlockedSeg) {
      return fail(1, 'missing_refs', 'Referenced segments do not exist');
    }
  }
  
  return pass();
}

/**
 * Rule 2: Validate caps (daily/monthly/yearly limits)
 * @param {IDBDatabase} db 
 * @param {Object} segment 
 * @param {Object} [capsTracker] 
 * @returns {Promise<ValidationResult>}
 */
export async function validateCaps(db, segment, capsTracker) {
  if (!capsTracker) {
    // If no caps tracker provided, skip this check
    // In production, this should always be provided
    return pass();
  }
  
  const hid = segment.current_owner;
  const caps = await capsTracker.getCurrentCaps(hid);
  
  // Check daily cap
  if (caps.daily >= DAILY_CAP) {
    return fail(2, 'daily_cap_exceeded', 
      `Daily cap exceeded: ${caps.daily}/${DAILY_CAP}`);
  }
  
  // Check monthly cap
  if (caps.monthly >= MONTHLY_CAP) {
    return fail(2, 'monthly_cap_exceeded',
      `Monthly cap exceeded: ${caps.monthly}/${MONTHLY_CAP}`);
  }
  
  // Check yearly cap
  if (caps.yearly >= YEARLY_CAP) {
    return fail(2, 'yearly_cap_exceeded',
      `Yearly cap exceeded: ${caps.yearly}/${YEARLY_CAP}`);
  }
  
  return pass();
}

/**
 * Rule 3: Validate rate limit (1 block per second per human)
 * @param {IDBDatabase} db 
 * @param {Object} segment 
 * @returns {Promise<ValidationResult>}
 */
export async function validateRateLimit(db, segment) {
  const currentSeq = await getChainLen(db);
  
  if (currentSeq > 0) {
    // Get the previous segment by this author
    const prevSeg = await getSTABySeq(db, currentSeq);
    
    if (prevSeg && prevSeg.author?.hid === segment.author?.hid) {
      const timeDiff = segment.timestamp - prevSeg.timestamp;
      
      if (timeDiff < MIN_BLOCK_INTERVAL_MS) {
        return fail(3, 'rate_limit',
          `Rate limit: ${timeDiff}ms since last block (min: ${MIN_BLOCK_INTERVAL_MS}ms)`);
      }
    }
  }
  
  return pass();
}

/**
 * Rule 4: Validate biometric liveness proof
 * @param {Object} segment 
 * @returns {Promise<ValidationResult>}
 */
export async function validateLiveness(segment) {
  // Check for liveness proof in payload or author
  const livenessProof = segment.payload?.livenessProof || segment.author?.livenessProof;
  
  if (!livenessProof) {
    // For now, allow segments without liveness proof
    // In production, this should be required
    console.warn('[Validation] No liveness proof present');
    return pass();
  }
  
  // Verify liveness proof structure
  if (typeof livenessProof !== 'object') {
    return fail(4, 'invalid_liveness', 'Invalid liveness proof format');
  }
  
  // Check proof freshness (must be within tolerance)
  const proofAge = Date.now() - (livenessProof.timestamp || 0);
  if (proofAge > UTC_TOLERANCE_MS) {
    return fail(4, 'stale_liveness', 
      `Liveness proof too old: ${proofAge}ms (max: ${UTC_TOLERANCE_MS}ms)`);
  }
  
  // TODO: Verify actual biometric proof (requires WebAuthn integration)
  // For now, just check structure is present
  
  return pass();
}

/**
 * Rule 5: Validate owner transition
 * current_owner != previous_owner for transfers
 * @param {Object} segment 
 * @returns {ValidationResult}
 */
export function validateOwnerTransition(segment) {
  // Only check for transfer-type segments
  if (segment.type === 'tvm.transfer') {
    if (!segment.previous_owner) {
      return fail(5, 'missing_previous_owner', 
        'Transfer requires previous_owner');
    }
    
    if (segment.previous_owner === segment.current_owner) {
      return fail(5, 'same_owner',
        'Cannot transfer to self');
    }
  }
  
  return pass();
}

/**
 * Rule 6: Validate history hash (prev_hash matches chain head)
 * @param {IDBDatabase} db 
 * @param {Object} segment 
 * @returns {Promise<ValidationResult>}
 */
export async function validateHistoryHash(db, segment) {
  const expectedHead = await getChainHead(db);
  
  if (segment.prev_hash !== expectedHead) {
    return fail(6, 'bad_prev_hash',
      `prev_hash mismatch: expected ${expectedHead}, got ${segment.prev_hash}`);
  }
  
  return pass();
}

/**
 * Rule 7: Validate sequence number
 * @param {IDBDatabase} db 
 * @param {Object} segment 
 * @returns {Promise<ValidationResult>}
 */
export async function validateSequence(db, segment) {
  const currentLen = await getChainLen(db);
  const expectedSeq = currentLen + 1;
  
  if (segment.seq !== expectedSeq) {
    return fail(7, 'bad_seq',
      `Sequence mismatch: expected ${expectedSeq}, got ${segment.seq}`);
  }
  
  return pass();
}

/**
 * Rule 8: Validate signature
 * @param {Object} segment 
 * @returns {Promise<ValidationResult>}
 */
export async function validateSignature(segment) {
  try {
    // Import public key from segment author
    const publicKey = await importPublicKeyJwk(segment.author.pubJwk);
    
    // Get signable content
    const signable = getSignableContent(segment);
    
    // Verify signature
    const valid = await verify(publicKey, signable, segment.signature);
    
    if (!valid) {
      return fail(8, 'bad_signature', 'Signature verification failed');
    }
    
    return pass();
  } catch (e) {
    return fail(8, 'signature_error', `Signature verification error: ${e.message}`);
  }
}

/**
 * Rule 9: Validate nonce (replay protection)
 * @param {IDBDatabase} db 
 * @param {Object} segment 
 * @returns {Promise<ValidationResult>}
 */
export async function validateNonce(db, segment) {
  const exists = await nonceExists(db, segment.nonce);
  
  if (exists) {
    return fail(9, 'replay_nonce', 'Nonce already used (replay attack)');
  }
  
  return pass();
}

// ============================================================================
// UTC TOLERANCE CHECK
// ============================================================================

/**
 * Check if timestamp is within acceptable UTC tolerance
 * @param {number} timestamp 
 * @returns {ValidationResult}
 */
export function validateTimestamp(timestamp) {
  const now = Date.now();
  const diff = Math.abs(now - timestamp);
  
  if (diff > UTC_TOLERANCE_MS) {
    return fail(0, 'timestamp_drift',
      `Timestamp drift too large: ${diff}ms (max: ${UTC_TOLERANCE_MS}ms)`);
  }
  
  return pass();
}

// ============================================================================
// BATCH VALIDATION
// ============================================================================

/**
 * Validate multiple segments in order
 * @param {IDBDatabase} db 
 * @param {Object[]} segments 
 * @param {Object} [options] 
 * @returns {Promise<{valid: Object[], invalid: {segment: Object, result: ValidationResult}[]}>}
 */
export async function validateBatch(db, segments, options = {}) {
  const valid = [];
  const invalid = [];
  
  for (const segment of segments) {
    const result = await validateSegment(db, segment, options);
    
    if (result.ok) {
      valid.push(segment);
    } else {
      invalid.push({ segment, result });
    }
  }
  
  return { valid, invalid };
}

// ============================================================================
// CHAIN INTEGRITY VERIFICATION
// ============================================================================

/**
 * Verify entire chain integrity
 * @param {IDBDatabase} db 
 * @param {Object} [options]
 * @param {function} [options.onProgress] - Progress callback (seq, total)
 * @returns {Promise<{ok: boolean, verified: number, errors: Array}>}
 */
export async function verifyChainIntegrity(db, options = {}) {
  const errors = [];
  const chainLen = await getChainLen(db);
  
  if (chainLen === 0) {
    return { ok: true, verified: 0, errors: [] };
  }
  
  let expectedPrevHash = GENESIS_HASH;
  
  for (let seq = 1; seq <= chainLen; seq++) {
    if (options.onProgress) {
      options.onProgress(seq, chainLen);
    }
    
    const segment = await getSTABySeq(db, seq);
    
    if (!segment) {
      errors.push({ seq, error: 'missing_segment' });
      continue;
    }
    
    // Check sequence
    if (segment.seq !== seq) {
      errors.push({ seq, error: 'seq_mismatch', expected: seq, got: segment.seq });
    }
    
    // Check prev_hash
    if (segment.prev_hash !== expectedPrevHash) {
      errors.push({ 
        seq, 
        error: 'hash_mismatch', 
        expected: expectedPrevHash, 
        got: segment.prev_hash 
      });
    }
    
    // Verify signature
    const sigResult = await validateSignature(segment);
    if (!sigResult.ok) {
      errors.push({ seq, error: 'bad_signature', reason: sigResult.reason });
    }
    
    // Compute this block's hash for next iteration
    try {
      const signable = getSignableContent(segment);
      expectedPrevHash = await sha256Hex(signable + '|' + segment.signature);
    } catch (e) {
      errors.push({ seq, error: 'hash_compute_failed', message: e.message });
    }
  }
  
  console.log(`[Integrity] Verified ${chainLen} blocks, ${errors.length} errors`);
  
  return {
    ok: errors.length === 0,
    verified: chainLen,
    errors
  };
}
