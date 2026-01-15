# Sovereign Business OS — Test Instructions

## Files Delivered

1. **main.js** — Production controller (ES Module)
2. **index.html** — Updated UI with all required DOM elements

## Installation

Copy both files to your project folder alongside:
- `state.js` (existing, locked API)
- `idb.js` (existing)
- `kb.js` (existing)
- `sw.js` (existing service worker)
- `manifest.webmanifest` (existing)
- `icons/` folder (existing)

## Quick Test (Local)

```bash
# From project folder
npx serve .
# Or
python -m http.server 8000
```

Open `http://localhost:8000` (or port shown).

## Verification Checklist

### 1. Identity Generation
- Open DevTools Console
- Look for: `[Identity] Created new: HID-...` or `[Identity] Restored: HID-...`
- Verify: Identity persists across page reloads

### 2. Chain Integrity
- Console shows: `[Integrity] Verified X blocks, OK`
- If chain corrupted: Shows toast warning and read-only mode

### 3. Chain Operations
- Open DevTools Console
- Type: `SovereignOS.getChainLen()`
- Should return current chain length (0 if new)
- Type: `SovereignOS.getChainHead()`
- Should return current head hash or "GENESIS"

### 4. Send Message Flow
1. Click any council member (e.g., "Kareem")
2. Type a message and send
3. Console shows:
   - `[Chain] Committed chat.user at seq=1...`
   - `[Worker] Response: reply...` (or fallback if offline)
   - `[Chain] Committed ai.advice at seq=2...`

### 5. Chain Persistence
1. Send a message
2. Refresh the page
3. Open the same chat
4. Previous messages should appear (rebuilt from chain)

### 6. Rich/Rush Score
- Send messages that get "ACCEPT" decisions → Rich score increases
- Console shows: `[Rebuild] ... richScore=XX`
- Theme changes: coal (<25) → ember (<50) → bronze (<80) → gold (≥80)

### 7. KB Search
1. Send a few messages
2. Use the "Chain Brain" search box at bottom
3. Search for words from your messages
4. Results should appear

### 8. Offline Mode
1. Disconnect network (DevTools → Network → Offline)
2. Try sending a message
3. User message should commit to chain
4. AI response uses mock fallback (shows in UI)
5. Toast may show if worker timeout

## Inspect Chain Data

```javascript
// In DevTools Console

// View all STAs
const tx = SovereignOS.state.db.transaction(['state_chain'], 'readonly');
const store = tx.objectStore('state_chain');
const all = await new Promise(r => { const req = store.getAll(); req.onsuccess = () => r(req.result); });
console.table(all);

// View messages projection
const msgs = Array.from(SovereignOS.state.messages.entries());
console.log(msgs);

// Check integrity
console.log('Integrity OK:', SovereignOS.state.chainIntegrityOk);
```

## API Reference (Exposed on window.SovereignOS)

```javascript
// State object
SovereignOS.state

// Commit action to chain
await SovereignOS.commitAction('chat.user', { chatId: 'kareem', text: 'test', role: 'user' })

// Get chain head
await SovereignOS.getChainHead()

// Get chain length
await SovereignOS.getChainLen()

// KB Search
await SovereignOS.kbSearch('business idea')

// Council data
SovereignOS.COUNCIL
```

## STA Types Supported

| Type | Payload | Projection |
|------|---------|------------|
| `chat.user` | `{ chatId, text, role, tags?, focus? }` | → messages (dir: out) |
| `ai.advice` | `{ chatId, selected_character, mode, bubbles, final, text }` | → messages (dir: in) |
| `biz.decision` | `{ chatId, title, decision, status, ... }` | → messages (tag: DECISION) |
| `biz.outcome` | `{ decisionSeq, outcome, evidence?, ... }` | → messages (tag: OUTCOME) |
| `chat.append` | `{ text }` | Legacy, handled by state.js |

## Troubleshooting

### "Chain integrity error"
- Chain data corrupted
- Clear IndexedDB: DevTools → Application → IndexedDB → Delete `sovereign_os_v1`
- Refresh page

### Messages not persisting
- Check console for `[Chain] Append failed:` errors
- Verify state.js is the correct version

### Worker timeout
- Check CONFIG.WORKER_URL in main.js
- Fallback mock responses will be used offline

### KB search empty
- Messages need to be indexed after commit
- Try: refresh page to rebuild projections

## Production Deployment

1. Set correct `WORKER_URL` in main.js CONFIG
2. Ensure HTTPS (required for WebAuthn, Service Worker)
3. Update manifest.webmanifest with your app name/icons
4. Deploy all files to static hosting (Cloudflare Pages, Vercel, etc.)

## Security Notes

- All chain data signed with ECDSA P-256
- Private key never leaves device (stored in IndexedDB)
- Chain integrity verified on every boot
- Replay attacks prevented by nonce checking
- Append-only: no data can be deleted or modified


## New in v2 (A+B+C+D)

- **Decisions/Outcomes UI**: Use **Decision** button to commit `biz.decision` and **Outcome** (or the **Mark Outcome** button on a DECISION bubble) to commit `biz.outcome`.
- **Quick Actions**: Time Audit / Wheat Test / Money Map buttons now open the Decision modal prefilled.
- **Boardroom Share/Import**:
  - Click **Share** in a chat to export the last 10 STAs for that thread (JSON copied to clipboard).
  - Click **Import** to paste a partner’s JSON; the app verifies signatures best-effort and commits a local `biz.outcome` referencing the shared slice hash.

### v2 Verification Checklist
1. Send a chat message → verify `chat.user` then `ai.advice` committed.
2. Click **Decision** → commit a decision → refresh → decision should still appear.
3. Click **Mark Outcome** on the decision bubble → commit outcome → refresh → outcome should still appear.
4. Click **Share** → paste into a text file.
5. Click **Import** → paste the JSON → verify toast shows `verified x/y` and a new outcome entry appears.
