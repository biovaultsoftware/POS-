/**
 * Sovereign Business OS — Production Main Controller
 * ====================================================
 * Offline-first, cryptographically-signed state chain PWA.
 * 
 * Architecture:
 * - BalanceChain (state.js) is the ONLY source of truth
 * - All events become signed STAs on an append-only chain
 * - UI reads from projections (messages store) for performance
 * - KB index provides offline full-text search
 * 
 * Locked API (state.js):
 * - createSTA({ hik, pubJwk }, prevHash, seq, type, payload)
 * - staSignable(sta) → canonical string
 * - sign(privateKey, signable) → base64 signature
 * - appendSTA(db, sta, publicKey) → { ok, head, len, reason? }
 * - getChainHead(db) → hash | 'GENESIS'
 * - getChainLen(db) → integer
 */

import { openDB, txDone, reqDone } from './idb.js';
import {
  createSTA,
  staSignable,
  sign,
  appendSTA,
  getChainHead,
  getChainLen,
  exportKeyJwk,
  importPubKeyJwk,
  canonicalize,
  sha256Hex,
  verify
} from './state.js';
import { kbUpsertMessage, kbSearch } from './kb.js';
import { SignalClient } from './signal.js';
import { P2PManager } from './p2p.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  SIGNAL_URLS: ['wss://signal.rr-rshemodel.workers.dev/signal'],
  INTEGRITY_CHECK_DEPTH: 20,
  DB_NAME: 'sovereign_os_v1',
  DB_VERSION: 1,
  
  // Worker endpoint (set to your deployed worker URL)
  WORKER_URL: 'https://human1stai.rr-rshemodel.workers.dev',
  WORKER_TIMEOUT: 25000,
  
  // UI behavior
  MAX_HISTORY_FOR_WORKER: 20,
  TYPING_DELAY_MS: 600,
  TOAST_DURATION_MS: 3000,
  
  // Chain integrity
  INTEGRITY_CHECK_DEPTH: 20,
  
  // Rich/Rush scoring
  SCORE_BASE: 30,
  SCORE_ACCEPT: 4,
  SCORE_CAUTION: -2,
  SCORE_SUCCESS_OUTCOME: 10,
  SCORE_MIN: 0,
  SCORE_MAX: 100,
};

// ═══════════════════════════════════════════════════════════════
// COUNCIL OF 10 PERSONAS
// ═══════════════════════════════════════════════════════════════

const COUNCIL = [
  { id: 'kareem', name: 'Kareem', role: 'Laziness', status: 'Work less, earn more.', emoji: '😴', accent: '#f59e0b' },
  { id: 'turbo', name: 'Turbo', role: 'Speed', status: 'Results by Friday.', emoji: '⚡', accent: '#22c55e' },
  { id: 'wolf', name: 'Wolf', role: 'Greed', status: 'Leverage & ROI.', emoji: '🐺', accent: '#ef4444' },
  { id: 'luna', name: 'Luna', role: 'Satisfaction', status: 'Quality of life matters.', emoji: '🌙', accent: '#ec4899' },
  { id: 'captain', name: 'Captain', role: 'Security', status: 'Build the fortress first.', emoji: '🛡️', accent: '#3b82f6' },
  { id: 'tempo', name: 'Tempo', role: 'Time Auditor', status: 'You are dying. Calculate.', emoji: '⏱️', accent: '#6366f1' },
  { id: 'hakim', name: 'Hakim', role: 'Wisdom', status: 'Stories hide truth.', emoji: '📖', accent: '#8b5cf6' },
  { id: 'wheat', name: 'Uncle Wheat', role: 'Necessity', status: 'Sell what they need.', emoji: '🌾', accent: '#a3a3a3' },
  { id: 'tommy', name: 'Tommy', role: 'Added Value', status: 'Brand it! Hype it!', emoji: '🅰️', accent: '#f43f5e' },
  { id: 'architect', name: 'Architect', role: 'System', status: 'Work ON the system.', emoji: '🏛️', accent: '#fbbf24' }
];

const OPENER = {
  kareem: "What's draining your energy that we can automate or delete?",
  turbo: "What can you ship in the next 48 hours?",
  wolf: "What's your current ROI on time?",
  luna: "Are you building something that excites you?",
  captain: "How many months of runway do you have?",
  tempo: "How many hours did you waste today?",
  hakim: "Tell me your situation. I have a story for you.",
  wheat: "What are you selling — a need or a want?",
  tommy: "How can we make your offer more exciting?",
  architect: "What system are you trying to build?"
};

// ═══════════════════════════════════════════════════════════════
// APPLICATION STATE (in-memory, rebuilt from chain on boot)
// ═══════════════════════════════════════════════════════════════

const state = {
  signal: null,
  p2p: null,
  db: null,
  identity: null, // { hik, hid, privateKey, publicKey, pubJwk }
  
  // Derived from chain
  richScore: CONFIG.SCORE_BASE,
  chainIntegrityOk: true,
  
  // UI state
  activeChatId: null,
  route: 'home', // 'home' | 'chat'
  isLocked: true,
  isSending: false,
  
  // Projections (rebuilt from chain)
  threads: new Map(), // chatId → { lastTs, lastPreview, msgCount, userMsgCount }
  messages: new Map(), // chatId → [{ id, seq, ts, text, role, dir, tag, speaker }]
};

// ═══════════════════════════════════════════════════════════════
// DOM CACHE
// ═══════════════════════════════════════════════════════════════

const $ = (sel) => document.querySelector(sel);
const DOM = {};

function cacheDom() {
  DOM.lockScreen = $('#lockScreen');
  DOM.btnUnlock = $('#btnUnlock');
  DOM.btnUnlockDemo = $('#btnUnlockDemo');
  DOM.app = $('#app');
  DOM.sidebar = $('#sidebar');
  DOM.chatList = $('#chatList');
  DOM.searchInput = $('#searchInput');
  DOM.emptyState = $('#emptyState');
  DOM.chatHeader = $('#chatHeader');
  DOM.btnBack = $('#btnBack');
  DOM.headerAvatar = $('#headerAvatar');
  DOM.headerName = $('#headerName');
  DOM.headerStatus = $('#headerStatus');
  DOM.thread = $('#thread');
  DOM.composer = $('#composer');
  DOM.msgInput = $('#msgInput');
  DOM.btnSend = $('#btnSend');
    DOM.btnShare = $('#btnShare');
    DOM.btnImport = $('#btnImport');
    DOM.btnDecision = $('#btnDecision');
    DOM.btnOutcome = $('#btnOutcome');
    DOM.modalDecision = $('#modalDecision');
    DOM.modalOutcome = $('#modalOutcome');
    DOM.decisionForm = $('#decisionForm');
    DOM.outcomeForm = $('#outcomeForm');
    DOM.btnModalClose1 = $('#btnDecisionClose');
    DOM.btnModalClose2 = $('#btnOutcomeClose');
  DOM.toast = $('#toast');
  DOM.toastText = $('#toastText');
  DOM.themeToggle = $('#themeToggle');
  
  // Gauges
  DOM.rushBar = $('#rushBar');
  DOM.richBar = $('#richBar');
  DOM.rushValue = $('#rushValue');
  DOM.richValue = $('#richValue');
  
  // KB Search
  DOM.brainQuery = $('#brainQuery');
  DOM.brainAsk = $('#brainAsk');
  DOM.brainAnswer = $('#brainAnswer');
  
  // Chain status
  DOM.chainHead = $('#head') || $('#chainHead');
  DOM.chainLen = $('#len') || $('#chainLen');
  DOM.mePill = $('#mePill');
}

// ═══════════════════════════════════════════════════════════════
// DATABASE INITIALIZATION
// ═══════════════════════════════════════════════════════════════

async function initDB() {
  state.db = await openDB(CONFIG.DB_NAME, CONFIG.DB_VERSION, {
    upgrade(db, oldVersion, newVersion) {
      console.log(`[DB] Upgrading from v${oldVersion} to v${newVersion}`);
      
      // Core chain stores (required by state.js)
      if (!db.objectStoreNames.contains('state_chain')) {
        db.createObjectStore('state_chain', { keyPath: 'seq' });
      }
      if (!db.objectStoreNames.contains('sync_log')) {
        db.createObjectStore('sync_log', { keyPath: 'nonce' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('byChatTs', ['chatId', 'ts']);
        msgStore.createIndex('bySeq', 'seq');
      }
      
      // Identity store
      if (!db.objectStoreNames.contains('keys')) {
        db.createObjectStore('keys', { keyPath: 'name' });
      }
      
      // Threads projection (optional but recommended)
      if (!db.objectStoreNames.contains('threads')) {
        db.createObjectStore('threads', { keyPath: 'chatId' });
      }
      
      // KB stores (for offline search)
      if (!db.objectStoreNames.contains('kb_docs')) {
        db.createObjectStore('kb_docs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('kb_terms')) {
        db.createObjectStore('kb_terms', { keyPath: 'term' });
      }
      if (!db.objectStoreNames.contains('kb_entities')) {
        db.createObjectStore('kb_entities', { keyPath: 'key' });
      }
    }
  });
  
  console.log('[DB] Database initialized:', CONFIG.DB_NAME);
}

// ═══════════════════════════════════════════════════════════════
// IDENTITY MANAGEMENT
// ═══════════════════════════════════════════════════════════════

async function loadOrCreateIdentity() {
  const tx = state.db.transaction(['keys'], 'readonly');
  const existing = await reqDone(tx.objectStore('keys').get('identity'));
  await txDone(tx);
  
  if (existing?.pubJwk && existing?.privateJwk && existing?.hik) {
    // Restore existing identity
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      existing.privateJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign']
    );
    const publicKey = await importPubKeyJwk(existing.pubJwk);
    
    state.identity = {
      hik: existing.hik,
      hid: existing.hid || await computeHID(existing.pubJwk),
      privateKey,
      publicKey,
      pubJwk: existing.pubJwk
    };
    
    console.log('[Identity] Restored:', state.identity.hid);
    return;
  }
  
  // Generate new identity
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  
  const pubJwk = await exportKeyJwk(keyPair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const hik = 'HIK-' + await randomHexLocal(12);
  const hid = await computeHID(pubJwk);
  
  // Persist to DB
  const wtx = state.db.transaction(['keys'], 'readwrite');
  wtx.objectStore('keys').put({
    name: 'identity',
    hik,
    hid,
    pubJwk,
    privateJwk
  });
  await txDone(wtx);
  
  state.identity = {
    hik,
    hid,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    pubJwk
  };
  
  console.log('[Identity] Created new:', state.identity.hid);
}

async function computeHID(pubJwk) {
  const pick = { kty: pubJwk.kty, crv: pubJwk.crv, x: pubJwk.x, y: pubJwk.y };
  const hash = await sha256Hex(canonicalize(pick));
  return 'HID-' + hash.slice(0, 40);
}

async function randomHexLocal(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ═══════════════════════════════════════════════════════════════
// CHAIN OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Commit an action to the chain.
 * This is the ONLY way to write data in this app.
 * 
 * @param {string} type - STA type (e.g., 'chat.user', 'ai.advice')
 * @param {object} payload - Type-specific payload
 * @returns {Promise<{ok: boolean, head?: string, len?: number, reason?: string, sta?: object}>}
 */
async function commitAction(type, payload) {
  const { hik, pubJwk, privateKey, publicKey } = state.identity;
  
  // 1. Get chain state
  const prevHash = await getChainHead(state.db);
  const seq = (await getChainLen(state.db)) + 1;
  
  // 2. Create STA
  const sta = await createSTA({ hik, pubJwk }, prevHash, seq, type, payload);
  
  // 3. Sign it
  const signable = staSignable(sta);
  sta.signature = await sign(privateKey, signable);
  
  // 4. Append to chain (atomic)
  const result = await appendSTA(state.db, sta, publicKey);
  
  if (!result.ok) {
    console.error('[Chain] Append failed:', result.reason, result.error);
    showToast(`⚠️ Chain error: ${result.reason}`);
    return result;
  }
  
  // 5. Project to UI stores (post-append, non-atomic is OK for projections)
  await projectSTA(sta, result.head);
  
  console.log(`[Chain] Committed ${type} at seq=${seq}, head=${result.head.slice(0, 16)}…`);
  
  return { ...result, sta };
}

/**
 * Project a committed STA to fast-read stores (messages, threads, KB).
 * Called AFTER successful appendSTA.
 */
async function projectSTA(sta, head) {
  const { type, payload, seq, timestamp, nonce, hik } = sta;
  const chatId = payload?.chatId || payload?.threadId || state.activeChatId || 'default';
  
  let msgRecord = null;
  
  switch (type) {
    case 'chat.user':
      msgRecord = {
        id: `${seq}:${nonce}`,
        chatId,
        seq,
        ts: timestamp,
        text: String(payload.text || ''),
        role: 'user',
        dir: 'out',
        tag: payload.tags?.[0] || null,
        hik
      };
      break;
      
    case 'ai.advice':
      // Extract display text from various response formats
      let displayText = payload.text || payload.replyText || '';
      if (!displayText && Array.isArray(payload.bubbles) && payload.bubbles.length > 0) {
        displayText = payload.bubbles.map(b => {
          const speaker = b.speaker || 'AI';
          const text = typeof b.text === 'string' ? b.text : JSON.stringify(b.text);
          return payload.mode === 'council_debate' ? `${speaker}: ${text}` : text;
        }).join('\n\n');
      }
      
      msgRecord = {
        id: `${seq}:${nonce}`,
        chatId,
        seq,
        ts: timestamp,
        text: displayText,
        role: 'assistant',
        dir: 'in',
        tag: payload.final?.decision || null,
        speaker: payload.selected_character || null,
        mode: payload.mode || 'reply',
        hik
      };
      break;
      
    case 'biz.decision':
      msgRecord = {
        id: `${seq}:${nonce}`,
        chatId,
        seq,
        ts: timestamp,
        text: `${payload.title || 'Decision'} • ${payload.decision || 'PENDING'}`,
        role: 'system',
        dir: 'in',
        tag: 'DECISION',
        hik
      };
      break;
      
    case 'biz.outcome':
      msgRecord = {
        id: `${seq}:${nonce}`,
        chatId,
        seq,
        ts: timestamp,
        text: `${payload.outcome || 'UNKNOWN'} • Decision #${payload.decisionSeq}`,
        role: 'system',
        dir: 'in',
        tag: 'OUTCOME',
        hik
      };
      break;
      
    case 'chat.append':
      // Legacy compatibility (original BalanceChain type)
      // Note: appendSTA already writes this to messages store
      msgRecord = {
        id: `${seq}:${nonce}`,
        chatId: 'legacy',
        seq,
        ts: timestamp,
        text: String(payload.text || ''),
        role: 'user',
        dir: 'out',
        hik
      };
      break;
      
    default:
      console.log(`[Projection] Unknown type: ${type}, skipping projection`);
      return;
  }
  
  if (msgRecord) {
    // Write to messages store
    try {
      const tx = state.db.transaction(['messages'], 'readwrite');
      tx.objectStore('messages').put(msgRecord);
      await txDone(tx);
    } catch (e) {
      // Might already exist from appendSTA's internal write (for chat.append)
      console.log('[Projection] Message write:', e.message || 'duplicate key');
    }
    
    // Update in-memory cache
    if (!state.messages.has(chatId)) {
      state.messages.set(chatId, []);
    }
    state.messages.get(chatId).push(msgRecord);
    
    // Update thread metadata
    await updateThreadMeta(chatId, msgRecord);
    
    // Index in KB for search
    try {
      await kbUpsertMessage(state.db, {
        id: msgRecord.id,
        peerHid: chatId,
        dir: msgRecord.dir,
        ts: msgRecord.ts,
        text: msgRecord.text
      });
    } catch (e) {
      console.warn('[KB] Index error:', e.message);
    }
  }
}

async function updateThreadMeta(chatId, msg) {
  let thread = state.threads.get(chatId);
  if (!thread) {
    thread = { chatId, lastTs: 0, lastPreview: '', msgCount: 0, userMsgCount: 0 };
    state.threads.set(chatId, thread);
  }
  
  thread.lastTs = msg.ts;
  thread.lastPreview = truncate(msg.text, 40);
  thread.msgCount++;
  if (msg.role === 'user') {
    thread.userMsgCount++;
  }
  
  // Persist to threads store
  try {
    const tx = state.db.transaction(['threads'], 'readwrite');
    tx.objectStore('threads').put(thread);
    await txDone(tx);
  } catch (e) {
    console.warn('[Threads] Update error:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// CHAIN INTEGRITY CHECK
// ═══════════════════════════════════════════════════════════════

async function verifyChainIntegrity() {
  const depth = CONFIG.INTEGRITY_CHECK_DEPTH;
  const chainLen = await getChainLen(state.db);
  
  if (chainLen === 0) {
    console.log('[Integrity] Empty chain, OK');
    state.chainIntegrityOk = true;
    return true;
  }
  
  const startSeq = Math.max(1, chainLen - depth + 1);
  
  // Load STAs to verify
  const tx = state.db.transaction(['state_chain'], 'readonly');
  const store = tx.objectStore('state_chain');
  const stas = [];
  
  for (let seq = startSeq; seq <= chainLen; seq++) {
    const sta = await reqDone(store.get(seq));
    if (sta) stas.push(sta);
  }
  await txDone(tx);
  
  // Verify chain links and signatures
  let prevExpectedHash = null;
  
  for (let i = 0; i < stas.length; i++) {
    const sta = stas[i];
    
    // Verify signature
    const signable = staSignable(sta);
    const pubKey = await importPubKeyJwk(sta.author.pubJwk);
    const sigOk = await verify(pubKey, signable, sta.signature);
    
    if (!sigOk) {
      console.error(`[Integrity] Bad signature at seq=${sta.seq}`);
      state.chainIntegrityOk = false;
      showToast('⚠️ Chain integrity error: bad signature');
      return false;
    }
    
    // Verify prev_hash link (skip first in window)
    if (i > 0 && sta.prev_hash !== prevExpectedHash) {
      console.error(`[Integrity] Broken link at seq=${sta.seq}`);
      state.chainIntegrityOk = false;
      showToast('⚠️ Chain integrity error: broken link');
      return false;
    }
    
    // Compute expected hash for next iteration
    prevExpectedHash = await sha256Hex(signable + '|' + sta.signature);
  }
  
  // Verify meta matches
  const storedHead = await getChainHead(state.db);
  if (storedHead !== 'GENESIS' && prevExpectedHash && storedHead !== prevExpectedHash) {
    console.error('[Integrity] Head mismatch');
    state.chainIntegrityOk = false;
    showToast('⚠️ Chain integrity error: head mismatch');
    return false;
  }
  
  console.log(`[Integrity] Verified ${stas.length} blocks, OK`);
  state.chainIntegrityOk = true;
  return true;
}

// ═══════════════════════════════════════════════════════════════
// REPLAY & PROJECTION REBUILD
// ═══════════════════════════════════════════════════════════════

async function rebuildProjections() {
  console.log('[Rebuild] Replaying chain to rebuild projections...');
  
  // Clear in-memory state
  state.messages.clear();
  state.threads.clear();
  state.richScore = CONFIG.SCORE_BASE;
  
  // Load all STAs
  const tx = state.db.transaction(['state_chain'], 'readonly');
  const allSTAs = await reqDone(tx.objectStore('state_chain').getAll());
  await txDone(tx);
  
  allSTAs.sort((a, b) => a.seq - b.seq);
  
  // Replay each STA to rebuild projections
  for (const sta of allSTAs) {
    // Compute hash for this STA (for projection)
    const signable = staSignable(sta);
    const head = await sha256Hex(signable + '|' + sta.signature);
    
    // Re-project (but don't re-index to KB, too slow)
    await projectSTAToMemory(sta, head);
    
    // Update rich/rush score
    updateScoreFromSTA(sta);
  }
  
  console.log(`[Rebuild] Replayed ${allSTAs.length} STAs, richScore=${state.richScore}`);
}

/**
 * Project STA to memory only (for replay, no DB writes).
 */
async function projectSTAToMemory(sta, head) {
  const { type, payload, seq, timestamp, nonce, hik } = sta;
  const chatId = payload?.chatId || payload?.threadId || 'default';
  
  let msgRecord = null;
  
  switch (type) {
    case 'chat.user':
      msgRecord = {
        id: `${seq}:${nonce}`,
        chatId,
        seq,
        ts: timestamp,
        text: String(payload.text || ''),
        role: 'user',
        dir: 'out',
        tag: payload.tags?.[0] || null,
        hik
      };
      break;
      
    case 'ai.advice':
      let displayText = payload.text || payload.replyText || '';
      if (!displayText && Array.isArray(payload.bubbles) && payload.bubbles.length > 0) {
        displayText = payload.bubbles.map(b => {
          const speaker = b.speaker || 'AI';
          const text = typeof b.text === 'string' ? b.text : JSON.stringify(b.text);
          return payload.mode === 'council_debate' ? `${speaker}: ${text}` : text;
        }).join('\n\n');
      }
      
      msgRecord = {
        id: `${seq}:${nonce}`,
        chatId,
        seq,
        ts: timestamp,
        text: displayText,
        role: 'assistant',
        dir: 'in',
        tag: payload.final?.decision || null,
        speaker: payload.selected_character || null,
        mode: payload.mode || 'reply',
        hik
      };
      break;
      
    case 'biz.decision':
      msgRecord = {
        id: `${seq}:${nonce}`,
        chatId,
        seq,
        ts: timestamp,
        text: `${payload.title || 'Decision'} • ${payload.decision || 'PENDING'}`,
        role: 'system',
        dir: 'in',
        tag: 'DECISION',
        hik
      };
      break;
      
    case 'biz.outcome':
      msgRecord = {
        id: `${seq}:${nonce}`,
        chatId,
        seq,
        ts: timestamp,
        text: `${payload.outcome || 'UNKNOWN'} • Decision #${payload.decisionSeq}`,
        role: 'system',
        dir: 'in',
        tag: 'OUTCOME',
        hik
      };
      break;
      
    case 'chat.append':
      msgRecord = {
        id: `${seq}:${nonce}`,
        chatId: 'legacy',
        seq,
        ts: timestamp,
        text: String(payload.text || ''),
        role: 'user',
        dir: 'out',
        hik
      };
      break;
  }
  
  if (msgRecord) {
    const chatId = msgRecord.chatId;
    if (!state.messages.has(chatId)) {
      state.messages.set(chatId, []);
    }
    state.messages.get(chatId).push(msgRecord);
    
    // Update thread
    let thread = state.threads.get(chatId);
    if (!thread) {
      thread = { chatId, lastTs: 0, lastPreview: '', msgCount: 0, userMsgCount: 0 };
      state.threads.set(chatId, thread);
    }
    thread.lastTs = msgRecord.ts;
    thread.lastPreview = truncate(msgRecord.text, 40);
    thread.msgCount++;
    if (msgRecord.role === 'user') {
      thread.userMsgCount++;
    }
  }
}

function updateScoreFromSTA(sta) {
  const { type, payload } = sta;
  
  if (type === 'ai.advice') {
    const decision = String(payload?.final?.decision || '').toUpperCase();
    if (decision === 'ACCEPT' || decision === 'APPROVED') {
      state.richScore = Math.min(CONFIG.SCORE_MAX, state.richScore + CONFIG.SCORE_ACCEPT);
    } else if (decision === 'CAUTION' || decision === 'WARNING' || decision === 'REJECT') {
      state.richScore = Math.max(CONFIG.SCORE_MIN, state.richScore + CONFIG.SCORE_CAUTION);
    }
  }
  
  if (type === 'biz.outcome') {
    const outcome = String(payload?.outcome || '').toUpperCase();
    if (outcome === 'SUCCESS') {
      state.richScore = Math.min(CONFIG.SCORE_MAX, state.richScore + CONFIG.SCORE_SUCCESS_OUTCOME);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// AI WORKER INTEGRATION
// ═══════════════════════════════════════════════════════════════

async function callWorker(chatId, userText) {
  // Build history from chain-derived messages
  const msgs = state.messages.get(chatId) || [];
  const recent = msgs.slice(-CONFIG.MAX_HISTORY_FOR_WORKER);
  
  const history = recent.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text
  }));
  
  const requestBody = {
    text: userText,
    history,
    chatId
  };
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.WORKER_TIMEOUT);
  
  try {
    const response = await fetch(CONFIG.WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Worker HTTP ${response.status}`);
    }
    
    const data = await response.json();
    console.log('[Worker] Response:', data.mode, data.selected_character);
    return data;
    
  } catch (err) {
    clearTimeout(timeout);
    console.warn('[Worker] Error, using fallback:', err.message);
    
    // Return mock fallback response
    return {
      mode: 'reply',
      selected_character: chatId.toUpperCase(),
      bubbles: [{ speaker: chatId.toUpperCase(), text: getMockResponse(chatId) }],
      final: { decision: 'ACCEPT', next_action: 'Continue the conversation.' }
    };
  }
}

function getMockResponse(chatId) {
  const responses = {
    kareem: "That sounds like too much work. What's the laziest solution? → Action: Delete one step from your process today.",
    turbo: "Stop thinking. What can you do RIGHT NOW? → Action: Pick one thing and do it in 30 minutes.",
    wolf: "What's the ROI? How do we 10x this? → Action: Find the multiplier in your idea.",
    luna: "But do you actually enjoy this? What's the point if you hate it?",
    captain: "Hold on. What's your runway? → Action: Calculate your emergency fund in months.",
    tempo: "That just cost you time. → Action: Track your hours tomorrow.",
    hakim: "Two farmers. Same field. One grew what people wanted. One grew what they needed. → Which are you?",
    wheat: "Is this a NEED or a WANT? Boring wins. → Action: Find the survival-level version.",
    tommy: "This needs more HYPE! Brand it better! → Action: Add one premium element.",
    architect: "Stop working IN it. Work ON the system. → Action: Document one process this week."
  };
  return responses[chatId] || "Tell me more. What's blocking you?";
}

// ═══════════════════════════════════════════════════════════════
// MESSAGING FLOW
// ═══════════════════════════════════════════════════════════════

async function sendMessage() {
  if (state.isSending) return;
  if (!state.chainIntegrityOk) {
    showToast('⚠️ Chain integrity compromised. Read-only mode.');
    return;
  }
  
  const chatId = state.activeChatId;
  if (!chatId) {
    showToast('Select a council member first.');
    return;
  }
  
  const text = (DOM.msgInput?.value || '').trim();
  if (!text) return;
  
  state.isSending = true;
  DOM.btnSend.disabled = true;
  DOM.msgInput.value = '';
  
  try {
    // 1. Commit user message to chain
    const userResult = await commitAction('chat.user', {
      chatId,
      text,
      role: 'user',
      tags: [],
      focus: null
    });
    
    if (!userResult.ok) {
      throw new Error(userResult.reason || 'Failed to commit user message');
    }
    
    // 2. Update UI
    renderThread();
    updateChainStatus();
    
    // 3. Show typing indicator
    showTypingIndicator();
    
    // 4. Call AI worker
    const aiResponse = await callWorker(chatId, text);
    
    // 5. Hide typing, commit AI response to chain
    hideTypingIndicator();
    
    const aiResult = await commitAction('ai.advice', {
      chatId,
      selected_character: aiResponse.selected_character || chatId.toUpperCase(),
      mode: aiResponse.mode || 'reply',
      bubbles: aiResponse.bubbles || [],
      final: aiResponse.final || { decision: 'ACCEPT', next_action: '' },
      text: extractDisplayText(aiResponse),
      raw: aiResponse
    });
    
    if (!aiResult.ok) {
      throw new Error(aiResult.reason || 'Failed to commit AI response');
    }
    
    // 6. Update score and UI
    updateScoreFromSTA(aiResult.sta);
    renderThread();
    renderChatList();
    updateGauges();
    updateChainStatus();
    
  } catch (err) {
    console.error('[Send] Error:', err);
    showToast(`⚠️ ${err.message}`);
    hideTypingIndicator();
  } finally {
    state.isSending = false;
    DOM.btnSend.disabled = false;
  }
}

function extractDisplayText(response) {
  if (response.reply) return response.reply;
  if (response.text) return response.text;
  if (Array.isArray(response.bubbles) && response.bubbles.length > 0) {
    return response.bubbles.map(b => {
      const text = typeof b.text === 'string' ? b.text : JSON.stringify(b.text);
      return response.mode === 'council_debate' ? `${b.speaker}: ${text}` : text;
    }).join('\n\n');
  }
  return '';
}

// ═══════════════════════════════════════════════════════════════
// UI RENDERING
// ═══════════════════════════════════════════════════════════════

function renderChatList() {
  if (!DOM.chatList) return;
  
  const query = (DOM.searchInput?.value || '').toLowerCase();
  
  const items = COUNCIL.map(member => {
    const thread = state.threads.get(member.id);
    return {
      ...member,
      lastTs: thread?.lastTs || 0,
      lastPreview: thread?.lastPreview || OPENER[member.id] || member.status,
      msgCount: thread?.msgCount || 0
    };
  })
  .filter(m => !query || m.name.toLowerCase().includes(query) || m.role.toLowerCase().includes(query))
  .sort((a, b) => b.lastTs - a.lastTs);
  
  DOM.chatList.innerHTML = items.map(m => `
    <div class="chat-item ${state.activeChatId === m.id ? 'active' : ''}" data-chat="${m.id}">
      <div class="chat-avatar" style="background:linear-gradient(135deg,${m.accent},${m.accent}66)">${m.emoji}</div>
      <div class="chat-meta">
        <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
          <span class="chat-name">${escapeHtml(m.name)}</span>
          <span style="font-size:10px;color:var(--text-tertiary);">${formatTime(m.lastTs)}</span>
        </div>
        <div style="font-size:9px;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:2px;">${escapeHtml(m.role)}</div>
        <div class="chat-preview">${escapeHtml(truncate(m.lastPreview, 35))}</div>
      </div>
    </div>
  `).join('');
  
  // Bind click handlers
  DOM.chatList.querySelectorAll('.chat-item').forEach(el => {
    el.onclick = () => openChat(el.dataset.chat);
  });
}

function renderThread() {
  if (!DOM.thread || !state.activeChatId) return;
  
  const chatId = state.activeChatId;
  const msgs = state.messages.get(chatId) || [];
  const member = COUNCIL.find(c => c.id === chatId);
  
  // If no messages, show opener
  if (msgs.length === 0 && OPENER[chatId]) {
    DOM.thread.innerHTML = `
      <div class="message-row in">
        <div class="msg-avatar" style="background:linear-gradient(135deg,${member?.accent || '#f59e0b'},${member?.accent || '#f59e0b'}66)">${member?.emoji || '🤖'}</div>
        <div class="bubble">
          <div class="bubble-content">${escapeHtml(OPENER[chatId])}</div>
        </div>
      </div>
    `;
    scrollThreadToBottom();
    return;
  }
  
  DOM.thread.innerHTML = msgs.map(msg => {
    const isIn = msg.dir === 'in' || msg.role === 'assistant' || msg.role === 'system';
    const color = member?.accent || '#f59e0b';
    
    return `
      <div class="message-row ${isIn ? 'in' : 'out'}">
        ${isIn ? `<div class="msg-avatar" style="background:linear-gradient(135deg,${color},${color}66)">${member?.emoji || '🤖'}</div>` : ''}
        <div class="bubble">
          ${msg.tag ? `<div class="bubble-tag" style="background:${color}22;color:${color}">${escapeHtml(msg.tag)}</div>` : ''}
          <div class="bubble-content">${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>
          <div class="bubble-meta">${formatTime(msg.ts)}</div>
        </div>
      </div>
    `;
  }).join('');
  
  scrollThreadToBottom();
}

function scrollThreadToBottom() {
  if (DOM.thread) {
    requestAnimationFrame(() => {
      DOM.thread.scrollTop = DOM.thread.scrollHeight;
    });
  }
}

function showTypingIndicator() {
  if (!DOM.thread) return;
  const indicator = document.createElement('div');
  indicator.id = 'typingIndicator';
  indicator.className = 'typing-indicator';
  indicator.innerHTML = `
    <div class="typing-dots">
      <span></span><span></span><span></span>
    </div>
    <span style="color:var(--text-secondary);font-size:12px;margin-left:4px;">Thinking...</span>
  `;
  DOM.thread.appendChild(indicator);
  scrollThreadToBottom();
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.remove();
}

function updateGauges() {
  const rich = state.richScore;
  const rush = CONFIG.SCORE_MAX - rich;
  
  if (DOM.rushBar) DOM.rushBar.style.width = `${rush}%`;
  if (DOM.richBar) DOM.richBar.style.width = `${rich}%`;
  if (DOM.rushValue) DOM.rushValue.textContent = rush;
  if (DOM.richValue) DOM.richValue.textContent = rich;
  
  // Update theme based on score
  updateTheme(rich);
}

function updateTheme(richScore) {
  let theme;
  if (richScore < 25) theme = 'coal';
  else if (richScore < 50) theme = 'ember';
  else if (richScore < 80) theme = 'bronze';
  else theme = 'gold';
  
  document.body.setAttribute('data-theme', theme);
}

async function updateChainStatus() {
  const head = await getChainHead(state.db);
  const len = await getChainLen(state.db);
  
  if (DOM.chainHead) DOM.chainHead.textContent = head === 'GENESIS' ? 'GENESIS' : head.slice(0, 16) + '…';
  if (DOM.chainLen) DOM.chainLen.textContent = len;
  if (DOM.mePill) DOM.mePill.textContent = `Me: ${state.identity?.hid?.slice(0, 16) || '...'}…`;
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

function setRoute(route) {
  state.route = route;
  document.body.setAttribute('data-route', route);
  
  if (route === 'home') {
    DOM.emptyState?.classList.remove('hidden');
    DOM.chatHeader?.classList.add('hidden');
    DOM.thread?.classList.add('hidden');
    DOM.composer?.classList.add('hidden');
    state.activeChatId = null;
  } else {
    DOM.emptyState?.classList.add('hidden');
    DOM.chatHeader?.classList.remove('hidden');
    DOM.thread?.classList.remove('hidden');
    DOM.composer?.classList.remove('hidden');
  }
}

async function openChat(chatId) {
  state.activeChatId = chatId;
  const member = COUNCIL.find(c => c.id === chatId);
  
  if (member) {
    if (DOM.headerAvatar) {
      DOM.headerAvatar.textContent = member.emoji;
      DOM.headerAvatar.style.background = `linear-gradient(135deg,${member.accent},${member.accent}66)`;
    }
    if (DOM.headerName) DOM.headerName.textContent = member.name;
    if (DOM.headerStatus) DOM.headerStatus.textContent = member.status;
  }
  
  // If no messages exist for this chat, optionally add opener as system message
  // (But we don't commit it to chain—just display it)
  
  setRoute('chat');
  renderThread();
  renderChatList();
  
  setTimeout(() => DOM.msgInput?.focus(), 100);
}

// ═══════════════════════════════════════════════════════════════
// LOCK SCREEN
// ═══════════════════════════════════════════════════════════════

async function attemptBiometricUnlock() {
  try {
    if (!window.PublicKeyCredential) {
      showToast('⚠️ Biometrics not supported');
      unlockApp();
      return;
    }
    
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Sovereign Business OS' },
        user: { id: new Uint8Array(16), name: 'user', displayName: 'User' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: 'platform' }
      }
    });
    
    if (credential) {
      unlockApp();
    }
  } catch (err) {
    console.log('[Auth] Biometric failed:', err);
    showToast('Biometric auth failed, try demo mode');
  }
}

function unlockApp() {
  state.isLocked = false;
  DOM.lockScreen?.classList.add('hidden');
  DOM.app?.classList.remove('locked');
  showToast('🔓 Unlocked');
}

// ═══════════════════════════════════════════════════════════════
// KB SEARCH
// ═══════════════════════════════════════════════════════════════

async function runKBSearch() {
  const query = (DOM.brainQuery?.value || '').trim();
  if (!query) {
    if (DOM.brainAnswer) DOM.brainAnswer.textContent = '—';
    return;
  }
  
  try {
    const results = await kbSearch(state.db, query, {
      peerHid: state.activeChatId || null,
      limit: 10
    });
    
    if (!results.length) {
      if (DOM.brainAnswer) DOM.brainAnswer.textContent = 'No matches found (offline).';
      return;
    }
    
    const lines = results.map(r => {
      const when = new Date(r.ts || Date.now()).toLocaleString();
      const dir = r.dir === 'out' ? '→' : '←';
      const text = truncate(r.text || '', 100);
      return `• ${when} ${dir} ${text}`;
    });
    
    if (DOM.brainAnswer) DOM.brainAnswer.textContent = lines.join('\n');
    
  } catch (err) {
    console.error('[KB] Search error:', err);
    if (DOM.brainAnswer) DOM.brainAnswer.textContent = 'Search error: ' + err.message;
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function showToast(msg) {
  if (DOM.toastText) DOM.toastText.textContent = msg;
  if (DOM.toast) {
    DOM.toast.classList.add('visible');
    setTimeout(() => DOM.toast.classList.remove('visible'), CONFIG.TOAST_DURATION_MS);
  }
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(120, el.scrollHeight) + 'px';
}

// ═══════════════════════════════════════════════════════════════
// P2P SKELETON (Future-Ready)
// ═══════════════════════════════════════════════════════════════

// Uncomment and implement when ready for P2P sync
/*
async function initNetwork() {
  try {
    const { SignalClient } = await import('./signal.js');
    const { P2PManager } = await import('./p2p.js');
    
    // Initialize signal client
    // Initialize P2P manager
    // Setup event handlers
    
    console.log('[P2P] Network initialized');
  } catch (err) {
    console.log('[P2P] Network modules not available:', err.message);
  }
}

async function exportSlice({ chatId, fromSeq = 0, toSeq = Infinity }) {
  const tx = state.db.transaction(['state_chain'], 'readonly');
  const all = await reqDone(tx.objectStore('state_chain').getAll());
  await txDone(tx);
  
  return all.filter(sta => {
    const staChatId = sta.payload?.chatId || sta.payload?.threadId;
    return staChatId === chatId && sta.seq >= fromSeq && sta.seq <= toSeq;
  });
}

async function importSlice(stas) {
  const results = [];
  for (const sta of stas) {
    // Verify signature
    const pubKey = await importPubKeyJwk(sta.author.pubJwk);
    const signable = staSignable(sta);
    const valid = await verify(pubKey, signable, sta.signature);
    
    if (!valid) {
      results.push({ seq: sta.seq, ok: false, reason: 'bad_signature' });
      continue;
    }
    
    // Try to append
    const result = await appendSTA(state.db, sta, pubKey);
    results.push({ seq: sta.seq, ...result });
  }
  return results;
}
*/

// ═══════════════════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════════════════

function bindEvents() {
  // Lock screen
  if (DOM.btnUnlock) DOM.btnUnlock.onclick = attemptBiometricUnlock;
  if (DOM.btnUnlockDemo) DOM.btnUnlockDemo.onclick = unlockApp;
  
  // Navigation
  if (DOM.btnBack) DOM.btnBack.onclick = () => setRoute('home');
  
  // Search
  if (DOM.searchInput) DOM.searchInput.oninput = renderChatList;
  
  // Messaging
  if (DOM.msgInput) {
    DOM.msgInput.oninput = () => {
      autoGrow(DOM.msgInput);
      if (DOM.btnSend) DOM.btnSend.disabled = !DOM.msgInput.value.trim();
    };
    DOM.msgInput.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    };
  }
  
  if (DOM.btnSend) DOM.btnSend.onclick = sendMessage;
  
  // KB Search
  if (DOM.brainAsk) DOM.brainAsk.onclick = runKBSearch;
  if (DOM.brainQuery) {
    DOM.brainQuery.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runKBSearch();
      }
    };
  }
  
  // Theme toggle
  if (DOM.themeToggle) {
    DOM.themeToggle.onclick = () => {
      const current = document.body.getAttribute('data-mode') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.body.setAttribute('data-mode', next);
      showToast(`${next === 'dark' ? '🌙' : '☀️'} ${next} mode`);
    };
  }
  
  // Quick actions (if present)
  const quickActions = document.getElementById('quickActions');
  if (quickActions) {
    quickActions.onclick = (e) => {
      const btn = e.target.closest('.quick-btn');
      if (btn && DOM.msgInput) {
        const prompts = {
          audit: "I need a time audit on my typical day.",
          wheat: "Is my idea wheat or tomatoes? Test the necessity.",
          map: "Help me plan my Money Map system.",
          council: "I want a debate from the full Council."
        };
        const action = btn.dataset.action;
        if (prompts[action]) {
          DOM.msgInput.value = prompts[action];
          sendMessage();
        }
      }
    };
  }
  
  // Start chat button (empty state)
  const btnStartChat = document.getElementById('btnStartChat');
  if (btnStartChat) {
    btnStartChat.onclick = () => {
      if (COUNCIL.length) openChat(COUNCIL[0].id);
    };
  }
  
  console.log('[Events] All handlers bound');
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

async function init() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Sovereign Business OS — Initializing');
  console.log('═══════════════════════════════════════════════════════════════');
  
  try {
    // 1. Cache DOM elements
    cacheDom();
    
    // 2. Initialize database
    await initDB();
    
    // 3. Load or create identity
    await loadOrCreateIdentity();
    
    // 4. Verify chain integrity
    const integrityOk = await verifyChainIntegrity();
    if (!integrityOk) {
      showToast('⚠️ Chain integrity check failed. Read-only mode.');
    }
    
    // 5. Rebuild projections from chain
    await rebuildProjections();
    
    // 6. Bind event handlers
    bindEvents();
    
    // 7. Initial render
    renderChatList();
    updateGauges();
    await updateChainStatus();
    setRoute('home');
    
    // 8. Register service worker (if present)
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('./sw.js');
        console.log('[SW] Registered');
      } catch (e) {
        console.log('[SW] Registration failed:', e.message);
      }
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Sovereign Business OS — Ready');
    console.log(`  Identity: ${state.identity?.hid || 'none'}`);
    console.log(`  Chain Length: ${await getChainLen(state.db)}`);
    console.log(`  Rich Score: ${state.richScore}`);
    console.log(`  Integrity: ${state.chainIntegrityOk ? 'OK' : 'FAILED'}`);
    console.log('═══════════════════════════════════════════════════════════════');
    
  } catch (err) {
    console.error('[Init] Fatal error:', err);
    showToast('⚠️ Failed to initialize: ' + err.message);
  }
}

// Bootstrap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for debugging/testing
window.SovereignOS = {
  state,
  commitAction,
  getChainHead: () => getChainHead(state.db),
  getChainLen: () => getChainLen(state.db),
  kbSearch: (q) => kbSearch(state.db, q),
  COUNCIL
};
  // --- BOARDROOM (P2P) + DECISIONS (A+B+C+D) ---
  async function initNetwork() {
    if (state.p2p) return true;
    try {
      state.signal = new SignalClient(CONFIG.SIGNAL_URLS);
      state.p2p = new P2PManager({ signal: state.signal });
      await state.signal.connect();
      // Minimal: ready to accept connections; app can call state.p2p.connectTo(peerCode) later
      console.log('🤝 Boardroom network ready');
      return true;
    } catch (e) {
      console.warn('P2P init failed:', e);
      showToast('⚠️ Boardroom offline');
      return false;
    }
  }

  function openModal(el) { if (el) el.classList.add('open'); }
  function closeModal(el) { if (el) el.classList.remove('open'); }

  function openDecisionModal(prefill = {}) {
    if (!DOM.modalDecision || !DOM.decisionForm) return;
    DOM.decisionForm.reset();
    // Prefill
    DOM.decisionForm.querySelector('[name="title"]').value = prefill.title || '';
    DOM.decisionForm.querySelector('[name="description"]').value = prefill.description || '';
    DOM.decisionForm.querySelector('[name="dueAt"]').value = prefill.dueAt || '';
    DOM.decisionForm.querySelector('[name="capitalRequired"]').value = prefill.capitalRequired || '';
    DOM.decisionForm.querySelector('[name="tags"]').value = prefill.tags || '';
    DOM.decisionForm.querySelector('[name="requireCosign"]').checked = !!prefill.requireCosign;
    openModal(DOM.modalDecision);
  }

  function openOutcomeModal(prefill = {}) {
    if (!DOM.modalOutcome || !DOM.outcomeForm) return;
    DOM.outcomeForm.reset();
    DOM.outcomeForm.querySelector('[name="decisionSeq"]').value = prefill.decisionSeq || '';
    DOM.outcomeForm.querySelector('[name="outcome"]').value = prefill.outcome || 'SUCCESS';
    DOM.outcomeForm.querySelector('[name="evidence"]').value = prefill.evidence || '';
    DOM.outcomeForm.querySelector('[name="metrics"]').value = prefill.metrics || '';
    DOM.outcomeForm.querySelector('[name="voterHids"]').value = prefill.voterHids || '';
    openModal(DOM.modalOutcome);
  }

  async function onDecisionSubmit(e) {
    e.preventDefault();
    if (!state.activeChatId) return;
    const fd = new FormData(DOM.decisionForm);
    const payload = {
      threadId: state.activeChatId,
      title: String(fd.get('title') || '').trim(),
      description: String(fd.get('description') || '').trim(),
      decision: 'PENDING',
      status: 'OPEN',
      dueAt: fd.get('dueAt') ? String(fd.get('dueAt')) : undefined,
      tags: String(fd.get('tags') || '').split(',').map(s=>s.trim()).filter(Boolean),
      capitalRequired: fd.get('capitalRequired') ? Number(fd.get('capitalRequired')) : undefined,
      risks: [],
      requireCosign: !!fd.get('requireCosign')
    };
    if (!payload.title) return showToast('⚠️ Title required');
    closeModal(DOM.modalDecision);
    await commitAndProject('biz.decision', payload, state.activeChatId);
    renderThread();
    renderChatList();
  }

  async function onOutcomeSubmit(e) {
    e.preventDefault();
    if (!state.activeChatId) return;
    const fd = new FormData(DOM.outcomeForm);
    const decisionSeq = Number(fd.get('decisionSeq'));
    if (!decisionSeq) return showToast('⚠️ decisionSeq required');
    let metrics = {};
    const metricsRaw = String(fd.get('metrics') || '').trim();
    if (metricsRaw) {
      try { metrics = JSON.parse(metricsRaw); } catch { metrics = { notes: metricsRaw }; }
    }
    const payload = {
      threadId: state.activeChatId,
      decisionSeq,
      outcome: String(fd.get('outcome') || 'SUCCESS'),
      evidence: String(fd.get('evidence') || '').trim(),
      metrics,
      voterHids: String(fd.get('voterHids') || '').split(',').map(s=>s.trim()).filter(Boolean)
    };
    closeModal(DOM.modalOutcome);
    await commitAndProject('biz.outcome', payload, state.activeChatId);
    renderThread();
    renderChatList();
  }

  async function handleQuickAction(kind) {
    const now = new Date();
    if (kind === 'time_audit') {
      openDecisionModal({
        title: 'Time Audit Sprint (48h)',
        description: 'Log where hours went + delete 1 time leak + schedule 1 repeatable offer.',
        dueAt: now.toISOString().slice(0,10),
        tags: 'time,audit,48h',
        requireCosign: false
      });
      return;
    }
    if (kind === 'wheat_test') {
      openDecisionModal({
        title: 'Wheat Test (Need Strength)',
        description: 'Define: who needs it weekly? what pain? what proof? Avoid tomato/hype.',
        dueAt: now.toISOString().slice(0,10),
        tags: 'wheat,test,need',
        requireCosign: false
      });
      return;
    }
    if (kind === 'money_map') {
      openDecisionModal({
        title: 'Money Map Step',
        description: 'Pick next system move: offer, channel, proof, or automation.',
        dueAt: now.toISOString().slice(0,10),
        tags: 'money-map,system',
        requireCosign: false
      });
      return;
    }
    if (kind === 'ask_council') {
      DOM.msgInput?.focus();
      return;
    }
  }

  async function exportThreadSlice(chatId, limit = 10) {
    const tx = db.transaction(['state_chain'], 'readonly');
    const all = await reqDone(tx.objectStore('state_chain').getAll());
    await txDone(tx);
    const filtered = all
      .filter(sta => (sta.payload?.threadId === chatId) || (sta.payload?.chatId === chatId))
      .sort((a,b)=>a.seq-b.seq)
      .slice(-limit);
    const sliceJson = JSON.stringify(filtered);
    const sliceHash = await sha256Hex(canonicalize({ v: 1, chatId, count: filtered.length, slice: filtered }));
    return { chatId, sliceHash, slice: filtered, exportedAt: Date.now() };
  }

  async function onShare() {
    if (!state.activeChatId) return showToast('⚠️ Open a chat first');
    const pkg = await exportThreadSlice(state.activeChatId, 10);
    const text = JSON.stringify(pkg, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      showToast('✅ Slice copied (paste to partner)');
    } catch {
      // fallback prompt
      prompt('Copy this JSON slice:', text);
    }
    // Optional: initialize network so later we can send via DataChannel
    initNetwork();
  }

  async function onImport() {
    const raw = prompt('Paste shared slice JSON:');
    if (!raw) return;
    let pkg;
    try { pkg = JSON.parse(raw); } catch { return showToast('❌ Invalid JSON'); }
    const slice = pkg.slice;
    if (!Array.isArray(slice) || !slice.length) return showToast('❌ No slice');
    // Verify each STA signature (best-effort)
    let okCount = 0;
    const voterHids = new Set();
    for (const sta of slice) {
      try {
        const pubJwk = sta.author?.pubJwk;
        if (!pubJwk) throw new Error('missing pubJwk');
        const pubKey = await importPubKeyJwk(pubJwk);
        const signable = staSignable(sta);
        const ok = await verify(pubKey, signable, sta.signature);
        if (ok) {
          okCount++;
          // compute HID from pubJwk
          const hid = await computeHID(pubJwk);
          voterHids.add(hid);
        }
      } catch (e) {
        console.warn('verify fail', e);
      }
    }
    showToast(`Imported slice: ${okCount}/${slice.length} verified`);
    // Append a local outcome marker referencing slice hash (keeps chain linear)
    const evidence = `Imported boardroom slice for ${pkg.chatId || 'unknown'} hash=${pkg.sliceHash || 'n/a'}`;
    const payload = {
      threadId: state.activeChatId || 'default',
      decisionSeq: slice[slice.length-1].seq || 0,
      outcome: 'PARTIAL',
      evidence,
      metrics: { sharedSliceHash: pkg.sliceHash, sharedCount: slice.length },
      voterHids: Array.from(voterHids)
    };
    await commitAndProject('biz.outcome', payload, state.activeChatId || 'default');
    renderThread();
    renderChatList();
    initNetwork();
  }


