/**
 * TVM Token System - Production Implementation
 * =============================================
 * Human-Effort Digital Units (HEDU)
 * 
 * TVM = Human effort measurement unit
 * - Non-transferable (utility, not currency)
 * - Minted per validated capsule
 * - Quality-filtered (Rich ≥ 70, Business ≥ 70)
 * - Quantum-safe (SHA-384)
 * 
 * @version 1.0.0
 */

import { reqDone, txDone } from './idb.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const TVM_CONFIG = {
  // Validation thresholds
  MIN_RICH_SCORE: 70,
  MIN_BUSINESS_SCORE: 70,
  MIN_EFFORT_SCORE: 60,
  MIN_MESSAGES: 12,
  
  // Minting
  TVM_PER_CAPSULE: 1.0,
  MAX_MINTS_PER_DAY: 10,
  
  // Capsule quality
  MIN_TEXT_LENGTH: 50,      // Min chars per message
  MIN_UNIQUE_WORDS: 20,     // Min vocabulary
  MAX_CAPSULE_AGE_DAYS: 30, // Can't mint old capsules
};

const BUSINESS_KEYWORDS = [
  // English
  'revenue', 'profit', 'customer', 'client', 'product', 'service',
  'market', 'startup', 'company', 'business', 'strategy', 'sales',
  'pricing', 'cost', 'value', 'capital', 'investment', 'growth',
  'scale', 'leverage', 'roi', 'efficiency', 'productivity', 'system',
  'process', 'workflow', 'automation', 'team', 'hire', 'employee',
  'lease', 'rent', 'equity', 'ownership', 'partnership', 'contract',
  
  // Arabic
  'ربح', 'عميل', 'منتج', 'خدمة', 'سوق', 'شركة', 'تجارة', 'مشروع',
  'استراتيجية', 'مبيعات', 'تسعير', 'تكلفة', 'قيمة', 'استثمار',
  'نمو', 'توسع', 'كفاءة', 'إنتاجية', 'نظام', 'عملية', 'فريق'
];

// ═══════════════════════════════════════════════════════════════
// TVM TOKEN CLASS
// ═══════════════════════════════════════════════════════════════

export class TVMToken {
  constructor({
    id = null,
    capsuleHash,
    richScore,
    businessScore,
    effortScore,
    messageCount,
    hid,
    timestamp = Date.now(),
    metadata = {}
  }) {
    this.id = id || this._generateId();
    this.capsuleHash = capsuleHash;
    this.richScore = richScore;
    this.businessScore = businessScore;
    this.effortScore = effortScore;
    this.messageCount = messageCount;
    this.hid = hid;
    this.timestamp = timestamp;
    this.metadata = metadata;
    this.amount = TVM_CONFIG.TVM_PER_CAPSULE;
    this.transferable = false; // Non-transferable by design
    this.type = 'HEDU'; // Human-Effort Digital Unit
    this.version = 1;
  }

  _generateId() {
    return `TVM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  toJSON() {
    return {
      id: this.id,
      capsuleHash: this.capsuleHash,
      scores: {
        rich: this.richScore,
        business: this.businessScore,
        effort: this.effortScore
      },
      messageCount: this.messageCount,
      hid: this.hid,
      timestamp: this.timestamp,
      amount: this.amount,
      transferable: false,
      type: this.type,
      metadata: this.metadata,
      version: this.version
    };
  }

  static fromJSON(json) {
    return new TVMToken({
      id: json.id,
      capsuleHash: json.capsuleHash,
      richScore: json.scores?.rich || 0,
      businessScore: json.scores?.business || 0,
      effortScore: json.scores?.effort || 0,
      messageCount: json.messageCount || 0,
      hid: json.hid,
      timestamp: json.timestamp,
      metadata: json.metadata || {}
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// CAPSULE CLASS
// ═══════════════════════════════════════════════════════════════

export class Capsule {
  constructor({
    id = null,
    chatId,
    messages = [],
    richScore = 0,
    businessScore = 0,
    effortScore = 0,
    hid,
    timestamp = Date.now(),
    status = 'pending',
    metadata = {}
  }) {
    this.id = id || this._generateId();
    this.chatId = chatId;
    this.messages = messages;
    this.richScore = richScore;
    this.businessScore = businessScore;
    this.effortScore = effortScore;
    this.messageCount = messages.length;
    this.hid = hid;
    this.timestamp = timestamp;
    this.status = status; // 'pending', 'valid', 'invalid', 'minted'
    this.metadata = metadata;
    this.hash = null;
  }

  _generateId() {
    return `CAP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Compute quantum-resistant hash of capsule
   */
  async computeHash() {
    const data = JSON.stringify({
      id: this.id,
      chatId: this.chatId,
      messages: this.messages.map(m => ({
        role: m.role,
        text: m.text
      })),
      scores: {
        rich: this.richScore,
        business: this.businessScore,
        effort: this.effortScore
      },
      messageCount: this.messageCount,
      timestamp: this.timestamp
    });

    const buffer = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-384', buffer);
    this.hash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return this.hash;
  }

  toJSON() {
    return {
      id: this.id,
      chatId: this.chatId,
      messages: this.messages,
      richScore: this.richScore,
      businessScore: this.businessScore,
      effortScore: this.effortScore,
      messageCount: this.messageCount,
      hid: this.hid,
      timestamp: this.timestamp,
      status: this.status,
      hash: this.hash,
      metadata: this.metadata
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// CAPSULE VALIDATOR
// ═══════════════════════════════════════════════════════════════

export class CapsuleValidator {
  /**
   * Validate capsule against quality thresholds
   */
  static validate(capsule) {
    const errors = [];
    const warnings = [];

    // 1. Score thresholds
    if (capsule.richScore < TVM_CONFIG.MIN_RICH_SCORE) {
      errors.push(`Rich score too low: ${capsule.richScore} < ${TVM_CONFIG.MIN_RICH_SCORE}`);
    }

    if (capsule.businessScore < TVM_CONFIG.MIN_BUSINESS_SCORE) {
      errors.push(`Business score too low: ${capsule.businessScore} < ${TVM_CONFIG.MIN_BUSINESS_SCORE}`);
    }

    if (capsule.effortScore < TVM_CONFIG.MIN_EFFORT_SCORE) {
      errors.push(`Effort score too low: ${capsule.effortScore} < ${TVM_CONFIG.MIN_EFFORT_SCORE}`);
    }

    // 2. Message count
    if (capsule.messageCount < TVM_CONFIG.MIN_MESSAGES) {
      errors.push(`Not enough messages: ${capsule.messageCount} < ${TVM_CONFIG.MIN_MESSAGES}`);
    }

    // 3. Message quality
    const qualityCheck = this._validateMessageQuality(capsule.messages);
    if (!qualityCheck.valid) {
      errors.push(...qualityCheck.errors);
    }
    warnings.push(...qualityCheck.warnings);

    // 4. Business content
    const businessCheck = this._validateBusinessContent(capsule.messages);
    if (!businessCheck.valid) {
      errors.push(...businessCheck.errors);
    }

    // 5. Age check
    const age = Date.now() - capsule.timestamp;
    const maxAge = TVM_CONFIG.MAX_CAPSULE_AGE_DAYS * 24 * 60 * 60 * 1000;
    if (age > maxAge) {
      errors.push(`Capsule too old: ${Math.floor(age / (24*60*60*1000))} days`);
    }

    // 6. Duplicate detection (handled in minting)

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      score: this._calculateOverallScore(capsule)
    };
  }

  /**
   * Validate message quality (length, vocabulary, depth)
   */
  static _validateMessageQuality(messages) {
    const errors = [];
    const warnings = [];

    let totalLength = 0;
    let uniqueWords = new Set();
    let tooShortCount = 0;

    for (const msg of messages) {
      const text = msg.text || '';
      totalLength += text.length;

      // Check minimum length
      if (text.length < TVM_CONFIG.MIN_TEXT_LENGTH) {
        tooShortCount++;
      }

      // Collect unique words
      const words = text.toLowerCase()
        .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);
      
      words.forEach(w => uniqueWords.add(w));
    }

    // Check average message length
    const avgLength = totalLength / messages.length;
    if (avgLength < TVM_CONFIG.MIN_TEXT_LENGTH) {
      errors.push(`Messages too short on average: ${Math.floor(avgLength)} chars`);
    }

    // Check vocabulary diversity
    if (uniqueWords.size < TVM_CONFIG.MIN_UNIQUE_WORDS) {
      errors.push(`Vocabulary too limited: ${uniqueWords.size} unique words`);
    }

    // Too many short messages
    if (tooShortCount > messages.length / 2) {
      warnings.push(`${tooShortCount} messages are very short`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate business content
   */
  static _validateBusinessContent(messages) {
    const errors = [];
    let businessKeywordCount = 0;

    for (const msg of messages) {
      const text = (msg.text || '').toLowerCase();
      for (const keyword of BUSINESS_KEYWORDS) {
        if (text.includes(keyword)) {
          businessKeywordCount++;
        }
      }
    }

    // Need at least 3 business keywords per message on average
    const minKeywords = messages.length * 3;
    if (businessKeywordCount < minKeywords) {
      errors.push(`Insufficient business content: ${businessKeywordCount} keywords (need ${minKeywords})`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Calculate overall quality score
   */
  static _calculateOverallScore(capsule) {
    return (
      capsule.richScore * 0.4 +
      capsule.businessScore * 0.4 +
      capsule.effortScore * 0.2
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// SCORE CALCULATORS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate Rich score from messages (Rush → Rich transformation)
 */
export function calculateRichScore(messages, currentRichScore = 30) {
  let score = currentRichScore;

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.final?.decision) {
      // ACCEPT decisions increase score
      if (msg.final.decision === 'ACCEPT') {
        score += 4;
      }
      // CAUTION decreases score
      else if (msg.final.decision === 'CAUTION') {
        score -= 2;
      }
    }
  }

  // Clamp to [0, 100]
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate Business score based on content
 */
export function calculateBusinessScore(messages) {
  let score = 0;
  let businessTermCount = 0;
  let totalWords = 0;

  for (const msg of messages) {
    const text = (msg.text || '').toLowerCase();
    const words = text.split(/\s+/).filter(w => w.length > 2);
    totalWords += words.length;

    for (const keyword of BUSINESS_KEYWORDS) {
      if (text.includes(keyword)) {
        businessTermCount++;
      }
    }
  }

  // Score based on business term density
  if (totalWords > 0) {
    const density = (businessTermCount / totalWords) * 100;
    score = Math.min(100, density * 10); // Scale to 0-100
  }

  // Bonus for variety of terms
  const uniqueTerms = new Set();
  for (const msg of messages) {
    const text = (msg.text || '').toLowerCase();
    for (const keyword of BUSINESS_KEYWORDS) {
      if (text.includes(keyword)) {
        uniqueTerms.add(keyword);
      }
    }
  }

  score += Math.min(30, uniqueTerms.size * 2);

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate Effort score based on message complexity
 */
export function calculateEffortScore(messages) {
  let totalComplexity = 0;

  for (const msg of messages) {
    const text = msg.text || '';
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    
    // Vocabulary diversity
    const diversity = words.length > 0 ? (uniqueWords.size / words.length) : 0;
    
    // Message length
    const lengthScore = Math.min(1, text.length / 200);
    
    // Complexity score
    const complexity = (diversity * 0.6 + lengthScore * 0.4) * 100;
    totalComplexity += complexity;
  }

  const avgComplexity = messages.length > 0 ? totalComplexity / messages.length : 0;
  return Math.max(0, Math.min(100, avgComplexity));
}

// ═══════════════════════════════════════════════════════════════
// TVM MINTING
// ═══════════════════════════════════════════════════════════════

/**
 * Mint TVM token for validated capsule
 */
export async function mintTVM(db, capsule, identity) {
  try {
    // 1. Validate capsule quality
    const validation = CapsuleValidator.validate(capsule);
    if (!validation.valid) {
      return { 
        ok: false, 
        reason: 'capsule_invalid', 
        errors: validation.errors,
        score: validation.score
      };
    }

    // 2. Compute capsule hash
    if (!capsule.hash) {
      await capsule.computeHash();
    }

    // 3. Check for duplicate mint
    const existing = await checkExistingMint(db, capsule.hash);
    if (existing) {
      return { 
        ok: false, 
        reason: 'already_minted', 
        tokenId: existing.id 
      };
    }

    // 4. Check daily mint limit
    const todayMints = await getTodayMintCount(db, identity.hid);
    if (todayMints >= TVM_CONFIG.MAX_MINTS_PER_DAY) {
      return { 
        ok: false, 
        reason: 'daily_limit_exceeded',
        limit: TVM_CONFIG.MAX_MINTS_PER_DAY
      };
    }

    // 5. Create TVM token
    const token = new TVMToken({
      capsuleHash: capsule.hash,
      richScore: capsule.richScore,
      businessScore: capsule.businessScore,
      effortScore: capsule.effortScore,
      messageCount: capsule.messageCount,
      hid: identity.hid,
      metadata: {
        chatId: capsule.chatId,
        validationScore: validation.score
      }
    });

    // 6. Atomic transaction: store token + update balance + mark capsule
    const tx = db.transaction(['tvm_tokens', 'capsules', 'meta'], 'readwrite');
    
    try {
      // Store token
      await reqDone(tx.objectStore('tvm_tokens').add(token.toJSON()));
      
      // Update capsule status
      capsule.status = 'minted';
      await reqDone(tx.objectStore('capsules').put(capsule.toJSON()));
      
      // Update balance
      const balanceKey = `tvm_balance:${identity.hid}`;
      const balanceStore = tx.objectStore('meta');
      const currentBalance = (await reqDone(balanceStore.get(balanceKey)))?.value || 0;
      await reqDone(balanceStore.put({ 
        key: balanceKey, 
        value: currentBalance + token.amount 
      }));

      // Update mint count
      const mintCountKey = `tvm_mint_count:${identity.hid}:${new Date().toISOString().split('T')[0]}`;
      const currentCount = (await reqDone(balanceStore.get(mintCountKey)))?.value || 0;
      await reqDone(balanceStore.put({ 
        key: mintCountKey, 
        value: currentCount + 1 
      }));

      await txDone(tx);

      return { 
        ok: true, 
        token,
        newBalance: currentBalance + token.amount,
        validationScore: validation.score
      };

    } catch (error) {
      try { tx.abort(); } catch {}
      throw error;
    }

  } catch (error) {
    console.error('[TVM] Minting error:', error);
    return { 
      ok: false, 
      reason: 'exception', 
      error: error.message 
    };
  }
}

/**
 * Check if capsule already minted
 */
async function checkExistingMint(db, capsuleHash) {
  const tx = db.transaction(['tvm_tokens'], 'readonly');
  const store = tx.objectStore('tvm_tokens');
  const index = store.index('byCapsuleHash');
  const existing = await reqDone(index.get(capsuleHash));
  await txDone(tx);
  return existing;
}

/**
 * Get today's mint count for user
 */
async function getTodayMintCount(db, hid) {
  const today = new Date().toISOString().split('T')[0];
  const key = `tvm_mint_count:${hid}:${today}`;
  
  const tx = db.transaction(['meta'], 'readonly');
  const result = await reqDone(tx.objectStore('meta').get(key));
  await txDone(tx);
  
  return result?.value || 0;
}

/**
 * Get user's TVM balance
 */
export async function getTVMBalance(db, hid) {
  const key = `tvm_balance:${hid}`;
  const tx = db.transaction(['meta'], 'readonly');
  const result = await reqDone(tx.objectStore('meta').get(key));
  await txDone(tx);
  return result?.value || 0;
}

/**
 * Get user's TVM tokens
 */
export async function getUserTokens(db, hid, limit = 50) {
  const tx = db.transaction(['tvm_tokens'], 'readonly');
  const index = tx.objectStore('tvm_tokens').index('byHid');
  const tokens = await reqDone(index.getAll(hid));
  await txDone(tx);
  
  return tokens
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

/**
 * Create capsule from chat session
 */
export async function createCapsule(db, chatId, messages, scores, identity) {
  const capsule = new Capsule({
    chatId,
    messages,
    richScore: scores.rich,
    businessScore: scores.business,
    effortScore: scores.effort,
    hid: identity.hid,
    metadata: {
      userAgent: navigator.userAgent,
      language: navigator.language
    }
  });

  await capsule.computeHash();

  // Store capsule
  const tx = db.transaction(['capsules'], 'readwrite');
  await reqDone(tx.objectStore('capsules').add(capsule.toJSON()));
  await txDone(tx);

  return capsule;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  TVMToken,
  Capsule,
  CapsuleValidator,
  mintTVM,
  getTVMBalance,
  getUserTokens,
  createCapsule,
  calculateRichScore,
  calculateBusinessScore,
  calculateEffortScore,
  CONFIG: TVM_CONFIG
};
