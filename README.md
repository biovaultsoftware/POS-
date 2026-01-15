# 💰 Money AI — Rush → Rich PWA

A premium, local-first Progressive Web App that coaches users from **Rush mode** (survival, panic, trading time for money) to **Rich mode** (systems, leverage, calm abundance).

![Money AI Preview](https://via.placeholder.com/800x400/0a0c10/f59e0b?text=Money+AI+%E2%80%94+Rush+%E2%86%92+Rich)

## ✨ Features

### 🔐 Security & Privacy
- **Biometric Lock Screen** — Face ID / Touch ID via WebAuthn
- **Local-First Storage** — IndexedDB, no cloud dependency
- **Zero Account Required** — No email, no password

### 🧠 6 AI Mentors
| Mentor | Role | Style |
|--------|------|-------|
| **Omar** | Simplifier | "Make it easy." Cuts complexity. |
| **Zaid** | Mover | "Fast wins only." 48-hour action plans. |
| **Kareem** | Builder | "More. But smarter." Systems & leverage. |
| **Maya** | Architect | "Discipline is freedom." Structure & plans. |
| **Salma** | Stabilizer | "Breathe. Then move." Reduces panic. |
| **Hakim** | Storyteller | Weekly parables (Tue/Fri only). |

### 📊 Insights System
- **Rush vs Rich Gauges** — Real-time mindset scoring
- **Focus Detection** — Auto-detects: debts, business, jobs, time, wheat
- **Money Map Progress** — Hunt → Pen → Farm → Canal stages
- **12-Message Sessions** — Encourages action over endless chat

### 🎨 Coal → Gold Theme
Dynamic visual progression based on your Rich score:
- `< 25` → **Coal** (dark, muted)
- `25-49` → **Ember** (orange hints)
- `50-79` → **Bronze** (warm glow)
- `80+` → **Gold** (full prosperity)

### 📱 PWA Ready
- Installable on iOS/Android
- Offline support via Service Worker
- Mobile-first responsive design

---

## 🚀 Quick Start

### Option 1: Static Hosting (Mock AI)

Just open `index.html` in a browser. Works offline with mock responses.

```bash
# Or serve locally
npx serve .
```

### Option 2: With Real AI (Cloudflare + Gemini)

This gives you **free, fast, intelligent responses** using:
- **Gemini 1.5 Flash** — Google's fastest smart model (free tier: 1500 req/day)
- **Cloudflare Workers** — Edge computing (free tier: 100k req/day)

---

## 🔧 Cloudflare + Gemini Setup

### Prerequisites
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- [Google AI Studio account](https://aistudio.google.com/) (free)
- Node.js 18+ installed

### Step 1: Get Your Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click **"Create API Key"**
3. Copy the key (starts with `AIza...`)

### Step 2: Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

### Step 3: Deploy the Worker

```bash
# Navigate to the project
cd moneyai

# Set your API key as a secret
wrangler secret put GEMINI_API_KEY
# Paste your API key when prompted

# Deploy
wrangler deploy
```

After deploy, you'll get a URL like:
```
https://moneyai-bridge.YOUR_SUBDOMAIN.workers.dev
```

### Step 4: Configure the Frontend

Edit `main.js` and update:

```javascript
const CONFIG = {
  // ... other config
  USE_REAL_API: true,  // ← Enable real API
  WORKER_URL: 'https://moneyai-bridge.YOUR_SUBDOMAIN.workers.dev'
};
```

### Step 5: (Optional) Add Rate Limiting

For production, create a KV namespace for rate limiting:

```bash
# Create the namespace
wrangler kv:namespace create "RATE_LIMITER"

# Copy the ID and update wrangler.toml:
# [[kv_namespaces]]
# binding = "RATE_LIMITER"
# id = "YOUR_KV_NAMESPACE_ID"

# Redeploy
wrangler deploy
```

---

## 📁 File Structure

```
moneyai/
├── index.html      # Main app (HTML + CSS)
├── main.js         # Application logic (IIFE pattern)
├── worker.js       # Cloudflare Worker (Gemini bridge)
├── wrangler.toml   # Worker configuration
└── README.md       # This file
```

---

## 🧩 Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │   Cloudflare    │     │                 │
│   Money AI      │────▶│    Worker       │────▶│  Gemini 1.5     │
│   (Browser)     │     │  (Edge/WAF)     │     │    Flash        │
│                 │◀────│                 │◀────│                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │
        ▼                       ▼
   IndexedDB              Rate Limiting
   (Local)                   (KV)
```

### Why This Stack?

| Component | Cost | Benefit |
|-----------|------|---------|
| Gemini 1.5 Flash | $0 (free tier) | Fastest intelligent model |
| Cloudflare Worker | $0 (free tier) | Global edge, WAF protection |
| IndexedDB | $0 | Local-first, offline support |

---

## 🎯 Core Frameworks

The AI mentors teach these frameworks:

### 1. Wheat vs Tomatoes
- **Wheat** = Things people NEED (survives recessions)
- **Tomatoes** = Things people WANT (competes with millions)
- Always ask: "Is my offer wheat or tomatoes?"

### 2. Time Audit
- Track hours as currency
- **SHE** (Standard Human Efficiency) = 5 units/hour
- Most waste 60% on $0-paying activities

### 3. Money Map Stages
1. **Hunt** — Trading time for money (jobs)
2. **Pen** — Capturing first "sheep" (repeatable client)
3. **Farm** — Multiple pens working together
4. **Canal** — Systems that flow without you

### 4. Five Motivators
Detect what drives the user:
- **Laziness** → Show shortcuts
- **Speed** → 48-hour plans
- **Greed** → Scaling paths
- **Satisfaction** → Mastery focus
- **Security** → Safety nets first

---

## 🛠️ Customization

### Adding New Mentors

In `main.js`, add to `MENTORS` array:

```javascript
{
  id: 'newmentor',
  name: 'New Mentor',
  role: 'role',
  status: 'Tagline here.',
  emoji: '🆕',
  accent: '#hexcolor',
  description: 'What they do'
}
```

Then add starter messages in `STARTERS` and reel content in `REELS_CONTENT`.

### Changing Theme Colors

In `index.html`, modify the CSS variables:

```css
:root {
  --glow-primary: #f97316;    /* Main accent */
  --gold-core: #f59e0b;       /* Gold color */
  --rush-color: #ef4444;      /* Rush mode */
  --rich-color: #22c55e;      /* Rich mode */
}
```

### Adjusting Session Limit

In `main.js`:

```javascript
const CONFIG = {
  SESSION_LIMIT: 12,  // Change this
  // ...
};
```

---

## 📱 Deployment Options

### Cloudflare Pages (Recommended)
```bash
# Install Wrangler if not already
npm install -g wrangler

# Deploy static files
wrangler pages deploy . --project-name moneyai
```

### Netlify
```bash
# Drag & drop folder to netlify.com
# Or use CLI
netlify deploy --prod
```

### Vercel
```bash
vercel --prod
```

### GitHub Pages
1. Push to GitHub repo
2. Settings → Pages → Deploy from main branch

---

## 🔒 Security Notes

1. **Never expose your Gemini API key** in frontend code
2. The Worker acts as a secure proxy
3. Rate limiting prevents abuse
4. Cloudflare WAF blocks malicious requests
5. All user data stays in browser (IndexedDB)

---

## 📄 License

MIT License — Use freely for personal or commercial projects.

---

## 🙏 Credits

- **Design System**: Coal-to-Gold progression
- **Fonts**: Space Grotesk, JetBrains Mono
- **AI**: Google Gemini 1.5 Flash
- **Hosting**: Cloudflare Workers & Pages

---

<p align="center">
  <strong>💰 From Rush to Rich — One conversation at a time.</strong>
</p>
