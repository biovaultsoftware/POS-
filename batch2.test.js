// Test: Batch 2 - Segment & Chain Core
// Run with: node --experimental-vm-modules test/batch2.test.js

import { 
  createSegment,
  signSegment,
  getSignableContent,
  computeSegmentHash,
  validateSegmentStructure,
  createChatUserPayload,
  createAIAdvicePayload,
  createBizDecisionPayload,
  isMessageType,
  getMessageDirection,
  getMessageTag
} from '../src/segment.js';

import {
  validateSegment,
  validateOwnerTransition,
  validateTimestamp,
  validateSignature
} from '../src/validation.js';

import {
  generateSigningKeyPair,
  exportPublicKeyJwk,
  generateHumanId
} from '../src/crypto.js';

import { STA_TYPES, GENESIS_HASH } from '../src/constants.js';

const tests = [];
const results = { passed: 0, failed: 0 };

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('BATCH 2 TESTS: Segment & Chain Core');
  console.log('='.repeat(60));
  
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✅ ${t.name}`);
      results.passed++;
    } catch (e) {
      console.log(`❌ ${t.name}`);
      console.log(`   Error: ${e.message}`);
      results.failed++;
    }
  }
  
  console.log('='.repeat(60));
  console.log(`Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('='.repeat(60));
  
  return results.failed === 0;
}

// Helper to create test identity
async function createTestIdentity() {
  const keyPair = await generateSigningKeyPair();
  const pubJwk = await exportPublicKeyJwk(keyPair.publicKey);
  const hid = await generateHumanId(pubJwk);
  
  return {
    hid,
    pubJwk,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey
  };
}

// ============================================================================
// SEGMENT CREATION TESTS
// ============================================================================

test('Segment: Create basic segment', async () => {
  const identity = await createTestIdentity();
  
  const segment = createSegment({
    hid: identity.hid,
    pubJwk: identity.pubJwk,
    prevHash: GENESIS_HASH,
    seq: 1,
    type: STA_TYPES.CHAT_USER,
    payload: { chatId: 'test', text: 'Hello', role: 'user' }
  });
  
  assert(segment.v === 2, `Version should be 2, got ${segment.v}`);
  assert(segment.seq === 1, 'Sequence should be 1');
  assert(segment.type === STA_TYPES.CHAT_USER, 'Type should be chat.user');
  assert(segment.prev_hash === GENESIS_HASH, 'Should link to GENESIS');
  assert(segment.current_owner === identity.hid, 'Current owner should be identity');
  assert(segment.nonce.length === 32, 'Nonce should be 32 hex chars');
});

test('Segment: Sign segment', async () => {
  const identity = await createTestIdentity();
  
  const segment = createSegment({
    hid: identity.hid,
    pubJwk: identity.pubJwk,
    prevHash: GENESIS_HASH,
    seq: 1,
    type: STA_TYPES.CHAT_USER,
    payload: { chatId: 'test', text: 'Hello', role: 'user' }
  });
  
  const signed = await signSegment(segment, identity.privateKey);
  
  assert(signed.signature, 'Should have signature');
  assert(typeof signed.signature === 'string', 'Signature should be string');
  assert(signed.signature.length > 50, 'Signature should be substantial');
});

test('Segment: Compute segment hash', async () => {
  const identity = await createTestIdentity();
  
  const segment = createSegment({
    hid: identity.hid,
    pubJwk: identity.pubJwk,
    prevHash: GENESIS_HASH,
    seq: 1,
    type: STA_TYPES.CHAT_USER,
    payload: { chatId: 'test', text: 'Hello', role: 'user' }
  });
  
  const signed = await signSegment(segment, identity.privateKey);
  const hash = await computeSegmentHash(signed);
  
  assert(hash.length === 64, `Hash should be 64 hex chars, got ${hash.length}`);
});

test('Segment: Hash is deterministic for same segment', async () => {
  const identity = await createTestIdentity();
  
  const segment = createSegment({
    hid: identity.hid,
    pubJwk: identity.pubJwk,
    prevHash: GENESIS_HASH,
    seq: 1,
    type: STA_TYPES.CHAT_USER,
    payload: { chatId: 'test', text: 'Hello', role: 'user' }
  });
  
  const signed = await signSegment(segment, identity.privateKey);
  const hash1 = await computeSegmentHash(signed);
  const hash2 = await computeSegmentHash(signed);
  
  assert(hash1 === hash2, 'Same segment should produce same hash');
});

// ============================================================================
// STRUCTURE VALIDATION TESTS
// ============================================================================

test('Validation: Valid segment structure passes', async () => {
  const identity = await createTestIdentity();
  
  const segment = createSegment({
    hid: identity.hid,
    pubJwk: identity.pubJwk,
    prevHash: GENESIS_HASH,
    seq: 1,
    type: STA_TYPES.CHAT_USER,
    payload: { chatId: 'test', text: 'Hello', role: 'user' }
  });
  
  const signed = await signSegment(segment, identity.privateKey);
  const result = validateSegmentStructure(signed);
  
  assert(result.valid === true, `Should be valid: ${result.reason}`);
});

test('Validation: Missing signature fails', async () => {
  const identity = await createTestIdentity();
  
  const segment = createSegment({
    hid: identity.hid,
    pubJwk: identity.pubJwk,
    prevHash: GENESIS_HASH,
    seq: 1,
    type: STA_TYPES.CHAT_USER,
    payload: { chatId: 'test', text: 'Hello', role: 'user' }
  });
  
  // Don't sign it
  const result = validateSegmentStructure(segment);
  
  assert(result.valid === false, 'Should fail without signature');
  assert(result.reason.includes('signature'), 'Reason should mention signature');
});

test('Validation: Invalid sequence fails', async () => {
  const identity = await createTestIdentity();
  
  const segment = createSegment({
    hid: identity.hid,
    pubJwk: identity.pubJwk,
    prevHash: GENESIS_HASH,
    seq: 0, // Invalid - must be >= 1
    type: STA_TYPES.CHAT_USER,
    payload: { chatId: 'test', text: 'Hello', role: 'user' }
  });
  
  const signed = await signSegment(segment, identity.privateKey);
  const result = validateSegmentStructure(signed);
  
  assert(result.valid === false, 'Should fail with seq=0');
});

test('Validation: Invalid type fails', async () => {
  const segment = {
    v: 2,
    seq: 1,
    timestamp: Date.now(),
    nonce: 'a'.repeat(32),
    type: 'invalid.type', // Not in STA_TYPES
    payload: {},
    prev_hash: GENESIS_HASH,
    unlocker_ref: null,
    unlocked_ref: null,
    previous_owner: null,
    current_owner: 'HID-12345678',
    author: { hid: 'HID-12345678', pubJwk: {} },
    signature: 'dummy'
  };
  
  const result = validateSegmentStructure(segment);
  
  assert(result.valid === false, 'Should fail with invalid type');
  assert(result.reason.includes('Invalid type'), `Reason: ${result.reason}`);
});

// ============================================================================
// SIGNATURE VALIDATION TESTS
// ============================================================================

test('Validation: Valid signature passes', async () => {
  const identity = await createTestIdentity();
  
  const segment = createSegment({
    hid: identity.hid,
    pubJwk: identity.pubJwk,
    prevHash: GENESIS_HASH,
    seq: 1,
    type: STA_TYPES.CHAT_USER,
    payload: { chatId: 'test', text: 'Hello', role: 'user' }
  });
  
  const signed = await signSegment(segment, identity.privateKey);
  const result = await validateSignature(signed);
  
  assert(result.ok === true, `Should pass: ${result.reason}`);
});

test('Validation: Tampered segment fails signature', async () => {
  const identity = await createTestIdentity();
  
  const segment = createSegment({
    hid: identity.hid,
    pubJwk: identity.pubJwk,
    prevHash: GENESIS_HASH,
    seq: 1,
    type: STA_TYPES.CHAT_USER,
    payload: { chatId: 'test', text: 'Hello', role: 'user' }
  });
  
  const signed = await signSegment(segment, identity.privateKey);
  
  // Tamper with the payload
  signed.payload.text = 'Tampered!';
  
  const result = await validateSignature(signed);
  
  assert(result.ok === false, 'Should fail with tampered data');
  assert(result.reason === 'bad_signature', `Reason: ${result.reason}`);
});

// ============================================================================
// OWNER TRANSITION TESTS
// ============================================================================

test('Validation: Owner transition for non-transfer passes', () => {
  const segment = {
    type: STA_TYPES.CHAT_USER,
    current_owner: 'HID-AAAAAAAA',
    previous_owner: null
  };
  
  const result = validateOwnerTransition(segment);
  assert(result.ok === true, 'Non-transfer should pass');
});

test('Validation: Self-transfer fails', () => {
  const segment = {
    type: 'tvm.transfer',
    current_owner: 'HID-AAAAAAAA',
    previous_owner: 'HID-AAAAAAAA'
  };
  
  const result = validateOwnerTransition(segment);
  assert(result.ok === false, 'Self-transfer should fail');
  assert(result.reason === 'same_owner', `Reason: ${result.reason}`);
});

// ============================================================================
// TIMESTAMP VALIDATION TESTS
// ============================================================================

test('Validation: Current timestamp passes', () => {
  const result = validateTimestamp(Date.now());
  assert(result.ok === true, 'Current time should pass');
});

test('Validation: Old timestamp fails', () => {
  const oldTime = Date.now() - 1000000; // 1000 seconds ago
  const result = validateTimestamp(oldTime);
  assert(result.ok === false, 'Old time should fail');
  assert(result.reason === 'timestamp_drift', `Reason: ${result.reason}`);
});

// ============================================================================
// PAYLOAD BUILDER TESTS
// ============================================================================

test('Payload: Chat user payload', () => {
  const payload = createChatUserPayload({
    chatId: 'kareem',
    text: 'Hello there',
    tags: ['greeting'],
    focus: 'business'
  });
  
  assert(payload.chatId === 'kareem', 'chatId should match');
  assert(payload.text === 'Hello there', 'text should match');
  assert(payload.role === 'user', 'role should be user');
  assert(payload.tags.includes('greeting'), 'tags should include greeting');
});

test('Payload: AI advice payload', () => {
  const payload = createAIAdvicePayload({
    chatId: 'kareem',
    selectedCharacter: 'kareem',
    mode: 'advice',
    bubbles: [{ text: 'Response' }],
    text: 'Full response text'
  });
  
  assert(payload.selected_character === 'kareem', 'character should match');
  assert(payload.final === true, 'final should be true');
  assert(payload.bubbles.length === 1, 'should have 1 bubble');
});

test('Payload: Biz decision payload', () => {
  const payload = createBizDecisionPayload({
    chatId: 'kareem',
    title: 'Start coffee shop',
    decision: 'REJECT',
    category: 'tomato'
  });
  
  assert(payload.decision === 'REJECT', 'decision should match');
  assert(payload.status === 'active', 'status should be active');
  assert(payload.decidedAt > 0, 'decidedAt should be set');
});

// ============================================================================
// TYPE UTILITY TESTS
// ============================================================================

test('Type Utils: isMessageType identifies correctly', () => {
  assert(isMessageType(STA_TYPES.CHAT_USER) === true, 'chat.user is message');
  assert(isMessageType(STA_TYPES.AI_ADVICE) === true, 'ai.advice is message');
  assert(isMessageType(STA_TYPES.BIZ_DECISION) === true, 'biz.decision is message');
  assert(isMessageType(STA_TYPES.CAPSULE_MINT) === false, 'capsule.mint is not message');
});

test('Type Utils: getMessageDirection', () => {
  assert(getMessageDirection(STA_TYPES.CHAT_USER) === 'out', 'user is out');
  assert(getMessageDirection(STA_TYPES.AI_ADVICE) === 'in', 'ai is in');
  assert(getMessageDirection(STA_TYPES.BIZ_DECISION) === 'out', 'decision is out');
});

test('Type Utils: getMessageTag', () => {
  assert(getMessageTag(STA_TYPES.BIZ_DECISION) === 'DECISION', 'decision tag');
  assert(getMessageTag(STA_TYPES.BIZ_OUTCOME) === 'OUTCOME', 'outcome tag');
  assert(getMessageTag(STA_TYPES.CHAT_USER) === null, 'no tag for chat');
});

// ============================================================================
// RUN TESTS
// ============================================================================

runTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
