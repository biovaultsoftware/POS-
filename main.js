/**
 * Sovereign Business OS — Production Main Controller v2.0
 * ====================================================
 * SECURITY FIXES:
 * - ✅ XSS vulnerability fixed (textContent instead of innerHTML)
 * - ✅ Private key exposure removed (no state export)
 * - ✅ Input sanitization
 * - ✅ Error boundaries
 * 
 * NEW FEATURES:
 * - ✅ TVM integration (capsule validation + minting)
 * - ✅ Enhanced KB search
 * - ✅ Improved error handling
 * - ✅ Performance optimizations
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
import { kbUpsertMessage, kbSearch, kbRebuildFromMessages } from './kb.js';

// Import TVM system (assuming it's ready as per user)
import { TVMToken, CapsuleValidator, mintTVM } from './tvm.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  DB_NAME: 'sovereign_os_v2', // Bumped version for new schema
  DB_VERSION: 2, // New version with TVM tables
  
  WORKER_URL: 'https://human1stai.rr-rshemodel.workers.dev',
  WORKER_TIMEOUT: 45000, // Increased to 45s for LLM
  
  MAX_HISTORY_FOR_WORKER: 20,
  TYPING_DELAY_MS: 600,
  TOAST_DURATION_MS: 3000,
  
  INTEGRITY_CHECK_DEPTH: 20,
  
  // TVM Thresholds
  MIN_MESSAGES_FOR_CAPSULE: 12,
  RICH_SCORE_THRESHOLD: 70,
  BUSINESS_SCORE_THRESHOLD: 70,
  
  // Scoring
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
// APPLICATION STATE
// ═══════════════════════════════════════════════════════════════

const state = {
  db: null,
  identity: null,
  
  richScore: CONFIG.SCORE_BASE,
  businessScore: 0,
  chainIntegrityOk: true,
  
  activeChatId: null,
  route: 'home',
  isLocked: true,
  isSending: false,
  
  threads: new Map(),
  messages: new Map(),
  
  // TVM tracking
  tvmBalance: 0,
  pendingCapsules: new Map(),
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
  DOM.toast = $('#toast');
  DOM.toastText = $('#toastText');
  DOM.themeToggle = $('#themeToggle');
  
  DOM.rushBar = $('#rushBar');
  DOM.richBar = $('#richBar');
  DOM.rushValue = $('#rushValue');
  DOM.richValue = $('#richValue');
  
  DOM.brainQuery = $('#brainQuery');
  DOM.brainAsk = $('#brainAsk');
  DOM.brainAnswer = $('#brainAnswer');
  
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
      
      // Core chain stores
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
      
      // Identity
      if (!db.objectStoreNames.contains('keys')) {
        db.createObjectStore('keys', { keyPath: 'name' });
      }
      
      // Threads
      if (!db.objectStoreNames.contains('threads')) {
        db.createObjectStore('threads', { keyPath: 'chatId' });
      }
      
      // KB stores
      if (!db.objectStoreNames.contains('kb_docs')) {
        db.createObjectStore('kb_docs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('kb_terms')) {
        db.createObjectStore('kb_terms', { keyPath: 'term' });
      }
      if (!db.objectStoreNames.contains('kb_entities')) {
        db.createObjectStore('kb_entities', { keyPath: 'key' });
      }
      
      // NEW: TVM stores (v2)
      if (!db.objectStoreNames.contains('tvm_tokens')) {
        const tvmStore = db.createObjectStore('tvm_tokens', { keyPath: 'id' });
        tvmStore.createIndex('byCapsuleHash', 'capsuleHash', { unique: true });
        tvmStore.createIndex('byHid', 'hid');
        tvmStore.createIndex('byTimestamp', 'mintedAt');
      }
      
      if (!db.objectStoreNames.contains('capsules')) {
        const capsuleStore = db.createObjectStore('capsules', { keyPath: 'id' });
        capsuleStore.createIndex('byHash', 'hash', { unique: true });
        capsuleStore.createIndex('byStatus', 'status');
        capsuleStore.createIndex('byChatId', 'chatId');
      }
    }
  });
  
  console.log('[DB] Initialized:', CONFIG.DB_NAME);
}

// ═══════════════════════════════════════════════════════════════
// IDENTITY MANAGEMENT
// ═══════════════════════════════════════════════════════════════

async function loadOrCreateIdentity() {
  const tx = state.db.transaction(['keys'], 'readonly');
  const existing = await reqDone(tx.objectStore('keys').get('identity'));
  await txDone(tx);
  
  if (existing?.pubJwk && existing?.privateJwk && existing?.hik) {
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
  
  const hik = 'HID-' + randomHex(16);
  const hid = await computeHID(pubJwk);
  
  state.identity = {
    hik,
    hid,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    pubJwk
  };
  
  const saveTx = state.db.transaction(['keys'], 'readwrite');
  await reqDone(saveTx.objectStore('keys').put({
    name: 'identity',
    hik,
    hid,
    pubJwk,
    privateJwk,
    createdAt: Date.now()
  }));
  await txDone(saveTx);
  
  console.log('[Identity] Created:', hid);
}

async function computeHID(pubJwk) {
  const canonical = canonicalize(pubJwk);
  const hash = await sha256Hex(canonical);
  return 'HID-' + hash.slice(0, 16);
}

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ═══════════════════════════════════════════════════════════════
// CHAIN INTEGRITY
// ═══════════════════════════════════════════════════════════════

async function verifyChainIntegrity() {
  const len = await getChainLen(state.db);
  if (len === 0) {
    state.chainIntegrityOk = true;
    return true;
  }
  
  const depth = Math.min(len, CONFIG.INTEGRITY_CHECK_DEPTH);
  const tx = state.db.transaction(['state_chain'], 'readonly');
  const store = tx.objectStore('state_chain');
  
  let verified = 0;
  let failed = 0;
  
  for (let i = Math.max(1, len - depth + 1); i <= len; i++) {
    const sta = await reqDone(store.get(i));
    if (!sta) {
      failed++;
      continue;
    }
    
    try {
      const pubKey = await importPubKeyJwk(sta.author.pubJwk);
      const signable = staSignable(sta);
      const valid = await verify(pubKey, signable, sta.signature);
      
      if (valid) {
        verified++;
      } else {
        failed++;
        console.error(`[Integrity] Block ${i} has invalid signature`);
      }
    } catch (e) {
      failed++;
      console.error(`[Integrity] Block ${i} verification error:`, e.message);
    }
  }
  
  await txDone(tx);
  
  const ok = failed === 0;
  state.chainIntegrityOk = ok;
  
  console.log(`[Integrity] Verified ${verified} blocks, ${failed} failed`);
  return ok;
}

// ═══════════════════════════════════════════════════════════════
// PROJECTIONS (Rebuild from chain)
// ═══════════════════════════════════════════════════════════════

async function rebuildProjections() {
  console.log('[Rebuild] Starting...');
  
  state.messages.clear();
  state.threads.clear();
  state.richScore = CONFIG.SCORE_BASE;
  state.businessScore = 0;
  
  const tx = state.db.transaction(['state_chain'], 'readonly');
  const all = await reqDone(tx.objectStore('state_chain').getAll());
  await txDone(tx);
  
  for (const sta of all) {
    processSTAForProjections(sta);
  }
  
  // Rebuild KB
  try {
    await kbRebuildFromMessages(state.db);
    console.log('[KB] Index rebuilt');
  } catch (e) {
    console.error('[KB] Rebuild failed:', e.message);
  }
  
  // Load TVM balance
  await loadTVMBalance();
  
  console.log(`[Rebuild] Complete: ${all.length} blocks, richScore=${state.richScore}`);
}

function processSTAForProjections(sta) {
  const chatId = sta.payload?.chatId;
  if (!chatId) return;
  
  // Messages projection
  let messages = state.messages.get(chatId) || [];
  
  if (sta.type === 'chat.user') {
    messages.push({
      id: `${sta.seq}:${sta.nonce}`,
      seq: sta.seq,
      ts: sta.timestamp,
      text: sta.payload.text || '',
      role: 'user',
      dir: 'out',
      speaker: 'You',
      tags: sta.payload.tags || []
    });
  } else if (sta.type === 'ai.advice') {
    const bubbles = sta.payload.bubbles || [];
    for (const bubble of bubbles) {
      messages.push({
        id: `${sta.seq}:${sta.nonce}:${bubble.speaker}`,
        seq: sta.seq,
        ts: sta.timestamp,
        text: bubble.text || '',
        role: 'assistant',
        dir: 'in',
        speaker: bubble.speaker,
        decision: sta.payload.final?.decision
      });
    }
    
    // Update scores
    if (sta.payload.final?.decision === 'ACCEPT') {
      state.richScore = Math.min(CONFIG.SCORE_MAX, state.richScore + CONFIG.SCORE_ACCEPT);
    } else if (sta.payload.final?.decision === 'CAUTION') {
      state.richScore = Math.max(CONFIG.SCORE_MIN, state.richScore + CONFIG.SCORE_CAUTION);
    }
  }
  
  state.messages.set(chatId, messages);
  
  // Threads projection
  const thread = state.threads.get(chatId) || { chatId, lastTs: 0, lastPreview: '', msgCount: 0 };
  thread.lastTs = Math.max(thread.lastTs, sta.timestamp);
  thread.msgCount = messages.length;
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    thread.lastPreview = truncate(last.text, 60);
  }
  state.threads.set(chatId, thread);
}

async function loadTVMBalance() {
  const tx = state.db.transaction(['meta'], 'readonly');
  const key = `tvm_balance:${state.identity.hid}`;
  const result = await reqDone(tx.objectStore('meta').get(key));
  await txDone(tx);
  state.tvmBalance = result?.value || 0;
}

// ═══════════════════════════════════════════════════════════════
// COMMIT ACTION (Write to chain)
// ═══════════════════════════════════════════════════════════════

async function commitAction(type, payload) {
  if (!state.chainIntegrityOk) {
    throw new Error('Chain integrity compromised. Cannot commit.');
  }
  
  const MAX_RETRIES = 3;
  let attempt = 0;
  
  while (attempt < MAX_RETRIES) {
    try {
      const prevHash = await getChainHead(state.db);
      const seq = (await getChainLen(state.db)) + 1;
      
      const sta = await createSTA(
        state.identity,
        prevHash,
        seq,
        type,
        payload
      );
      
      const signable = staSignable(sta);
      sta.signature = await sign(state.identity.privateKey, signable);
      
      const result = await appendSTA(state.db, sta, state.identity.publicKey);
      
      if (result.ok) {
        processSTAForProjections(sta);
        await updateChainStatus();
        return { ok: true, seq, sta };
      } else if (result.reason === 'bad_prev_hash' && attempt < MAX_RETRIES - 1) {
        attempt++;
        await new Promise(r => setTimeout(r, 50 * attempt));
        continue;
      } else {
        return result;
      }
    } catch (e) {
      if (attempt === MAX_RETRIES - 1) throw e;
      attempt++;
      await new Promise(r => setTimeout(r, 100 * attempt));
    }
  }
  
  throw new Error('Failed to commit after retries');
}

// ═══════════════════════════════════════════════════════════════
// MESSAGING
// ═══════════════════════════════════════════════════════════════

let sendDebounce = null;

async function sendMessage() {
  if (state.isSending) return;
  if (!DOM.msgInput || !DOM.msgInput.value.trim()) return;
  
  const text = sanitizeInput(DOM.msgInput.value.trim());
  DOM.msgInput.value = '';
  DOM.msgInput.style.height = 'auto';
  if (DOM.btnSend) DOM.btnSend.disabled = true;
  
  state.isSending = true;
  
  try {
    // 1. Commit user message to chain
    const userResult = await commitAction('chat.user', {
      chatId: state.activeChatId,
      text,
      role: 'user',
      tags: [],
      focus: []
    });
    
    if (!userResult.ok) {
      throw new Error(userResult.reason || 'Failed to save message');
    }
    
    renderThread();
    
    // 2. Show typing indicator
    showTypingIndicator();
    
    // 3. Call worker for AI response
    const aiResponse = await callWorker(text);
    
    hideTypingIndicator();
    
    // 4. Commit AI response to chain
    const aiResult = await commitAction('ai.advice', {
      chatId: state.activeChatId,
      ...aiResponse,
      text: aiResponse.bubbles.map(b => b.text).join('\n')
    });
    
    if (!aiResult.ok) {
      throw new Error('Failed to save AI response');
    }
    
    renderThread();
    updateGauges();
    
    // 5. Check if session complete (capsule minting)
    await checkCapsuleMinting();
    
  } catch (e) {
    console.error('[Send] Error:', e);
    showToast('❌ ' + (e.message || 'Failed to send'));
    hideTypingIndicator();
  } finally {
    state.isSending = false;
    if (DOM.msgInput) DOM.msgInput.focus();
  }
}

function sanitizeInput(text) {
  // Remove dangerous characters
  return text
    .replace(/[<>]/g, '')
    .slice(0, 5000);
}

async function callWorker(text) {
  const history = (state.messages.get(state.activeChatId) || [])
    .slice(-CONFIG.MAX_HISTORY_FOR_WORKER)
    .map(m => ({
      role: m.role,
      content: m.text
    }));
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.WORKER_TIMEOUT);
  
  try {
    const response = await fetch(CONFIG.WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-ID': state.identity.hid
      },
      body: JSON.stringify({
        text,
        chatId: state.activeChatId,
        sessionId: state.identity.hid,
        history
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Worker error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    return data;
  } catch (e) {
    clearTimeout(timeoutId);
    
    if (e.name === 'AbortError') {
      return hardcodedFallback('Request timed out. Please try again.');
    }
    
    throw e;
  }
}

function hardcodedFallback(msg) {
  const character = state.activeChatId || 'kareem';
  return {
    mode: 'reply',
    selected_character: character.toUpperCase(),
    bubbles: [{
      speaker: character.toUpperCase(),
      text: msg || 'System temporarily unavailable. Try rephrasing your question.'
    }],
    final: {
      decision: 'CAUTION',
      next_action: 'Wait a moment and try again with a simpler question.'
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// CAPSULE MINTING (TVM Integration)
// ═══════════════════════════════════════════════════════════════

async function checkCapsuleMinting() {
  const messages = state.messages.get(state.activeChatId) || [];
  
  if (messages.length < CONFIG.MIN_MESSAGES_FOR_CAPSULE) {
    return; // Not enough messages yet
  }
  
  // Check if already minted for this chat
  const existingCapsule = state.pendingCapsules.get(state.activeChatId);
  if (existingCapsule?.status === 'minted') {
    return; // Already minted
  }
  
  // Calculate scores
  const richScore = state.richScore;
  const businessScore = calculateBusinessScore(messages);
  const effortScore = calculateEffortScore(messages);
  
  // Create capsule
  const capsule = {
    id: crypto.randomUUID(),
    chatId: state.activeChatId,
    messages: messages.map(m => ({ role: m.role, text: m.text })),
    richScore,
    businessScore,
    effortScore,
    messageCount: messages.length,
    timestamp: Date.now()
  };
  
  // Attempt to mint
  try {
    const mintResult = await mintTVM(state.db, capsule, state.identity);
    
    if (mintResult.ok) {
      state.tvmBalance += 1;
      state.pendingCapsules.set(state.activeChatId, { status: 'minted', token: mintResult.token });
      
      showTVMMintedAnimation(mintResult.token);
      showToast(`🎉 Capsule validated! +1 TVM (Total: ${state.tvmBalance})`);
      
      console.log('[TVM] Minted:', mintResult.token.id);
    } else {
      state.pendingCapsules.set(state.activeChatId, { status: 'pending', errors: mintResult.errors });
      
      if (mintResult.reason === 'capsule_invalid') {
        const hint = mintResult.errors[0] || 'Keep the conversation focused on business.';
        showToast(`⚠️ ${hint}`);
      }
    }
  } catch (e) {
    console.error('[TVM] Minting error:', e);
  }
}

function calculateBusinessScore(messages) {
  let businessTerms = 0;
  const businessKeywords = [
    'revenue', 'profit', 'customer', 'market', 'product', 'service',
    'business', 'sales', 'strategy', 'money', 'price', 'cost'
  ];

  for (const msg of messages) {
    const text = msg.text.toLowerCase();
    for (const keyword of businessKeywords) {
      if (text.includes(keyword)) businessTerms++;
    }
  }

  return Math.min(100, (businessTerms / messages.length) * 40);
}

function calculateEffortScore(messages) {
  let totalComplexity = 0;

  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    
    const words = msg.text.split(/\s+/).length;
    const uniqueWords = new Set(msg.text.toLowerCase().split(/\s+/)).size;
    const complexity = (uniqueWords / words) * 100;
    totalComplexity += complexity;
  }

  const userMessages = messages.filter(m => m.role === 'user').length;
  return userMessages > 0 ? Math.min(100, totalComplexity / userMessages) : 0;
}

function showTVMMintedAnimation(token) {
  const overlay = document.createElement('div');
  overlay.className = 'mint-overlay';
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.3s;
  `;
  
  overlay.innerHTML = `
    <div class="capsule-animation" style="
      text-align: center;
      padding: 40px;
      background: linear-gradient(135deg, var(--glow-primary), var(--gold-core));
      border-radius: 24px;
      animation: scaleIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
    ">
      <div class="capsule-icon" style="font-size: 72px; margin-bottom: 20px;">💎</div>
      <h2 style="font-size: 32px; font-weight: 700; margin-bottom: 8px;">Capsule Secured</h2>
      <p style="font-size: 16px; margin-bottom: 24px; opacity: 0.9;">100% Human Verified</p>
      <div class="token-id" style="
        font-family: monospace;
        font-size: 12px;
        padding: 8px 16px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 8px;
        margin-bottom: 16px;
      ">${token.id}</div>
      <div class="scores" style="display: flex; gap: 16px; justify-content: center; font-size: 14px;">
        <span>Rich: ${token.richScore}</span>
        <span>Business: ${token.businessScore}</span>
        <span>Effort: ${token.effortScore}</span>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  overlay.onclick = () => overlay.remove();
  setTimeout(() => overlay.remove(), 4000);
}

// ═══════════════════════════════════════════════════════════════
// UI RENDERING (SECURE: No innerHTML with user content)
// ═══════════════════════════════════════════════════════════════

function renderMessage(msg) {
  const bubble = document.createElement('div');
  bubble.className = `msg ${msg.dir}`;
  
  // Avatar
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  
  if (msg.dir === 'out') {
    avatar.textContent = '👤';
  } else {
    const council = COUNCIL.find(c => c.id === state.activeChatId);
    avatar.textContent = council?.emoji || '🤖';
  }
  
  bubble.appendChild(avatar);
  
  // Content
  const content = document.createElement('div');
  content.className = 'msg-content';
  
  // Speaker name (for AI messages)
  if (msg.speaker && msg.dir === 'in') {
    const speakerEl = document.createElement('div');
    speakerEl.className = 'msg-speaker';
    speakerEl.textContent = msg.speaker; // Safe: textContent
    speakerEl.style.cssText = 'font-weight: 600; font-size: 12px; margin-bottom: 4px; opacity: 0.7;';
    content.appendChild(speakerEl);
  }
  
  // Text (SECURE: textContent prevents XSS)
  const msgText = document.createElement('div');
  msgText.className = 'msg-text';
  msgText.textContent = msg.text; // ← CRITICAL: textContent not innerHTML
  content.appendChild(msgText);
  
  // Metadata
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = formatTime(msg.ts);
  meta.style.cssText = 'font-size: 10px; opacity: 0.5; margin-top: 4px;';
  content.appendChild(meta);
  
  bubble.appendChild(content);
  return bubble;
}

function renderThread() {
  if (!DOM.thread) return;
  
  // Clear thread
  DOM.thread.innerHTML = '';
  
  const messages = state.messages.get(state.activeChatId) || [];
  
  if (messages.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align: center; padding: 40px; color: var(--text-secondary);';
    empty.textContent = 'Start the conversation...';
    DOM.thread.appendChild(empty);
    return;
  }
  
  // Render each message (secure)
  for (const msg of messages) {
    DOM.thread.appendChild(renderMessage(msg));
  }
  
  // Scroll to bottom
  DOM.thread.scrollTop = DOM.thread.scrollHeight;
}

function renderChatList() {
  if (!DOM.chatList) return;
  
  const search = DOM.searchInput?.value.toLowerCase() || '';
  const filtered = Array.from(state.threads.values())
    .filter(t => {
      if (!search) return true;
      const council = COUNCIL.find(c => c.id === t.chatId);
      return council?.name.toLowerCase().includes(search);
    })
    .sort((a, b) => b.lastTs - a.lastTs);
  
  DOM.chatList.innerHTML = '';
  
  if (filtered.length === 0) {
    // Show all council members if no threads
    COUNCIL.forEach(member => {
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.onclick = () => openChat(member.id);
      
      const avatar = document.createElement('div');
      avatar.className = 'chat-avatar';
      avatar.textContent = member.emoji;
      avatar.style.background = member.accent + '20';
      
      const info = document.createElement('div');
      info.className = 'chat-info';
      
      const name = document.createElement('div');
      name.className = 'chat-name';
      name.textContent = member.name;
      
      const status = document.createElement('div');
      status.className = 'chat-status';
      status.textContent = member.status;
      
      info.appendChild(name);
      info.appendChild(status);
      
      item.appendChild(avatar);
      item.appendChild(info);
      
      DOM.chatList.appendChild(item);
    });
  } else {
    // Show active threads
    filtered.forEach(thread => {
      const council = COUNCIL.find(c => c.id === thread.chatId);
      if (!council) return;
      
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.onclick = () => openChat(thread.chatId);
      
      const avatar = document.createElement('div');
      avatar.className = 'chat-avatar';
      avatar.textContent = council.emoji;
      
      const info = document.createElement('div');
      info.className = 'chat-info';
      
      const name = document.createElement('div');
      name.className = 'chat-name';
      name.textContent = council.name;
      
      const preview = document.createElement('div');
      preview.className = 'chat-preview';
      preview.textContent = thread.lastPreview;
      
      info.appendChild(name);
      info.appendChild(preview);
      
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = formatTime(thread.lastTs);
      
      item.appendChild(avatar);
      item.appendChild(info);
      item.appendChild(meta);
      
      DOM.chatList.appendChild(item);
    });
  }
}

function openChat(chatId) {
  state.activeChatId = chatId;
  
  const council = COUNCIL.find(c => c.id === chatId);
  if (council && DOM.headerName) {
    DOM.headerName.textContent = council.name;
    DOM.headerStatus.textContent = council.status;
    DOM.headerAvatar.textContent = council.emoji;
  }
  
  renderThread();
  setRoute('chat');
  
  if (DOM.msgInput) DOM.msgInput.focus();
}

// ═══════════════════════════════════════════════════════════════
// GAUGES & STATUS
// ═══════════════════════════════════════════════════════════════

function updateGauges() {
  const rushScore = 100 - state.richScore;
  
  if (DOM.richBar) DOM.richBar.style.width = `${state.richScore}%`;
  if (DOM.rushBar) DOM.rushBar.style.width = `${rushScore}%`;
  if (DOM.richValue) DOM.richValue.textContent = Math.round(state.richScore);
  if (DOM.rushValue) DOM.rushValue.textContent = Math.round(rushScore);
  
  // Update theme based on rich score
  const theme = 
    state.richScore < 25 ? 'coal' :
    state.richScore < 50 ? 'ember' :
    state.richScore < 80 ? 'bronze' : 'gold';
  
  document.body.setAttribute('data-theme', theme);
}

async function updateChainStatus() {
  const head = await getChainHead(state.db);
  const len = await getChainLen(state.db);
  
  if (DOM.chainHead) DOM.chainHead.textContent = head.slice(0, 8) + '...';
  if (DOM.chainLen) DOM.chainLen.textContent = String(len);
  if (DOM.mePill) DOM.mePill.textContent = `Me: ${state.identity?.hid.slice(0, 12)}...`;
}

// ═══════════════════════════════════════════════════════════════
// KB SEARCH
// ═══════════════════════════════════════════════════════════════

async function runKBSearch() {
  if (!DOM.brainQuery || !DOM.brainAnswer) return;
  
  const query = DOM.brainQuery.value.trim();
  if (!query) return;
  
  DOM.brainAnswer.textContent = '🔍 Searching...';
  
  try {
    const results = await kbSearch(state.db, query, { limit: 5 });
    
    if (results.length === 0) {
      DOM.brainAnswer.textContent = 'No results found. Try different keywords.';
      return;
    }
    
    DOM.brainAnswer.textContent = results
      .map((r, i) => `${i + 1}. [Score: ${r.score.toFixed(1)}] ${truncate(r.text, 120)}`)
      .join('\n\n');
  } catch (e) {
    console.error('[KB] Search error:', e);
    DOM.brainAnswer.textContent = 'Search failed. Try again.';
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════════════════════

function setRoute(route) {
  state.route = route;
  document.body.setAttribute('data-route', route);
  
  if (route === 'home') {
    if (DOM.chatHeader) DOM.chatHeader.classList.add('hidden');
    if (DOM.thread) DOM.thread.classList.add('hidden');
    if (DOM.composer) DOM.composer.classList.add('hidden');
    if (DOM.emptyState) DOM.emptyState.classList.remove('hidden');
  } else if (route === 'chat') {
    if (DOM.chatHeader) DOM.chatHeader.classList.remove('hidden');
    if (DOM.thread) DOM.thread.classList.remove('hidden');
    if (DOM.composer) DOM.composer.classList.remove('hidden');
    if (DOM.emptyState) DOM.emptyState.classList.add('hidden');
  }
}

// ═══════════════════════════════════════════════════════════════
// LOCK SCREEN
// ═══════════════════════════════════════════════════════════════

async function attemptBiometricUnlock() {
  if (!window.PublicKeyCredential) {
    showToast('⚠️ Biometrics not available. Using demo mode.');
    unlockApp();
    return;
  }
  
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      showToast('⚠️ No biometric hardware detected.');
      unlockApp();
      return;
    }
    
    // For now, just unlock (full WebAuthn implementation in Section 2)
    unlockApp();
  } catch (e) {
    console.error('[Biometrics] Error:', e);
    showToast('⚠️ Biometric unlock failed. Using demo mode.');
    unlockApp();
  }
}

function unlockApp() {
  state.isLocked = false;
  if (DOM.lockScreen) DOM.lockScreen.style.display = 'none';
  if (DOM.app) DOM.app.classList.remove('locked');
  
  console.log('[App] Unlocked');
}

// ═══════════════════════════════════════════════════════════════
// TYPING INDICATOR
// ═══════════════════════════════════════════════════════════════

function showTypingIndicator() {
  if (!DOM.thread) return;
  
  const indicator = document.createElement('div');
  indicator.id = 'typingIndicator';
  indicator.className = 'msg in';
  indicator.style.cssText = 'animation: fadeIn 0.3s;';
  
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  const council = COUNCIL.find(c => c.id === state.activeChatId);
  avatar.textContent = council?.emoji || '🤖';
  
  const dots = document.createElement('div');
  dots.className = 'typing-dots';
  dots.innerHTML = '<span>●</span><span>●</span><span>●</span>';
  dots.style.cssText = 'display: flex; gap: 4px; padding: 12px;';
  
  indicator.appendChild(avatar);
  indicator.appendChild(dots);
  
  DOM.thread.appendChild(indicator);
  DOM.thread.scrollTop = DOM.thread.scrollHeight;
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.remove();
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

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(120, el.scrollHeight) + 'px';
}

// ═══════════════════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════════════════

function bindEvents() {
  if (DOM.btnUnlock) DOM.btnUnlock.onclick = attemptBiometricUnlock;
  if (DOM.btnUnlockDemo) DOM.btnUnlockDemo.onclick = unlockApp;
  
  if (DOM.btnBack) DOM.btnBack.onclick = () => setRoute('home');
  
  if (DOM.searchInput) {
    DOM.searchInput.oninput = () => {
      clearTimeout(sendDebounce);
      sendDebounce = setTimeout(renderChatList, 300);
    };
  }
  
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
  
  if (DOM.brainAsk) DOM.brainAsk.onclick = runKBSearch;
  if (DOM.brainQuery) {
    DOM.brainQuery.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runKBSearch();
      }
    };
  }
  
  if (DOM.themeToggle) {
    DOM.themeToggle.onclick = () => {
      const current = document.body.getAttribute('data-mode') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.body.setAttribute('data-mode', next);
      showToast(`${next === 'dark' ? '🌙' : '☀️'} ${next} mode`);
    };
  }
  
  console.log('[Events] All handlers bound');
}

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

async function init() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Sovereign Business OS v2.0 — Initializing');
  console.log('═══════════════════════════════════════════════════════════════');
  
  try {
    cacheDom();
    await initDB();
    await loadOrCreateIdentity();
    
    const integrityOk = await verifyChainIntegrity();
    if (!integrityOk) {
      showToast('⚠️ Chain integrity check failed. Read-only mode.');
    }
    
    await rebuildProjections();
    
    bindEvents();
    
    renderChatList();
    updateGauges();
    await updateChainStatus();
    setRoute('home');
    
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
    console.log(`  TVM Balance: ${state.tvmBalance}`);
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

// ═══════════════════════════════════════════════════════════════
// SECURE EXPORT (No sensitive data exposed)
// ═══════════════════════════════════════════════════════════════

window.SovereignOS = {
  // Safe methods only
  commitAction,
  getChainHead: () => getChainHead(state.db),
  getChainLen: () => getChainLen(state.db),
  kbSearch: (q, opts) => kbSearch(state.db, q, opts),
  
  // Safe getters (no private keys!)
  getIdentityHid: () => state.identity?.hid || 'Not initialized',
  getRichScore: () => state.richScore,
  getBusinessScore: () => state.businessScore,
  getTVMBalance: () => state.tvmBalance,
  getIntegrityStatus: () => state.chainIntegrityOk,
  isLocked: () => state.isLocked,
  
  // Utility methods
  exportChainStats: async () => ({
    length: await getChainLen(state.db),
    head: (await getChainHead(state.db)).slice(0, 16) + '...',
    richScore: state.richScore,
    tvmBalance: state.tvmBalance,
    threadCount: state.threads.size,
    integrityOk: state.chainIntegrityOk
  }),
  
  // Council data
  COUNCIL,
  
  // Version
  version: '2.0.0'
};

// Explicitly delete any global state references
delete window.state;
delete window.identity;

console.log('[API] window.SovereignOS available (secure)');
