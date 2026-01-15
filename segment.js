// BalanceChain Segment Module
// Implements the segment structure per protocol specification

import { 
  PROTOCOL_VERSION, 
  GENESIS_HASH,
  STA_TYPES 
} from './constants.js';

import { 
  randomHex, 
  canonicalize, 
  sha256Hex,
  sign,
  computeBlockHash
} from './crypto.js';

// ============================================================================
// SEGMENT STRUCTURE (Per Specification)
// ============================================================================

/**
 * @typedef {Object} SegmentAuthor
 * @property {string} hid - Human ID (HID-XXXXXXXX)
 * @property {Object} pubJwk - Public key JWK for verification
 */

/**
 * @typedef {Object} Segment (STA - State Transition Action)
 * @property {number} v - Protocol version
 * @property {number} seq - Sequence number (counter, monotonically increasing)
 * @property {number} timestamp - UTC timestamp (last_utc)
 * @property {string} nonce - Unique nonce for replay protection
 * @property {string} type - STA type (chat.user, ai.advice, etc.)
 * @property {Object} payload - Type-specific payload
 * @property {string} prev_hash - Previous block hash (history_hash link)
 * @property {string|null} unlocker_ref - Reference to unlocker segment (for TVM)
 * @property {string|null} unlocked_ref - Reference to unlocked segment (for TVM)
 * @property {string|null} previous_owner - Previous owner HID (for transfers)
 * @property {string} current_owner - Current owner HID
 * @property {SegmentAuthor} author - Segment author info
 * @property {string} signature - ECDSA signature
 */

/**
 * Create a new unsigned segment
 * @param {Object} params
 * @param {string} params.hid - Human ID
 * @param {Object} params.pubJwk - Public key JWK
 * @param {string} params.prevHash - Previous chain head hash
 * @param {number} params.seq - Sequence number
 * @param {string} params.type - STA type
 * @param {Object} params.payload - Segment payload
 * @param {string} [params.previousOwner] - Previous owner (for transfers)
 * @param {string} [params.unlockerRef] - Unlocker segment reference
 * @param {string} [params.unlockedRef] - Unlocked segment reference
 * @returns {Segment} Unsigned segment
 */
export function createSegment({
  hid,
  pubJwk,
  prevHash,
  seq,
  type,
  payload,
  previousOwner = null,
  unlockerRef = null,
  unlockedRef = null
}) {
  return {
    v: PROTOCOL_VERSION,
    seq,
    timestamp: Date.now(),
    nonce: randomHex(16),
    type,
    payload,
    prev_hash: prevHash,
    unlocker_ref: unlockerRef,
    unlocked_ref: unlockedRef,
    previous_owner: previousOwner,
    current_owner: hid,
    author: {
      hid,
      pubJwk
    }
    // signature will be added by signSegment()
  };
}

/**
 * Get the signable content of a segment (excludes signature)
 * @param {Segment} segment 
 * @returns {string} Canonical JSON for signing
 */
export function getSignableContent(segment) {
  const clean = { ...segment };
  delete clean.signature;
  return canonicalize(clean);
}

/**
 * Sign a segment with private key
 * @param {Segment} segment - Unsigned segment
 * @param {CryptoKey} privateKey - ECDSA private key
 * @returns {Promise<Segment>} Signed segment
 */
export async function signSegment(segment, privateKey) {
  const signable = getSignableContent(segment);
  const signature = await sign(privateKey, signable);
  return {
    ...segment,
    signature
  };
}

/**
 * Compute the hash of a signed segment
 * @param {Segment} segment - Signed segment
 * @returns {Promise<string>} Block hash
 */
export async function computeSegmentHash(segment) {
  if (!segment.signature) {
    throw new Error('Cannot hash unsigned segment');
  }
  const signable = getSignableContent(segment);
  return await computeBlockHash(signable, segment.signature);
}

// ============================================================================
// SEGMENT VALIDATION HELPERS
// ============================================================================

/**
 * Check if segment has valid structure
 * @param {any} obj 
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateSegmentStructure(obj) {
  if (!obj || typeof obj !== 'object') {
    return { valid: false, reason: 'Not an object' };
  }
  
  // Required fields
  const required = ['v', 'seq', 'timestamp', 'nonce', 'type', 'payload', 
                    'prev_hash', 'current_owner', 'author', 'signature'];
  
  for (const field of required) {
    if (!(field in obj)) {
      return { valid: false, reason: `Missing required field: ${field}` };
    }
  }
  
  // Type checks
  if (typeof obj.v !== 'number' || obj.v < 1) {
    return { valid: false, reason: 'Invalid version' };
  }
  
  if (typeof obj.seq !== 'number' || obj.seq < 1 || !Number.isInteger(obj.seq)) {
    return { valid: false, reason: 'Invalid sequence number' };
  }
  
  if (typeof obj.timestamp !== 'number' || obj.timestamp < 0) {
    return { valid: false, reason: 'Invalid timestamp' };
  }
  
  if (typeof obj.nonce !== 'string' || obj.nonce.length !== 32) {
    return { valid: false, reason: 'Invalid nonce' };
  }
  
  if (typeof obj.type !== 'string' || !Object.values(STA_TYPES).includes(obj.type)) {
    return { valid: false, reason: `Invalid type: ${obj.type}` };
  }
  
  if (typeof obj.payload !== 'object') {
    return { valid: false, reason: 'Invalid payload' };
  }
  
  if (typeof obj.prev_hash !== 'string') {
    return { valid: false, reason: 'Invalid prev_hash' };
  }
  
  if (typeof obj.current_owner !== 'string' || !obj.current_owner.startsWith('HID-')) {
    return { valid: false, reason: 'Invalid current_owner' };
  }
  
  if (!obj.author || typeof obj.author.hid !== 'string' || !obj.author.pubJwk) {
    return { valid: false, reason: 'Invalid author' };
  }
  
  if (typeof obj.signature !== 'string') {
    return { valid: false, reason: 'Missing signature' };
  }
  
  return { valid: true };
}

// ============================================================================
// PAYLOAD BUILDERS
// ============================================================================

/**
 * Create chat.user payload
 * @param {Object} params
 * @param {string} params.chatId - Chat/peer ID
 * @param {string} params.text - Message text
 * @param {string[]} [params.tags] - Optional tags
 * @param {string} [params.focus] - Focus area
 * @returns {Object}
 */
export function createChatUserPayload({ chatId, text, tags = [], focus = null }) {
  return {
    chatId,
    text,
    role: 'user',
    tags,
    focus
  };
}

/**
 * Create ai.advice payload
 * @param {Object} params
 * @param {string} params.chatId - Chat/peer ID
 * @param {string} params.selectedCharacter - Council member ID
 * @param {string} params.mode - Response mode
 * @param {Object[]} params.bubbles - Response bubbles
 * @param {string} params.text - Full text
 * @param {Object} [params.scores] - Scoring data
 * @returns {Object}
 */
export function createAIAdvicePayload({ 
  chatId, 
  selectedCharacter, 
  mode, 
  bubbles, 
  text,
  scores = null 
}) {
  return {
    chatId,
    selected_character: selectedCharacter,
    mode,
    bubbles,
    final: true,
    text,
    scores
  };
}

/**
 * Create biz.decision payload
 * @param {Object} params
 * @param {string} params.chatId - Chat/peer ID
 * @param {string} params.title - Decision title
 * @param {string} params.decision - ACCEPT/REJECT/DEFER
 * @param {string} params.category - Business category
 * @param {Object} [params.analysis] - Analysis data
 * @returns {Object}
 */
export function createBizDecisionPayload({ 
  chatId, 
  title, 
  decision, 
  category,
  analysis = null 
}) {
  return {
    chatId,
    title,
    decision,
    status: 'active',
    category,
    analysis,
    decidedAt: Date.now()
  };
}

/**
 * Create biz.outcome payload
 * @param {Object} params
 * @param {number} params.decisionSeq - Sequence of related decision
 * @param {string} params.outcome - SUCCESS/FAILURE/PARTIAL/ABANDONED
 * @param {string} [params.evidence] - Evidence description
 * @param {Object} [params.metrics] - Outcome metrics
 * @returns {Object}
 */
export function createBizOutcomePayload({ 
  decisionSeq, 
  outcome, 
  evidence = null,
  metrics = null 
}) {
  return {
    decisionSeq,
    outcome,
    evidence,
    metrics,
    recordedAt: Date.now()
  };
}

/**
 * Create capsule.mint payload
 * @param {Object} params
 * @param {string} params.capsuleId - Capsule ID
 * @param {string} params.sessionId - Session that created capsule
 * @param {number} params.richScore - Rich score achieved
 * @param {number} params.businessScore - Business score
 * @param {Object} params.capsuleHash - Hash of capsule data
 * @returns {Object}
 */
export function createCapsuleMintPayload({
  capsuleId,
  sessionId,
  richScore,
  businessScore,
  capsuleHash
}) {
  return {
    capsuleId,
    sessionId,
    richScore,
    businessScore,
    capsuleHash,
    tvmAmount: 1.0, // Always 1 TVM per capsule
    mintedAt: Date.now()
  };
}

// ============================================================================
// SEGMENT TYPE UTILITIES
// ============================================================================

/**
 * Check if segment type affects caps
 * @param {string} type 
 * @returns {boolean}
 */
export function affectsCaps(type) {
  return [
    STA_TYPES.CHAT_USER,
    STA_TYPES.AI_ADVICE,
    STA_TYPES.BIZ_DECISION,
    STA_TYPES.CAPSULE_MINT
  ].includes(type);
}

/**
 * Check if segment type is message-like
 * @param {string} type 
 * @returns {boolean}
 */
export function isMessageType(type) {
  return [
    STA_TYPES.CHAT_USER,
    STA_TYPES.AI_ADVICE,
    STA_TYPES.BIZ_DECISION,
    STA_TYPES.BIZ_OUTCOME,
    STA_TYPES.CHAT_APPEND
  ].includes(type);
}

/**
 * Get message direction from type
 * @param {string} type 
 * @returns {'in'|'out'|null}
 */
export function getMessageDirection(type) {
  switch (type) {
    case STA_TYPES.CHAT_USER:
    case STA_TYPES.BIZ_DECISION:
      return 'out';
    case STA_TYPES.AI_ADVICE:
    case STA_TYPES.BIZ_OUTCOME:
      return 'in';
    default:
      return null;
  }
}

/**
 * Get message tag from type
 * @param {string} type 
 * @returns {string|null}
 */
export function getMessageTag(type) {
  switch (type) {
    case STA_TYPES.BIZ_DECISION:
      return 'DECISION';
    case STA_TYPES.BIZ_OUTCOME:
      return 'OUTCOME';
    default:
      return null;
  }
}
