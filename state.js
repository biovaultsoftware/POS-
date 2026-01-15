// BalanceChain State Module
// Production-ready chain operations with all STA type handling

import { STORES, STA_TYPES, GENESIS_HASH } from './constants.js';
import { 
  sha256Hex, 
  canonicalize 
} from './crypto.js';
import {
  openDatabase,
  txDone,
  reqDone,
  getMeta,
  setMeta,
  getChainHead,
  getChainLen,
  withStores
} from './idb.js';
import {
  createSegment,
  signSegment,
  getSignableContent,
  computeSegmentHash,
  isMessageType,
  getMessageDirection,
  getMessageTag
} from './segment.js';
import {
  validateSegment
} from './validation.js';

// ============================================================================
// STATE CLASS
// ============================================================================

/**
 * Main state manager for BalanceChain
 */
export class StateManager {
  constructor() {
    this.db = null;
    this.identity = null;
    this.capsTracker = null;
    this.chainIntegrityOk = true;
    this.listeners = new Map();
    
    // Projections (in-memory views)
    this.messages = new Map(); // chatId -> messages[]
    this.richScore = 0;
    this.businessScore = 0;
  }
  
  /**
   * Initialize the state manager
   * @param {Object} [options]
   * @param {Object} [options.identity] - Pre-loaded identity
   * @param {Object} [options.capsTracker] - Caps tracker instance
   * @returns {Promise<void>}
   */
  async init(options = {}) {
    console.log('[State] Initializing...');
    
    // Open database
    this.db = await openDatabase();
    
    // Set identity if provided
    if (options.identity) {
      this.identity = options.identity;
    }
    
    // Set caps tracker if provided
    if (options.capsTracker) {
      this.capsTracker = options.capsTracker;
    }
    
    // Rebuild projections from chain
    await this.rebuildProjections();
    
    console.log('[State] Initialized successfully');
  }
  
  /**
   * Commit a new action to the chain
   * @param {string} type - STA type
   * @param {Object} payload - Action payload
   * @param {Object} [options]
   * @param {string} [options.previousOwner] - For transfers
   * @returns {Promise<{ok: boolean, seq?: number, head?: string, reason?: string}>}
   */
  async commitAction(type, payload, options = {}) {
    if (!this.db) {
      return { ok: false, reason: 'not_initialized' };
    }
    
    if (!this.identity) {
      return { ok: false, reason: 'no_identity' };
    }
    
    try {
      // Get current chain state
      const prevHash = await getChainHead(this.db);
      const seq = (await getChainLen(this.db)) + 1;
      
      // Create segment
      const segment = createSegment({
        hid: this.identity.hid,
        pubJwk: this.identity.pubJwk,
        prevHash,
        seq,
        type,
        payload,
        previousOwner: options.previousOwner || null
      });
      
      // Sign segment
      const signedSegment = await signSegment(segment, this.identity.privateKey);
      
      // Validate before appending
      const validation = await validateSegment(this.db, signedSegment, {
        capsTracker: this.capsTracker,
        skipLivenessCheck: true // TODO: Enable when WebAuthn integrated
      });
      
      if (!validation.ok) {
        console.warn('[State] Validation failed:', validation);
        return { ok: false, reason: validation.reason, message: validation.message };
      }
      
      // Append to chain
      const result = await this.appendSTA(signedSegment);
      
      if (result.ok) {
        // Emit event
        this.emit('commit', { type, seq: result.seq, head: result.head });
      }
      
      return result;
      
    } catch (e) {
      console.error('[State] Commit error:', e);
      return { ok: false, reason: 'commit_error', message: e.message };
    }
  }
  
  /**
   * Append a signed STA to the chain (internal)
   * @param {Object} sta - Signed segment
   * @returns {Promise<{ok: boolean, seq?: number, head?: string, reason?: string}>}
   */
  async appendSTA(sta) {
    const storeNames = [
      STORES.STATE_CHAIN,
      STORES.SYNC_LOG,
      STORES.MESSAGES,
      STORES.META
    ];
    
    try {
      return await withStores(this.db, storeNames, 'readwrite', async (stores, tx) => {
        // Add to chain
        stores[STORES.STATE_CHAIN].add(sta);
        
        // Add nonce for replay protection
        stores[STORES.SYNC_LOG].add({ nonce: sta.nonce, ts: sta.timestamp });
        
        // Project to messages if applicable
        if (isMessageType(sta.type)) {
          const message = this.createMessageProjection(sta);
          stores[STORES.MESSAGES].add(message);
          
          // Update in-memory projection
          this.addToMessagesProjection(message);
        }
        
        // Update scores based on payload
        this.updateScores(sta);
        
        // Compute new head hash
        const signable = getSignableContent(sta);
        const newHead = await sha256Hex(signable + '|' + sta.signature);
        
        // Update meta
        stores[STORES.META].put({ key: 'chain_head', value: newHead });
        stores[STORES.META].put({ key: 'chain_len', value: sta.seq });
        
        console.log(`[Chain] Committed ${sta.type} at seq=${sta.seq}, head=${newHead.slice(0,8)}...`);
        
        return { ok: true, seq: sta.seq, head: newHead };
      });
      
    } catch (e) {
      console.error('[Chain] Append failed:', e);
      return { ok: false, reason: 'append_error', message: e.message };
    }
  }
  
  /**
   * Create message projection from STA
   * @param {Object} sta 
   * @returns {Object}
   */
  createMessageProjection(sta) {
    const payload = sta.payload || {};
    const direction = getMessageDirection(sta.type);
    const tag = getMessageTag(sta.type);
    
    return {
      id: `${sta.seq}:${sta.nonce}`,
      seq: sta.seq,
      ts: sta.timestamp,
      type: sta.type,
      peer: payload.chatId || payload.selected_character || null,
      dir: direction,
      tag: tag,
      text: payload.text || '',
      hid: sta.author?.hid || sta.current_owner,
      // Type-specific fields
      decision: payload.decision || null,
      outcome: payload.outcome || null,
      scores: payload.scores || null,
      bubbles: payload.bubbles || null
    };
  }
  
  /**
   * Add message to in-memory projection
   * @param {Object} message 
   */
  addToMessagesProjection(message) {
    const chatId = message.peer || 'default';
    
    if (!this.messages.has(chatId)) {
      this.messages.set(chatId, []);
    }
    
    this.messages.get(chatId).push(message);
  }
  
  /**
   * Update scores based on STA
   * @param {Object} sta 
   */
  updateScores(sta) {
    const scores = sta.payload?.scores;
    
    if (scores) {
      if (typeof scores.rich === 'number') {
        this.richScore = scores.rich;
      }
      if (typeof scores.business === 'number') {
        this.businessScore = scores.business;
      }
    }
    
    // Update based on decision outcomes
    if (sta.type === STA_TYPES.BIZ_DECISION) {
      if (sta.payload?.decision === 'ACCEPT') {
        this.richScore = Math.min(100, this.richScore + 2);
      }
    }
    
    if (sta.type === STA_TYPES.BIZ_OUTCOME) {
      if (sta.payload?.outcome === 'SUCCESS') {
        this.richScore = Math.min(100, this.richScore + 5);
        this.businessScore = Math.min(100, this.businessScore + 3);
      }
    }
  }
  
  /**
   * Rebuild all projections from chain
   * @returns {Promise<void>}
   */
  async rebuildProjections() {
    console.log('[State] Rebuilding projections...');
    
    this.messages.clear();
    this.richScore = 0;
    this.businessScore = 0;
    
    const chainLen = await getChainLen(this.db);
    
    if (chainLen === 0) {
      console.log('[State] Empty chain, nothing to rebuild');
      return;
    }
    
    // Read all STAs
    const tx = this.db.transaction([STORES.STATE_CHAIN], 'readonly');
    const store = tx.objectStore(STORES.STATE_CHAIN);
    const allSTAs = await reqDone(store.getAll());
    
    // Sort by sequence
    allSTAs.sort((a, b) => a.seq - b.seq);
    
    // Process each STA
    for (const sta of allSTAs) {
      if (isMessageType(sta.type)) {
        const message = this.createMessageProjection(sta);
        this.addToMessagesProjection(message);
      }
      
      this.updateScores(sta);
    }
    
    console.log(`[Rebuild] Processed ${allSTAs.length} STAs, richScore=${this.richScore}`);
  }
  
  /**
   * Get messages for a chat
   * @param {string} chatId 
   * @returns {Object[]}
   */
  getMessages(chatId) {
    return this.messages.get(chatId) || [];
  }
  
  /**
   * Get all chat IDs
   * @returns {string[]}
   */
  getChatIds() {
    return Array.from(this.messages.keys());
  }
  
  /**
   * Get current rich score
   * @returns {number}
   */
  getRichScore() {
    return this.richScore;
  }
  
  /**
   * Get current business score
   * @returns {number}
   */
  getBusinessScore() {
    return this.businessScore;
  }
  
  /**
   * Get current theme based on rich score
   * @returns {'coal'|'ember'|'bronze'|'gold'}
   */
  getTheme() {
    if (this.richScore < 25) return 'coal';
    if (this.richScore < 50) return 'ember';
    if (this.richScore < 80) return 'bronze';
    return 'gold';
  }
  
  /**
   * Get chain head hash
   * @returns {Promise<string>}
   */
  async getChainHead() {
    return await getChainHead(this.db);
  }
  
  /**
   * Get chain length
   * @returns {Promise<number>}
   */
  async getChainLen() {
    return await getChainLen(this.db);
  }
  
  // ============================================================================
  // EVENT SYSTEM
  // ============================================================================
  
  /**
   * Subscribe to events
   * @param {string} event 
   * @param {function} handler 
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
  }
  
  /**
   * Unsubscribe from events
   * @param {string} event 
   * @param {function} handler 
   */
  off(event, handler) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(handler);
    }
  }
  
  /**
   * Emit event
   * @param {string} event 
   * @param {any} data 
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const handler of this.listeners.get(event)) {
        try {
          handler(data);
        } catch (e) {
          console.error(`[State] Event handler error for ${event}:`, e);
        }
      }
    }
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const state = new StateManager();

// ============================================================================
// LEGACY COMPATIBILITY EXPORTS
// ============================================================================

// Re-export crypto functions for compatibility
export { canonicalize, sha256Hex } from './crypto.js';
export { getChainHead, getChainLen, getMeta, setMeta } from './idb.js';

/**
 * Legacy createSTA function
 * @deprecated Use state.commitAction() instead
 */
export async function createSTA({ hik, pubJwk }, prevHash, seq, type, payload) {
  console.warn('[Deprecated] createSTA is deprecated, use state.commitAction()');
  
  return createSegment({
    hid: hik, // Legacy name mapping
    pubJwk,
    prevHash,
    seq,
    type,
    payload
  });
}

/**
 * Legacy staSignable function
 * @deprecated Use getSignableContent() from segment.js
 */
export function staSignable(sta) {
  return getSignableContent(sta);
}

/**
 * Legacy appendSTA function
 * @deprecated Use state.commitAction() instead
 */
export async function appendSTA(db, sta, publicKey) {
  console.warn('[Deprecated] appendSTA is deprecated, use state.commitAction()');
  
  // Create temporary state manager for legacy call
  const tempState = new StateManager();
  tempState.db = db;
  
  return await tempState.appendSTA(sta);
}
