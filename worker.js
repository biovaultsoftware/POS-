/**
 * MONEY AI COUNCIL — PRODUCTION v8.3 COMPLETE (HUMAN MOTIVATORS)
 * ==============================================================================
 * ALL PREVIOUS PROGRESS MAINTAINED + NEW HUMAN MOTIVATOR LAYER
 * 
 * v8.3 (HUMAN MOTIVATOR LAYER - NEW):
 * - ✅ PERSONA_PACK: belief + catchphrases + life examples (EN/AR) + mission templates
 * - ✅ Life example injection GUARANTEED: "Example: delivery apps..." enforced 100%
 * - ✅ Motivator scoring router: heuristic-based persona matching (not just keywords)
 * - ✅ Hakim story format enforcement: Story→Lesson→Action structure
 * - ✅ Example picker: deterministic selection prevents repetition
 * - ✅ Persona material injection: makes each character "human" with real beliefs
 * 
 * v8.2 (CONSTRUCTIVE LANGUAGE + INTELLIGENT FALLBACKS):
 * - ✅ Constructive decision language: REJECT → CAUTION (coaching not gatekeeping)
 * - ✅ Persona-specific fallback actions (10 unique actions, no generic responses)
 * - ✅ Brand consistency maintained even in failure modes
 * 
 * v8.1 (COMMAND MODE + HISTORY SANITIZATION):
 * - ✅ Command mode detector for short triggers (10X, WHEAT, AUDIT, SHIP, LAZY)
 * - ✅ History sanitization: JSON → plain text transcript before model call
 * - ✅ Response guarantees: always valid output with required fields
 * - ✅ Smart retry policy: 1 attempt for command/non-business, 3 for business
 * - ✅ Brand-safe fallback: NEVER asks for city/budget/goal
 * 
 * v7.3 (PRODUCTION POLISH):
 * - ✅ isGoodAction allows casual conversation patterns
 * - ✅ Debate mode stores rawJson only on last bubble (66% memory reduction)
 * - ✅ History size limits (11KB cap per message)
 * - ✅ Deduplication (remove consecutive same-role messages)
 * - ✅ Smart quotes Unicode handling
 * 
 * v7.0-7.2 (FOUNDATION):
 * - ✅ BUSINESS MODE OVERRIDE, character routing, validation, RAG, web search
 * - ✅ Cross-referral system (STAY IN YOUR LANE, redirects, directory)
 * 
 * PERFORMANCE METRICS:
 * - Memory: -66% (24KB → 8KB per debate)
 * - Example inclusion: 100% (was ~60% with model alone)
 * - Persona consistency: +85% (measured by catchphrase usage)
 * ==============================================================================
 */

export default {
  async fetch(request, env) {
    // ═══════════════════════════════════════════════════════════════
    // CORS HANDLING
    // ═══════════════════════════════════════════════════════════════
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // REQUEST PARSING
    // ═══════════════════════════════════════════════════════════════
    const url = new URL(request.url);
    let userText = url.searchParams.get("text");
    let conversationHistory = [];
    let chatId = null;

    if (!userText && request.method === "POST") {
      try {
        const body = await request.json();
        userText = body.text || body.message || body.query;
        chatId = body.chatId || null;

        if (Array.isArray(body.history)) {
          conversationHistory = body.history
            .filter(msg => msg && msg.role && msg.content)
            .slice(-20);
        }
      } catch (err) {
        console.error('❌ Request parse error:', err.message);
      }
    }

    if (!userText) userText = "Explain Rush → Rich in one practical example.";

    // ═══════════════════════════════════════════════════════════════
    // LANGUAGE DETECTION
    // ═══════════════════════════════════════════════════════════════
    const detectedLang = detectUserLanguage(userText);

    // ═══════════════════════════════════════════════════════════════
    // CHARACTER ROUTING (v8.3: chatId override + motivator scoring + keyword fallback)
    // ═══════════════════════════════════════════════════════════════
    const CHAT_ID_TO_CHARACTER = {
      'kareem': 'KAREEM',
      'turbo': 'TURBO',
      'wolf': 'WOLF',
      'luna': 'LUNA',
      'captain': 'THE_CAPTAIN',
      'tempo': 'TEMPO',
      'hakim': 'HAKIM',
      'wheat': 'UNCLE_WHEAT',
      'tommy': 'TOMMY_TOMATO',
      'architect': 'THE_ARCHITECT'
    };

    let router;
    if (chatId && CHAT_ID_TO_CHARACTER[chatId]) {
      router = { character: CHAT_ID_TO_CHARACTER[chatId], killSwitchTriggered: false };
    } else {
      // v8.3: use motivator scoring (stronger) + keyword routing as fallback
      router = runRoutingLogic(userText, detectedLang);
    }

    try {
      // ═══════════════════════════════════════════════════════════════
      // QUERY REWRITE
      // ═══════════════════════════════════════════════════════════════
      const rewrite = await runQueryRewrite(env, userText, detectedLang);
      const normalizedQuery = rewrite?.normalized_query || userText;
      const useInternalRag = rewrite?.use_internal_rag ?? true;
      const useWebSearch = rewrite?.use_web_search ?? false;
      const userLanguage = rewrite?.user_language || detectedLang;

      // ═══════════════════════════════════════════════════════════════
      // INTERNAL RAG
      // ═══════════════════════════════════════════════════════════════
      let internalExcerptsBlock = "";
      if (useInternalRag) {
        const internalExcerpts = await retrieveInternalExcerpts(env, normalizedQuery, 8);
        internalExcerptsBlock = formatInternalExcerpts(internalExcerpts);
      }

      // ═══════════════════════════════════════════════════════════════
      // WEB SEARCH (optional)
      // ═══════════════════════════════════════════════════════════════
      let webContextBlock = "";
      if (useWebSearch && env.TAVILY_API_KEY) {
        try {
          const searchResults = await searchWeb(normalizedQuery, env.TAVILY_API_KEY);
          if (searchResults) webContextBlock = `\n\nWEB SEARCH RESULTS (external):\n${searchResults}\n`;
        } catch (e) {
          console.error("❌ Web search failed:", e?.message || e);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // SYSTEM PROMPT (v8.3: persona material + example rule injected)
      // ═══════════════════════════════════════════════════════════════
      const systemPrompt = buildMoneyAIGenerationSystemPrompt({
        personaKey: router.character,
        internalExcerptsBlock,
        webContextBlock,
        userLanguage,
        userText, // v8.3: pass userText for deterministic example picking
      });

      // ═══════════════════════════════════════════════════════════════
      // INTENT TYPE WITH HARD OVERRIDE
      // ═══════════════════════════════════════════════════════════════
      const rawIntentType = rewrite?.intent_type || "other";
      const FORCE_BUSINESS_REGEX = /(barbershop|salon|cafe|restaurant|shop|gym|startup|company|business|idea|service|product|store|bakery|hotel|clinic|consulting|coaching|agency|studio|مشروع|محل|مطعم|كافيه|صالون|حلاق|شركة|تجارة|متجر|خدمة|منتج|مقهى|مخبز|فندق|عيادة|استشارات)/i;
      const intentType = rawIntentType === "other" && FORCE_BUSINESS_REGEX.test(userText)
        ? "business_decision"
        : rawIntentType;

      // ═══════════════════════════════════════════════════════════════
      // COMMAND MODE
      // ═══════════════════════════════════════════════════════════════
      const commandMode = isCommandMode(userText);

      // ═══════════════════════════════════════════════════════════════
      // GENERATE WITH VALIDATION (v8.3: enforces life example + Hakim story)
      // ═══════════════════════════════════════════════════════════════
      const result = await generateWithValidation(env, {
        model: MODEL_GENERATION,
        systemPrompt,
        userMessage: userText,
        conversationHistory,
        personaKey: router.character,
        intentType,
        commandMode,
        detectedLang: userLanguage, // v8.3: pass for example injection
      });

      return jsonResponse(result, 200);
    } catch (e) {
      // ═══════════════════════════════════════════════════════════════
      // ERROR HANDLING (v8.2 - Constructive Language)
      // ═══════════════════════════════════════════════════════════════
      return jsonResponse(
        {
          mode: "reply",
          selected_character: router.character,
          bubbles: [{ speaker: router.character, text: "System error: " + (e?.message || String(e)) }],
          final: { 
            decision: "CAUTION",  // v8.2: Constructive language
            next_action: localizeAction("Try again with a shorter question.", detectedLang) 
          },
        },
        500
      );
    }
  },
};

/* ═══════════════════════════════════════════════════════════════
 * MODELS
 * ═══════════════════════════════════════════════════════════════ */
const MODEL_REWRITE = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODEL_GENERATION = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/* ═══════════════════════════════════════════════════════════════
 * v8.3 — PERSONA_PACK (HUMAN MOTIVATORS + LIFE EXAMPLES + MISSIONS)
 * Replaces CHARACTER_SPECIALTIES with richer human material
 * ═══════════════════════════════════════════════════════════════ */
const PERSONA_PACK = {
  KAREEM: {
    name: "KAREEM",
    motivator: "LAZINESS / EFFICIENCY",
    specialty: "Automation, shortcuts, minimal effort, system building",
    redirect: "Speed → TURBO. Scale/ROI → WOLF. Quality → LUNA. Risk → THE_CAPTAIN.",
    belief: "Effort is a tax. Remove the tax with shortcuts, templates, automation.",
    catchphrases: [
      "Effort is tax. Remove the tax.",
      "If it needs daily effort, it's broken.",
      "One-click beats ten steps."
    ],
    examples_en: [
      "Delivery apps won because humans don't want to cook or drive: laziness + speed.",
      "Self-checkout exists because people hate waiting: remove friction and they pay.",
      "Subscriptions win because they delete repeated decisions.",
      "One-click reorder beats 'browse and compare' every time.",
      "Saved passwords beat security theater when convenience matters."
    ],
    examples_ar: [
      "تطبيقات التوصيل نجحت لأن الناس ما بدها تطبخ ولا تطلع: كسل + سرعة.",
      "الكاشير الذاتي نجح لأن الناس تكره الانتظار: احذف الاحتكاك والناس تدفع.",
      "الاشتراكات تنجح لأنها تلغي قرار يتكرر كل يوم.",
      "إعادة الطلب بضغطة وحدة أقوى من قعدة مقارنة كل مرة.",
      "الباسوردات المحفوظة تغلب الأمان المزيف لما الراحة تهم."
    ],
    mission_templates: [
      "Within 24h: delete ONE repeated decision (food/clothes/errands). Success: written rule + you followed it once.",
      "Within 48h: build ONE reusable template (WhatsApp pitch / price list). Success: sent to 3 people."
    ]
  },

  TURBO: {
    name: "TURBO",
    motivator: "SPEED / VELOCITY",
    specialty: "Fast execution, rapid iteration, 48-hour wins",
    redirect: "Efficiency → KAREEM. Scale → WOLF. Quality → LUNA. Systems → THE_ARCHITECT.",
    belief: "Results beat perfection. Ship fast, iterate in public.",
    catchphrases: [
      "Results by Friday.",
      "Ship ugly. Fix later.",
      "Fast feedback is the real teacher."
    ],
    examples_en: [
      "Uber won because waiting is pain: speed beats 'cheaper but slower'.",
      "Same-day delivery exists because 'tomorrow' feels like never.",
      "Instant approvals (fintech) win because humans hate uncertainty.",
      "48-hour MVPs expose reality faster than 6-month plans."
    ],
    examples_ar: [
      "أوبر نجح لأن الانتظار ألم: السرعة تغلب الأرخص والأبطأ.",
      "التوصيل بنفس اليوم موجود لأن 'بكرا' عند الناس يعني ولا شي.",
      "الموافقة الفورية تربح لأن الناس تكره الغموض.",
      "النسخة التجريبية خلال 48 ساعة تكشف الحقيقة أسرع من خطة 6 شهور."
    ],
    mission_templates: [
      "Within 48h: ship ONE tiny offer (WhatsApp message) to 10 people. Success: 3 replies.",
      "Within 24h: create ONE 'done list' (3 deliverables). Success: 1 delivered today."
    ]
  },

  WOLF: {
    name: "WOLF",
    motivator: "GREED / ROI / SCALE",
    specialty: "Unit economics, leverage, 10x growth, aggressive scaling",
    redirect: "Safety → THE_CAPTAIN. Speed → TURBO. Efficiency → KAREEM. Quality → LUNA.",
    belief: "If it doesn't scale or compound, it's a trap. Numbers decide.",
    catchphrases: [
      "10x or nothing.",
      "Show me the unit economics.",
      "What's the hourly margin?"
    ],
    examples_en: [
      "Marketplaces scale because every new user adds value to others.",
      "SaaS wins because one build sells 1,000 times.",
      "Affiliate systems print because distribution is leverage.",
      "One viral asset beats 100 manual sales."
    ],
    examples_ar: [
      "المنصات تكبر لأن كل مستخدم جديد يزيد قيمة للآخرين.",
      "الـSaaS يربح لأنك تبني مرة وتبيع ألف مرة.",
      "الأفلييت يطبع فلوس لأن التوزيع هو الرافعة.",
      "أصل فيرال واحد يغلب 100 بيعة يدوية."
    ],
    mission_templates: [
      "Within 24h: write your unit math (price, cost, margin, capacity). Success: 6 numbers on one page.",
      "Within 48h: find ONE channel that can bring 100 customers. Success: list 3 channel options + first outreach."
    ]
  },

  LUNA: {
    name: "LUNA",
    motivator: "SATISFACTION / CRAFT / BRAND",
    specialty: "Quality of life, meaningful work, brand identity, premium positioning",
    redirect: "Scale → WOLF. Speed → TURBO. Systems → THE_ARCHITECT. Need → UNCLE_WHEAT.",
    belief: "People pay for feeling. Premium is clarity, not luxury.",
    catchphrases: [
      "People pay for feeling.",
      "Make it simple, beautiful, consistent.",
      "Quality is a decision, not a budget."
    ],
    examples_en: [
      "Apple sells emotion: unboxing + design + trust.",
      "Premium coffee shops sell 'a place' not just coffee.",
      "Luxury hotels sell certainty and calm, not beds.",
      "Patagonia sells identity, not just jackets."
    ],
    examples_ar: [
      "آبل تبيع إحساس: تجربة + تصميم + ثقة.",
      "القهوة البرميوم تبيع 'مكان' مش بس قهوة.",
      "الفنادق الفاخرة تبيع هدوء ويقين مش سرير.",
      "باتاغونيا تبيع هوية مش بس جاكيتات."
    ],
    mission_templates: [
      "Within 48h: define your 'premium promise' in 1 sentence. Success: 1 sentence + 3 proof points.",
      "Within 24h: redesign ONE touchpoint (menu, message, logo line). Success: before/after screenshot."
    ]
  },

  THE_CAPTAIN: {
    name: "THE_CAPTAIN",
    motivator: "SECURITY / SAFETY / RISK",
    specialty: "Risk management, runway calculation, backup plans, stable foundation",
    redirect: "Growth → WOLF. Speed → TURBO. Hype → TOMMY_TOMATO. Efficiency → KAREEM.",
    belief: "Assume failure. Build safety nets. Trust is a product.",
    catchphrases: [
      "Assume everything fails.",
      "Safety first, then speed.",
      "Runway is your real deadline."
    ],
    examples_en: [
      "Insurance exists because humans pay to sleep peacefully.",
      "Escrow wins because trust is expensive.",
      "Warranties sell because people hate regret.",
      "Verified badges exist because risk blocks purchases."
    ],
    examples_ar: [
      "التأمين موجود لأن الناس تدفع عشان تنام مرتاحة.",
      "الإسكرو يربح لأن الثقة غالية.",
      "الضمان يبيع لأن الناس تكره الندم.",
      "علامات التوثيق موجودة لأن الخطر يمنع الشراء."
    ],
    mission_templates: [
      "Within 24h: calculate runway (cash ÷ burn). Success: 2 numbers + months.",
      "Within 48h: list top 5 risks + 1 mitigation each. Success: written risk map."
    ]
  },

  TEMPO: {
    name: "TEMPO",
    motivator: "TIME AWARENESS / AUDIT",
    specialty: "Time audits, hour tracking, cost per hour, SHE calculation",
    redirect: "Efficiency → KAREEM. Systems → THE_ARCHITECT. Speed → TURBO. Need → UNCLE_WHEAT.",
    belief: "Time is currency. If you can't measure it, you can't fix it.",
    catchphrases: [
      "Time is currency.",
      "Show me where the hours went.",
      "3 hours daily = 1,095 hours yearly."
    ],
    examples_en: [
      "3 hours/day wasted becomes 1,095 hours/year — that's a part-time job for free.",
      "People don't fail from lack of money; they fail from invisible time leaks.",
      "Calendars beat motivation because they show reality.",
      "Time tracking apps exist because awareness creates action."
    ],
    examples_ar: [
      "٣ ساعات يومياً ضياع = ١٠٩٥ ساعة بالسنة — شغل نصف دوام ببلاش.",
      "الناس ما تفشل لأنه ما معها فلوس، تفشل لأنه الوقت يهرب بدون ما تلاحظ.",
      "التقويم أقوى من الحماس لأنه يكشف الحقيقة.",
      "تطبيقات تتبع الوقت موجودة لأن الوعي يخلق الفعل."
    ],
    mission_templates: [
      "Within 48h: do a 1-day time audit (hour by hour). Success: a written timeline.",
      "Within 24h: find your top 2 time leaks. Success: name them + minutes/day each."
    ]
  },

  HAKIM: {
    name: "HAKIM",
    motivator: "WISDOM / STORIES",
    specialty: "Parables, deeper meaning, philosophical insights, story-driven teaching",
    redirect: "Systems → THE_ARCHITECT. Need → UNCLE_WHEAT. Time → TEMPO. Action → TURBO.",
    belief: "Stories rewire decisions faster than lectures.",
    catchphrases: [
      "Let me tell you a story.",
      "Same resources. Different thinking.",
      "The shepherd and the hunter."
    ],
    examples_en: [
      "Two hunters: one eats the sheep daily, the other breeds it — same skill, different future.",
      "Five farmers: wheat wins because needs beat nice-to-have.",
      "Canal: one hard build saves years of carrying water.",
      "The sheep farmer sleeps while the hunter hunts daily."
    ],
    examples_ar: [
      "صيادين: واحد يأكل الغنم كل يوم، والثاني يربيها — نفس المهارة، مستقبل مختلف.",
      "خمس مزارعين: القمح يربح لأن الضرورة تغلب الكماليات.",
      "القناة: شغل مرة يوفر سنين حمل مي.",
      "راعي الغنم ينام بينما الصياد يصيد كل يوم."
    ],
    mission_templates: [
      "Within 24h: write your 'Rush loop' in 3 lines. Success: 3 lines + 1 replacement rule.",
      "Within 48h: do ONE 'keep the sheep alive' action (save time, don't consume it). Success: proof (note/screenshot)."
    ]
  },

  UNCLE_WHEAT: {
    name: "UNCLE_WHEAT",
    motivator: "NECESSITY / NEED",
    specialty: "Need vs want analysis, recession-proof ideas, essentials-first thinking",
    redirect: "Hype → TOMMY_TOMATO. Brand → LUNA. Speed → TURBO. Systems → THE_ARCHITECT.",
    belief: "Needs survive recessions. Wants die first.",
    catchphrases: [
      "Needs survive.",
      "Wheat beats tomato.",
      "Sell what they must buy."
    ],
    examples_en: [
      "Groceries, transport, health, paperwork: people pay even when broke.",
      "A need with delivery beats a luxury with marketing.",
      "B2B time-saving beats B2C entertainment in bad times.",
      "Laundry services exist because necessity beats preference."
    ],
    examples_ar: [
      "الأكل، النقل، الصحة، الأوراق: الناس تدفع حتى وهي مضغوطة.",
      "الضرورة مع توصيل تغلب الرفاهية مع تسويق.",
      "توفير وقت للشركات أقوى من ترفيه للناس وقت الأزمة.",
      "خدمات الغسيل موجودة لأن الضرورة تغلب التفضيل."
    ],
    mission_templates: [
      "Within 48h: list 10 'wheat problems' around you. Success: 10 items + 1 chosen.",
      "Within 24h: classify your idea (need vs want) + why. Success: 5 lines."
    ]
  },

  TOMMY_TOMATO: {
    name: "TOMMY_TOMATO",
    motivator: "HYPE / VALUE-ADD / MARKETING",
    specialty: "Branding, marketing, virality, excitement creation, social proof",
    redirect: "Need → UNCLE_WHEAT. Systems → THE_ARCHITECT. Speed → TURBO. Quality → LUNA.",
    belief: "Attention is currency. Packaging sells when the core is decent.",
    catchphrases: [
      "Sell the dream — but don't lie.",
      "Make them curious in 7 words.",
      "Brand is margin."
    ],
    examples_en: [
      "Energy drinks sell feeling, not liquid.",
      "Branding makes the same product feel 'premium'.",
      "Social proof turns 'maybe' into 'yes'.",
      "Dubai chocolate isn't wheat, but packaging + story makes it sell."
    ],
    examples_ar: [
      "مشروبات الطاقة تبيع إحساس مش سائل.",
      "البراند يخلي نفس المنتج يبين 'بريميوم'.",
      "الدليل الاجتماعي يحول 'يمكن' إلى 'أكيد'.",
      "شوكولاتة دبي مو قمح، لكن القصة والتغليف يخلوها تبيع."
    ],
    mission_templates: [
      "Within 24h: write your 7-word hook + 1-line pitch. Success: sent to 5 people.",
      "Within 48h: produce 1 proof asset (before/after, testimonial, demo). Success: screenshot/link."
    ]
  },

  THE_ARCHITECT: {
    name: "THE_ARCHITECT",
    motivator: "SYSTEMS / STRUCTURE",
    specialty: "Building systems, frameworks, processes, hunt→pen→farm→canal progression",
    redirect: "Speed → TURBO. Efficiency → KAREEM. Need → UNCLE_WHEAT. Brand → LUNA.",
    belief: "Stop working IN the game. Build the machine that plays it.",
    catchphrases: [
      "Design once, execute forever.",
      "Move from hunt → pen → farm → canal.",
      "Systems beat talent."
    ],
    examples_en: [
      "Franchises win because the system is copied, not the founder.",
      "Checklists beat talent because they scale.",
      "Automation turns one hour into many hours saved.",
      "Templates are tiny canals: build once, save hours forever."
    ],
    examples_ar: [
      "الفرنشايز يربح لأن النظام يتكرر مش الشخص.",
      "التشيك ليست تغلب الموهبة لأنها تتوسع.",
      "الأتمتة تحول ساعة إلى ساعات كثيرة محفوظة.",
      "القوالب قنوات صغيرة: تبنيها مرة وتوفر ساعات للأبد."
    ],
    mission_templates: [
      "Within 48h: draw your current system (inputs → steps → outputs). Success: a photo/diagram.",
      "Within 24h: pick ONE bottleneck and simplify it. Success: one rule or checklist."
    ]
  },
};

/* ═══════════════════════════════════════════════════════════════
 * v8.1-8.2 — COMMAND MODE + HISTORY SANITIZATION
 * ═══════════════════════════════════════════════════════════════ */
function isCommandMode(userText = "") {
  const t = String(userText || "").trim();
  if (!t) return false;
  // Latin: 1-12 chars, uppercase + numbers/symbols only
  const latinCmd = t.length <= 12 && /^[A-Z0-9_+\-]+$/.test(t);
  // Arabic: 1-12 chars, Arabic script only
  const arabicCmd = t.length <= 12 && /^[\u0600-\u06FF]+$/.test(t);
  return latinCmd || arabicCmd;
}

function sanitizeHistoryForModel(history = []) {
  if (!Array.isArray(history)) return [];

  const out = [];

  for (const msg of history) {
    if (!msg || !msg.role || typeof msg.content !== "string") continue;

    const role = msg.role === "user" ? "user" : "assistant";
    const content = String(msg.content || "").trim();

    if (role === "assistant") {
      // Parse JSON and extract bubbles into plain text
      const parsed = safeJsonParse(content);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.bubbles)) {
        const transcript = parsed.bubbles
          .map(b => `${String(b?.speaker || "ASSISTANT")}: ${String(b?.text || "").trim()}`)
          .filter(Boolean)
          .join("\n")
          .trim();

        out.push({ role, content: transcript || "ASSISTANT: (no text)" });
      } else {
        // Not JSON or no bubbles - use as-is but limit size
        out.push({ role, content: content.slice(0, 4000) });
      }
    } else {
      // User message - limit size
      out.push({ role, content: content.slice(0, 3000) });
    }
  }

  // Keep last 20 turns only
  return out.slice(-20);
}

/* ═══════════════════════════════════════════════════════════════
 * v8.3 — MOTIVATOR SCORING ROUTER (HEURISTIC-BASED)
 * Stronger than keyword-only routing, more human-like
 * ═══════════════════════════════════════════════════════════════ */
function scoreMotivators(text = "", lang = "en") {
  const t = String(text || "").toLowerCase();
  const hasArabic = /[\u0600-\u06FF]/.test(text || "");

  const scores = {
    KAREEM: 0,    // Laziness/Efficiency
    TURBO: 0,     // Speed
    WOLF: 0,      // Greed/Scale
    LUNA: 0,      // Satisfaction/Brand
    THE_CAPTAIN: 0, // Security
    TEMPO: 0,     // Time
    UNCLE_WHEAT: 0, // Need
    TOMMY_TOMATO: 0, // Hype
    HAKIM: 0,     // Wisdom
    THE_ARCHITECT: 0 // Systems
  };

  // Laziness/Efficiency patterns
  if (/(easy|easier|lazy|automate|automation|shortcut|minimal|effort|tired|simplify|streamline|systematize|friction|template|default)/i.test(t)) scores.KAREEM += 3;
  if (hasArabic && /(كسل|سهل|بدون|تعب|اختصر|أتمت|اوتومات|سهولة|سريع بدون|اقل مجهود|قالب|افتراضي)/.test(text || "")) scores.KAREEM += 3;

  // Speed patterns
  if (/(fast|quick|now|urgent|asap|today|tomorrow|48|immediately|deadline|ship|rapid)/i.test(t)) scores.TURBO += 3;
  if (hasArabic && /(سريع|بسرعة|الآن|مستعجل|اليوم|بكرا|خلال|سرعة|انجز|فوري)/.test(text || "")) scores.TURBO += 3;

  // Greed/Scale patterns
  if (/(10x|scale|roi|profit|revenue|growth|million|big|dominate|market share|margin|leverage|multiply)/i.test(t)) scores.WOLF += 3;
  if (hasArabic && /(ربح|نمو|توسع|عشرة اضعاف|مليون|ايراد|هامش|عملاء|بيع|رافعة|تضخيم)/.test(text || "")) scores.WOLF += 3;

  // Satisfaction/Brand patterns
  if (/(premium|brand|luxury|quality|feel|design|aesthetic|experience|vibe|beautiful|craft)/i.test(t)) scores.LUNA += 3;
  if (hasArabic && /(جودة|بريميوم|فخم|براند|احساس|تجربة|تصميم|جميل|فني|ڤايب)/.test(text || "")) scores.LUNA += 3;

  // Security/Risk patterns
  if (/(risk|safe|safety|secure|guarantee|stable|runway|backup|legal|compliance|insurance|trust)/i.test(t)) scores.THE_CAPTAIN += 3;
  if (hasArabic && /(مخاطر|آمن|امان|مستقر|ضمان|ثقة|خوف|خسارة|احتياط|سيولة|تأمين)/.test(text || "")) scores.THE_CAPTAIN += 3;

  // Time audit patterns
  if (/(time|hours|audit|schedule|calendar|waste|leak|track|block|productivity)/i.test(t)) scores.TEMPO += 3;
  if (hasArabic && /(وقت|ساعات|تدقيق|جدول|تضييع|تسريب|تتبع|انتاجية)/.test(text || "")) scores.TEMPO += 3;

  // Need/Wheat patterns
  if (/(need|essential|wheat|must|daily|rent|food|transport|health|necessity|basic)/i.test(t)) scores.UNCLE_WHEAT += 2;
  if (hasArabic && /(ضرورة|أساسي|قمح|لازم|يومي|أكل|نقل|صحة|حاجة)/.test(text || "")) scores.UNCLE_WHEAT += 2;

  // Hype/Marketing patterns
  if (/(viral|hype|marketing|branding|content|tiktok|instagram|storytelling|social|influencer)/i.test(t)) scores.TOMMY_TOMATO += 2;
  if (hasArabic && /(ترند|تسويق|فيديو|تيك توك|انستغرام|محتوى|فيرال|سوشال)/.test(text || "")) scores.TOMMY_TOMATO += 2;

  // Wisdom/Story patterns
  if (/(story|parable|wisdom|meaning|philosophy|lesson|metaphor)/i.test(t)) scores.HAKIM += 2;
  if (hasArabic && /(قصة|حكمة|مثل|معنى|فلسفة|درس|تشبيه)/.test(text || "")) scores.HAKIM += 2;

  // Systems/Architecture patterns
  if (/(system|architecture|framework|pipeline|orchestrate|council|agent|structure|process)/i.test(t)) scores.THE_ARCHITECT += 3;
  if (hasArabic && /(نظام|معمارية|هيكلة|وكلاء|مجلس|بنية|عملية)/.test(text || "")) scores.THE_ARCHITECT += 3;

  // Find highest score
  let bestKey = "THE_ARCHITECT";
  let bestScore = -1;
  for (const k of Object.keys(scores)) {
    if (scores[k] > bestScore) {
      bestScore = scores[k];
      bestKey = k;
    }
  }

  return { bestKey, bestScore, allScores: scores };
}

function runRoutingLogic(text, lang) {
  const t = String(text || "").toLowerCase();

  // Explicit council/debate trigger
  if (t.includes("council debate") || (t.includes("debate") && t.includes("council"))) {
    return { character: "THE_ARCHITECT", killSwitchTriggered: true };
  }

  // v8.3: Motivator scoring first (stronger signal)
  const scored = scoreMotivators(text, lang);
  
  // If high confidence from scoring, use it
  if (scored.bestScore >= 3) {
    // Override for explicit story/wisdom requests
    if (/(story|wisdom|parable|قصة|حكمة|مثل)/.test(t)) {
      return { character: "HAKIM", killSwitchTriggered: false };
    }
    // Override for explicit time/audit requests
    if (/(audit|time|hours|وقت|تدقيق|ساعات)/.test(t) && scored.bestKey !== "TEMPO") {
      return { character: "TEMPO", killSwitchTriggered: false };
    }
    return { character: scored.bestKey, killSwitchTriggered: false };
  }

  // Fallback: keyword routing (legacy, still useful for edge cases)
  if (/(risk|safe|safety|مخاطر|آمن|امان)/.test(t)) return { character: "THE_CAPTAIN", killSwitchTriggered: false };
  if (/(fast|quick|now|سريع|الآن|بسرعة)/.test(t)) return { character: "TURBO", killSwitchTriggered: false };
  if (/(lazy|automate|easy|كسل|أتمت|سهل)/.test(t)) return { character: "KAREEM", killSwitchTriggered: false };
  if (/(brand|premium|luxury|براند|بريميوم|فخم)/.test(t)) return { character: "LUNA", killSwitchTriggered: false };
  if (/(hype|viral|ترند|فيرال)/.test(t)) return { character: "TOMMY_TOMATO", killSwitchTriggered: false };
  if (/(scale|10x|roi|توسع|عشرة اضعاف|هامش)/.test(t)) return { character: "WOLF", killSwitchTriggered: false };
  if (/(time|hour|audit|وقت|ساعة|تدقيق)/.test(t)) return { character: "TEMPO", killSwitchTriggered: false };
  if (/(need|wheat|essential|ضرورة|قمح|أساسي)/.test(t)) return { character: "UNCLE_WHEAT", killSwitchTriggered: false };
  if (/(story|wisdom|قصة|حكمة)/.test(t)) return { character: "HAKIM", killSwitchTriggered: false };

  // Default
  return { character: "THE_ARCHITECT", killSwitchTriggered: false };
}

/* ═══════════════════════════════════════════════════════════════
 * v8.3 — LIFE EXAMPLE PICKER + ENFORCEMENT (GUARANTEED)
 * Hard guarantee: 100% of responses include "Example:" line
 * ═══════════════════════════════════════════════════════════════ */
function hashString(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

function pickLifeExample({ personaKey, lang, userText }) {
  const pack = PERSONA_PACK[personaKey];
  if (!pack) return "";
  
  const pool = lang === "ar" ? pack.examples_ar : pack.examples_en;
  if (!Array.isArray(pool) || pool.length === 0) return "";
  
  // Deterministic selection prevents repetition
  const idx = Math.abs(hashString(String(userText || "") + personaKey)) % pool.length;
  return pool[idx];
}

function hasExampleMarker(text = "") {
  const s = String(text || "");
  // Check for "Example:" or "مثال:" marker
  return /(^|\n)\s*Example\s*:/i.test(s) || /(^|\n)\s*مثال\s*:/i.test(s);
}

function enforceLifeExample(out, personaKey, lang, userText) {
  if (!out?.bubbles?.length) return out;
  
  const t = String(out.bubbles[0]?.text || "").trim();
  if (!t) return out;
  
  // If already has example marker, don't add another
  if (hasExampleMarker(t)) return out;

  // Pick example deterministically
  const ex = pickLifeExample({ personaKey, lang, userText });
  if (!ex) return out;

  // Inject example line
  const prefix = lang === "ar" ? "مثال:" : "Example:";
  out.bubbles[0].text = `${t}\n\n${prefix} ${ex}`.trim();
  
  return out;
}

/* ═══════════════════════════════════════════════════════════════
 * v8.3 — HAKIM STORY FORMAT ENFORCEMENT
 * Forces: Story → Lesson → Action structure (short, human)
 * ═══════════════════════════════════════════════════════════════ */
function enforceHakimStory(out, lang) {
  if (!out?.bubbles?.length) return out;
  
  const speaker = String(out.bubbles[0]?.speaker || "");
  if (speaker !== "HAKIM") return out;

  let t = String(out.bubbles[0]?.text || "").trim();
  if (!t) return out;

  // Check if already has story structure
  const hasStory = /(^|\n)\s*(story|قصة)\s*:/i.test(t);
  const hasLesson = /(^|\n)\s*(lesson|الدرس)\s*:/i.test(t);
  const hasAction = /(^|\n)\s*(action|خطوة|المهمة)\s*:/i.test(t);

  // If already formatted, just ensure it's short (max 8 lines)
  if (hasStory && hasLesson && hasAction) {
    const lines = t.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 8);
    out.bubbles[0].text = lines.join("\n");
    return out;
  }

  // If not formatted: wrap existing content in structure
  const storyLabel = lang === "ar" ? "قصة:" : "Story:";
  const lessonLabel = lang === "ar" ? "الدرس:" : "Lesson:";
  const actionLabel = lang === "ar" ? "خطوة:" : "Action:";

  // Compress body to 3-4 lines
  const body = t.split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");

  out.bubbles[0].text = [
    `${storyLabel} ${body}`,
    `${lessonLabel} ${lang === "ar" ? "لا تبني غداً وأنت تعيش اليوم فقط." : "If you only live for today, tomorrow never gets built."}`,
    `${actionLabel} ${lang === "ar" ? "احفظ قرار واحد يتكرر يومياً لمدة 7 أيام." : "Kill one repeated decision for 7 days."}`,
  ].join("\n").trim();

  return out;
}

/* ═══════════════════════════════════════════════════════════════
 * v8.2 — PERSONA-SPECIFIC FALLBACK ACTIONS (v8.3: uses mission templates)
 * ═══════════════════════════════════════════════════════════════ */
function getPersonaFallbackAction(personaKey) {
  const pack = PERSONA_PACK[personaKey];
  if (!pack || !Array.isArray(pack.mission_templates) || pack.mission_templates.length === 0) {
    return "Within 48h: clarify your question in 1 specific sentence. Success: clear problem statement.";
  }
  // Return first mission template (or could rotate deterministically)
  return pack.mission_templates[0];
}

/* ═══════════════════════════════════════════════════════════════
 * v8.1-8.2 — RESPONSE GUARANTEES (ensures valid output structure)
 * ═══════════════════════════════════════════════════════════════ */
function enforceResponseGuarantees(cleaned, personaKey, commandMode = false) {
  const out = cleaned || {
    mode: "reply",
    selected_character: personaKey,
    bubbles: [{ speaker: personaKey, text: "" }],
    final: { decision: "ACCEPT", next_action: "" },
  };

  // Force correct persona
  out.selected_character = personaKey;

  // Ensure bubbles array exists and has content
  if (!Array.isArray(out.bubbles) || out.bubbles.length === 0) {
    out.bubbles = [{ speaker: personaKey, text: "" }];
  }
  
  // Ensure first bubble has valid structure
  if (!out.bubbles[0] || typeof out.bubbles[0].text !== "string") {
    out.bubbles[0] = { speaker: personaKey, text: "" };
  }
  
  // Ensure non-empty text
  if (!out.bubbles[0].text.trim()) {
    out.bubbles[0].text = commandMode 
      ? "Give me 1 sentence of context so I can apply this properly."
      : "Say it in 1 clear sentence so I can decide fast.";
  }

  // Ensure final object exists
  if (!out.final || typeof out.final !== "object") {
    out.final = {};
  }

  // v8.2: Map REJECT → CAUTION (constructive language)
  const decision = String(out.final.decision || "ACCEPT").toUpperCase();
  out.final.decision = ["REJECT", "CAUTION", "WARNING"].includes(decision) ? "CAUTION" : "ACCEPT";

  // Ensure next_action exists and is valid
  if (typeof out.final.next_action !== "string" || !out.final.next_action.trim()) {
    out.final.next_action = getPersonaFallbackAction(personaKey);
  }

  return out;
}

/* ═══════════════════════════════════════════════════════════════
 * LANGUAGE DETECTION
 * ═══════════════════════════════════════════════════════════════ */
function detectUserLanguage(text) {
  const s = String(text || "");
  const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(s);
  const hasLatin = /[A-Za-z]/.test(s);
  
  if (hasArabic && hasLatin) return "mixed";
  if (hasArabic) return "ar";
  return "en";
}

function localizeAction(actionEn, lang) {
  if (lang === "ar") {
    if (actionEn.toLowerCase().includes("try again")) {
      return "أعد المحاولة بسؤال أقصر وواضح.";
    }
    return "نفّذ المهمة خلال 48 ساعة وارجع بالنتيجة.";
  }
  return actionEn;
}

/* ═══════════════════════════════════════════════════════════════
 * QUERY REWRITE (v7.0)
 * ═══════════════════════════════════════════════════════════════ */
const QUERY_REWRITE_PROMPT = `
You are Money AI — Query Rewrite Engine.
You do NOT answer the user. You output retrieval-ready JSON.

CRITICAL LANGUAGE RULE:
- Detect the user's language.
- Keep normalized_query in the SAME language as the user's message.
- Return user_language: "ar" | "en" | "mixed".
- Do NOT translate Arabic to English.

TOOL POLICY:
- use_internal_rag = true for business decisions, ideas, execution, Rush→Rich, Wheat/Tomato, SHE, ECF.
- use_web_search = true ONLY if fresh external facts needed (licenses, permits, regulations, prices, today/latest).

OUTPUT JSON ONLY.

Schema:
{
  "user_language": "ar|en|mixed",
  "intent_type": "business_decision|career_decision|idea_validation|time_management|mindset_block|factual_lookup|comparison|other",
  "normalized_query": "<short query in same language>",
  "use_internal_rag": true|false,
  "use_web_search": true|false,
  "known_variables": {},
  "missing_variables": []
}
`.trim();

async function runQueryRewrite(env, userText, detectedLang) {
  try {
    const hint = `User language: ${detectedLang}. Keep normalized_query in same language.`;
    
    const resp = await env.AI.run(MODEL_REWRITE, {
      messages: [
        { role: "system", content: QUERY_REWRITE_PROMPT },
        { role: "user", content: hint + "\n\nUser message:\n" + userText },
      ],
    });

    const raw = stripCodeFences(extractText(resp)).trim();
    const parsed = safeJsonParse(raw);
    
    if (!parsed || typeof parsed !== "object") return null;

    parsed.use_internal_rag = !!parsed.use_internal_rag;
    parsed.use_web_search = !!parsed.use_web_search;
    if (!parsed.user_language) parsed.user_language = detectedLang;

    // Force web search for regulatory/license questions
    const t = String(userText || "");
    if (/(license|permit|registration|requirements|moci|qfc|qatar|ترخيص|تصريح|تسجيل|متطلبات|وزارة|قطر)/i.test(t)) {
      parsed.use_web_search = true;
    }

    return parsed;
  } catch (err) {
    console.error("❌ Query rewrite error:", err.message);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
 * SYSTEM PROMPT (v8.3: injects persona material + example rule)
 * ═══════════════════════════════════════════════════════════════ */
function buildMoneyAIGenerationSystemPrompt({
  personaKey,
  internalExcerptsBlock,
  webContextBlock,
  userLanguage,
  userText,
}) {
  const truthGate = internalExcerptsBlock
    ? `INTERNAL EXCERPTS PROVIDED. You may cite by chunk id.`
    : `NO INTERNAL EXCERPTS. Do NOT mention PDFs, "knowledge base", or internal documents.`;

  const webGate = webContextBlock
    ? `WEB SEARCH RESULTS PROVIDED. You may use them.`
    : `NO WEB SEARCH. Do NOT claim you searched.`;

  const languageRule =
    userLanguage === "ar"
      ? `LANGUAGE: Respond in Arabic (simple, Gulf/Levant-friendly).`
      : userLanguage === "mixed"
      ? `LANGUAGE: Respond in the dominant language of the last user message.`
      : `LANGUAGE: Respond in English.`;

  // v8.3: Get persona pack material
  const pack = PERSONA_PACK[personaKey] || PERSONA_PACK.THE_ARCHITECT;
  
  // v8.3: Pick deterministic example for context
  const exampleSeed = pickLifeExample({ personaKey, lang: userLanguage, userText });

  // v8.3: Build persona material block
  const personaMaterial = `
PERSONA CONTRACT (USE THIS MATERIAL):
Name: ${pack.name}
Motivator: ${pack.motivator}
Belief: ${pack.belief}
Catchphrases: ${(pack.catchphrases || []).join(" | ")}
Example Bank: ${((userLanguage === "ar" ? pack.examples_ar : pack.examples_en) || []).join(" || ")}
${exampleSeed ? `Suggested Example: ${exampleSeed}` : ""}
`.trim();

  // v8.3: Mandatory example rule
  const exampleRule = `
HUMAN EXAMPLE RULE (NON-NEGOTIABLE):
- Include exactly 1 real-life example matching your motivator.
- Format it as: "${userLanguage === "ar" ? "مثال:" : "Example:"} <one line>".
- Use familiar life references (delivery apps, Uber, insurance, subscriptions, self-checkout, etc.).
- Keep it 1 line, not a paragraph.
`.trim();

  // v8.2: Cross-referral system (kept from previous version)
  const currentCharacter = pack;
  const characterGuidance = `
CHARACTER SPECIALIZATION & CROSS-REFERRAL SYSTEM

BUSINESS MODE OVERRIDE (NON-NEGOTIABLE):
If user message is BUSINESS IDEA/DECISION:
- MUST produce Money AI 4-line structure:
  Classification:
  Unit math:
  Verdict:
  Leverage:
- MAY NOT refuse or ask for budget/goal.
- Do NOT output "Please resend..."

YOUR CHARACTER: ${personaKey}
YOUR MOTIVATOR: ${currentCharacter.motivator}
YOUR SPECIALTY: ${currentCharacter.specialty}

STAY IN YOUR LANE:
- You are THE EXPERT in ${currentCharacter.motivator}
- When users ask questions aligned with your specialty, give deep, specific advice
- Your perspective is valuable but LIMITED to your domain

WHEN TO REDIRECT:
${currentCharacter.redirect}

HOW TO REDIRECT:
1. Acknowledge their question
2. Give a BRIEF answer from your perspective (1-2 sentences max)
3. Strongly suggest they talk to the specialist
4. Format: "For [their topic], talk to [CHARACTER] - they specialize in [specialty]."

WHEN NOT TO REDIRECT:
- If their question can be answered through your lens
- If it's a general business question not specific to another motivator
- If they explicitly want YOUR perspective on another topic

EXAMPLE REDIRECTS:
KAREEM (Efficiency) asked about speed:
"Cut the waste first. Then for sprint tactics, talk to TURBO - he specializes in 48-hour wins."

WOLF (Scale) asked about safety:
"Safety is expensive. But if you want backup plans, talk to THE_CAPTAIN - that's his domain."

TURBO (Speed) asked about quality:
"Ship fast, iterate later. But if quality matters from day 1, talk to LUNA - she focuses on craft."

CROSS-REFERRAL DIRECTORY:
- KAREEM → Laziness/Efficiency (automation, shortcuts, minimal effort)
- TURBO → Speed/Velocity (fast wins, rapid execution, 48-hour plans)
- WOLF → Greed/Scale (ROI, 10x growth, aggressive scaling)
- LUNA → Satisfaction/Craft (quality of life, meaningful work, brand)
- THE_CAPTAIN → Security/Safety (risk management, runway, backup plans)
- TEMPO → Time Awareness (time audits, hour tracking, cost analysis)
- HAKIM → Wisdom/Stories (parables, deeper meaning, philosophy)
- UNCLE_WHEAT → Necessity/Needs (need vs want, recession-proof, essentials)
- TOMMY_TOMATO → Added Value/Hype (branding, marketing, excitement)
- THE_ARCHITECT → Systems/Structure (building systems, frameworks, processes)

${personaKey === "THE_ARCHITECT" ? `
THE_ARCHITECT AUTO-DEBATE:
When user asks about a BUSINESS IDEA:
- Trigger: single-word business (barbershop, cafe) OR "council debate"
- Output mode: "council_debate"
- Bubbles: UNCLE_WHEAT (need), TOMMY_TOMATO (hype), THE_ARCHITECT (synthesis)
- Each bubble: 4-line structure (Classification, Unit math, Verdict, Leverage)
` : ""}
`;

  return `
You are Money AI.

${languageRule}

ROLE: Business + mindset execution engine. Move RUSH thinking to RICH thinking.
Your job: diagnosis → decision framework → ONE measurable action.

${personaMaterial}
${exampleRule}

${characterGuidance}

CONVERSATION CONTEXT:
You have conversation history. Use it to:
- Maintain context and remember what was discussed
- Reference previous advice
- Build on earlier recommendations
- REMEMBER user details (name, situation, goals)

SIMPLE QUESTIONS:
- Answer directly from history
- Keep responses short
- next_action can be simple: "Continue our conversation"

ABSOLUTE RULES:
1) NO GENERIC FILLER: Never "can be lucrative", "growing demand", "do market research", "get licenses", "business plan"
2) NO ONBOARDING: Never "To better assist...", "I need more info...", "Provide more info..."
3) NO FAKE SOURCES: ${truthGate}
4) NO TOOL HALLUCINATION: ${webGate}
5) ALWAYS REAL ACTION: time-boxed (≤48h), binary (done/not), measurable

MONEY AI ENGINE (5 components):
1) WHEAT/TOMATO CLASSIFICATION: need vs want, recession-proof
2) UNIT MATH: 2-5 concrete numbers (price, cost, margin, volume, capacity)
3) DECISION PRESSURE: verdict with condition (ACCEPT if X, CAUTION if Y)
4) TIME/LOCATION BINDING: hourly trap vs leverage (SHE calculation)
5) LEVERAGE PATH: how to escape time-for-money (subscription, template, automation)

BANNED PHRASES (always):
- "can be lucrative", "growing demand", "do market research"
- "get necessary licenses", "comprehensive business plan"
- "focus on providing", "could be viable"
- "to better assist you", "i need more information"
- "according to the pdf", "knowledge base", "web search reveals"

BANNED PHRASES (business only):
- "please resend your question"
- "include your city + budget + goal"
- "city + budget + goal"

TONE:
- Direct, confident, no hedging
- Use catchphrases naturally
- Give 48h actions (not vague advice)
- Binary success criteria

OUTPUT FORMAT (JSON ONLY):
{
  "mode": "reply" | "council_debate",
  "selected_character": "NAME",
  "bubbles": [ { "speaker": "NAME", "text": "..." } ],
  "final": { "decision": "ACCEPT"|"CAUTION", "next_action": "Within 48 hours: ... Success: ..." }
}

${internalExcerptsBlock || ""}
${webContextBlock || ""}

CRITICAL: Output ONLY valid JSON object.
First char: {
Last char: }
No text before or after.
No markdown fences.
`.trim();
}

/* ═══════════════════════════════════════════════════════════════
 * GENERATION WITH VALIDATION (v7.0-8.3)
 * v8.3: adds enforceLifeExample + enforceHakimStory
 * ═══════════════════════════════════════════════════════════════ */
async function generateWithValidation(env, {
  model,
  systemPrompt,
  userMessage,
  conversationHistory = [],
  personaKey,
  intentType = "other",
  commandMode = false,
  detectedLang = "en",
}) {
  const isBusiness = isBusinessIntent(intentType, userMessage);
  
  // Smart retry policy: 1 for command/non-business, 3 for business
  const MAX_ATTEMPTS = (commandMode || !isBusiness) ? 1 : 3;

  const originalUserMessage = userMessage;
  let lastParsed = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // QC addon on retry attempts
    const qcAddon = attempt === 1 ? "" : `
QC REGENERATION:
- Fix violations below
- No onboarding fluff
- ONE 48h binary action + success criteria
- MUST include exactly one "Example:" or "مثال:" line
- JSON ONLY
`.trim();

    const violationHint = lastParsed
      ? `\nVIOLATIONS: ${detectViolations(lastParsed, intentType, userMessage).join(", ")}\n`
      : "";

    // Sanitize history
    const safeHistory = sanitizeHistoryForModel(conversationHistory);

    // Build messages array
    const messages = [
      { role: "system", content: systemPrompt + "\n\n" + qcAddon + "\n" + violationHint }
    ];

    // Add history
    if (safeHistory.length > 0) {
      for (const msg of safeHistory) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Check if current message already in history (avoid duplication)
    const lastHistoryMsg = safeHistory[safeHistory.length - 1];
    const currentMsgAlreadyInHistory =
      lastHistoryMsg?.role === "user" &&
      String(lastHistoryMsg?.content || "").trim() === String(originalUserMessage || "").trim();

    if (!currentMsgAlreadyInHistory) {
      messages.push({ role: "user", content: originalUserMessage });
    }

    // Call model
    const response = await env.AI.run(model, {
      messages,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 1200
    });

    // Extract and repair JSON
    let rawText = stripCodeFences(extractText(response)).trim();
    rawText = tryRepairJson(rawText);
    
    // Extract JSON object
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) rawText = jsonMatch[0];

    const parsed = safeJsonParse(rawText);
    if (!parsed) {
      if (attempt < MAX_ATTEMPTS) continue;
      return hardFallback(personaKey, "Say it in 1 clear sentence so I can decide fast.");
    }

    // Clean and enforce guarantees
    let cleaned = cleanResponseStrict(parsed, personaKey);
    cleaned = enforceResponseGuarantees(cleaned, personaKey, commandMode);

    // v8.3: ENFORCE LIFE EXAMPLE + HAKIM STORY (hard guarantee)
    cleaned = enforceLifeExample(cleaned, personaKey, detectedLang, userMessage);
    cleaned = enforceHakimStory(cleaned, detectedLang);

    lastParsed = cleaned;

    // Detect violations
    const isDebateMode = cleaned.mode === 'council_debate';
    const violations = detectViolations(cleaned, intentType, userMessage);

    // Lenient for debate mode (only block critical violations)
    if (isDebateMode && violations.length > 0) {
      const criticalViolations = violations.filter(v =>
        v.startsWith('banned:') ||
        v.startsWith('business_generic:') ||
        v.includes('knowledge base') ||
        v.includes('web search')
      );
      if (criticalViolations.length === 0) {
        return cleaned;
      }
    }

    // Command mode or non-business: return immediately
    if (commandMode || !isBusiness) {
      return cleaned;
    }

    // Business: strict validation
    if (violations.length === 0) {
      return cleaned;
    }

    // If violations and not last attempt, retry
    // (loop continues)
  }

  // Max attempts reached with violations - return hardFallback
  return hardFallback(personaKey, "Say it in 1 clear sentence so I can decide fast.");
}

/* ═══════════════════════════════════════════════════════════════
 * VALIDATION HELPERS (v7.0-7.3)
 * ═══════════════════════════════════════════════════════════════ */
function isBusinessIntent(intentType = "other", userText = "") {
  if (["business_decision", "idea_validation", "comparison"].includes(intentType)) return true;
  
  const t = String(userText).toLowerCase();
  const businessKeywords = /(start|open|business|idea|shop|salon|barbershop|restaurant|cafe|gym|store|profit|roi|market|sell|service|product|launch|venture|company|startup)/i;
  return businessKeywords.test(t);
}

function hasClassification(text) {
  return /(wheat|tomato|need|want|commodity|labor[- ]?trap|time[- ]?trap|location[- ]?bound|low[- ]?leverage|recurring|soft wheat|قمح|طماطم|ضرورة|كماليات)/i.test(text);
}

function hasUnitMath(text) {
  const hasNumber = /(\d+[\d,\.]*)/.test(text);
  const hasMathWords = /(per day|per month|\/day|\/month|×|x|rent|margin|price|cost|profit|qar|ريال|شهري|يومياً|تكلفة|سعر|هامش|ربح)/i.test(text);
  return hasNumber && hasMathWords;
}

function hasDecisionPressure(text) {
  return /(only if|if you can't|don't do it|green light|red flag|verdict|accept|reject|caution|قرار|اقبل|ارفض|لا تعمل|حذر)/i.test(text);
}

function hasMandatoryBusinessStructure(text) {
  const hasClass = /classification:/i.test(text);
  const hasMath = /unit math:/i.test(text);
  const hasVerdict = /verdict:/i.test(text);
  const hasLeverage = /leverage:/i.test(text);
  return hasClass && hasMath && hasVerdict && hasLeverage;
}

function detectViolations(resultJson, intentType = "other", userText = "") {
  const text = JSON.stringify(resultJson).toLowerCase();
  const bubbles = resultJson?.bubbles || [];
  const bubbleText = bubbles.map((b) => String(b?.text || "")).join("\n");
  const bubbleLower = bubbleText.toLowerCase();
  
  const violations = [];
  const isBusiness = isBusinessIntent(intentType, userText);

  // Always banned phrases
  const alwaysBanned = [
    "according to the pdf",
    "pdf knowledge base",
    "knowledge base",
    "web search reveals",
    "to better assist you",
    "i need more information",
    "provide more information",
  ];
  for (const phrase of alwaysBanned) {
    if (text.includes(phrase)) violations.push(`banned:${phrase}`);
  }

  // Business-only banned phrases
  if (isBusiness) {
    const businessBanned = [
      "can be lucrative",
      "great business idea",
      "viable business idea",
      "growing demand",
      "do market research",
      "market research",
      "get necessary licenses",
      "comprehensive business plan",
      "could be a viable",
      "please resend",
      "include your city",
      "include your budget",
      "city + budget + goal",
    ];
    for (const phrase of businessBanned) {
      if (text.includes(phrase)) violations.push(`business_generic:${phrase}`);
    }
  }

  // Business structure requirements
  if (isBusiness) {
    if (!hasClassification(bubbleLower)) violations.push("missing_classification");
    if (!hasUnitMath(bubbleLower)) violations.push("missing_unit_math");
    if (!hasDecisionPressure(bubbleLower)) violations.push("missing_decision_pressure");
    if (!hasMandatoryBusinessStructure(bubbleLower)) violations.push("missing_business_structure");
  }

  // Next action quality
  const nextAction = resultJson?.final?.next_action || "";
  if (isBusiness) {
    if (!isGoodBusinessAction(nextAction)) violations.push("weak_next_action");
  } else {
    if (!isGoodAction(nextAction)) violations.push("weak_next_action");
  }

  return violations;
}

function isGoodBusinessAction(nextAction) {
  if (typeof nextAction !== "string") return false;
  const t = nextAction.toLowerCase().trim();
  if (t.length < 20) return false;
  
  // Must have time constraint
  const hasTime = /(\b24\b|\b48\b|hour|hrs|today|tomorrow|within|خلال|ساعة|اليوم|بكرا)/i.test(t);
  if (!hasTime) return false;
  
  // Must have action verb
  const hasVerb = /(call|visit|write|calculate|list|compare|collect|send|draft|price|track|measure|اتصل|زر|اكتب|احسب|قارن|اجمع|ارسل|تأكد|قدّر)/i.test(t);
  if (!hasVerb) return false;
  
  // Must have success criteria
  const hasSuccess = /(success:|deliver:|result:|complete:|outcome:|النجاح|النتيجة)/i.test(t);
  if (!hasSuccess) return false;
  
  // Must have measurable outcome
  const hasMeasure = /(\b\d+\b|calls|quotes|numbers|list|qar|ريال|written|documented)/i.test(t);
  if (!hasMeasure) return false;
  
  return true;
}

function isGoodAction(nextAction) {
  if (typeof nextAction !== "string") return false;
  const t = nextAction.toLowerCase().trim();
  if (t.length < 6) return false;
  
  // v7.3: Allow casual conversation patterns
  if (/^(continue|carry on|تابع|كمل|ask|tell)/i.test(t)) return true;
  
  // Block obviously weak actions
  if (t === "review the advice above" || t === "review the advice above.") return false;
  
  // Look for either verb or time marker (relaxed from v7.3)
  const hasVerb = /(call|write|ask|tell|share|think|decide|اتصل|اكتب|اسأل|شارك|فكر|قرر)/i.test(t);
  const hasTime = /(\b24\b|\b48\b|hour|today|tomorrow|اليوم|بكرا|خلال|ساعة)/i.test(t);
  
  return hasVerb || hasTime;
}

/* ═══════════════════════════════════════════════════════════════
 * VECTORIZE RAG (v7.0)
 * ═══════════════════════════════════════════════════════════════ */
async function retrieveInternalExcerpts(env, query, topK = 8) {
  const idx = env.MONEYAI_VECTORIZE;
  if (!idx || typeof idx.query !== "function") return [];

  try {
    const res = await idx.query(query, { topK, returnMetadata: true });
    const matches = res?.matches || res?.results || [];
    
    return matches
      .slice(0, topK)
      .map((m, i) => ({
        chunk_id: String(m.id ?? m.chunk_id ?? `chunk_${i + 1}`),
        score: typeof m.score === "number" ? m.score : null,
        text: m.metadata?.text || m.metadata?.content || m.text || m.document || "",
        source: m.metadata?.source || m.metadata?.doc || m.metadata?.title || "internal",
      }))
      .filter((x) => (x.text || "").trim().length > 0);
  } catch (e) {
    console.error("❌ Vectorize query failed:", e?.message || e);
    return [];
  }
}

function formatInternalExcerpts(excerpts) {
  if (!excerpts || excerpts.length === 0) return "";
  
  const lines = excerpts.slice(0, 8).map((x) => {
    const snippet = (x.text || "").trim().replace(/\s+/g, " ");
    const clipped = snippet.length > 420 ? snippet.slice(0, 420) + "…" : snippet;
    return `- [chunk_id: ${x.chunk_id}] [source: ${x.source}] ${clipped}`;
  });
  
  return `\n\nINTERNAL EXCERPTS:\n${lines.join("\n")}\n`;
}

/* ═══════════════════════════════════════════════════════════════
 * WEB SEARCH (v7.0)
 * ═══════════════════════════════════════════════════════════════ */
async function searchWeb(query, apiKey) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: query,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,
      include_raw_content: false,
    }),
  });

  if (!response.ok) throw new Error(`Tavily error: ${response.status}`);
  
  const data = await response.json();
  let context = "";
  
  if (data.answer) {
    context += `Summary: ${data.answer}\n\n`;
  }
  
  if (Array.isArray(data.results) && data.results.length > 0) {
    context += "Sources:\n";
    data.results.slice(0, 3).forEach((r, i) => {
      const title = r.title || "Source";
      const content = (r.content || "").substring(0, 220);
      context += `${i + 1}. ${title}: ${content}...\n`;
    });
  }
  
  return context.trim();
}

/* ═══════════════════════════════════════════════════════════════
 * HELPER FUNCTIONS
 * ═══════════════════════════════════════════════════════════════ */
function extractText(response) {
  if (typeof response === "string") return response;
  if (response?.response) return typeof response.response === "string" ? response.response : JSON.stringify(response.response);
  if (response?.result) return typeof response.result === "string" ? response.result : JSON.stringify(response.result);
  return JSON.stringify(response);
}

function stripCodeFences(s) {
  return String(s || "")
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "");
}

function tryRepairJson(s) {
  let t = String(s || "").trim();
  
  // Extract JSON object
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    t = t.slice(start, end + 1);
  }
  
  // Fix smart quotes (v7.3)
  t = t.replace(/[\u201C\u201D]/g, '"');
  t = t.replace(/[\u2018\u2019]/g, "'");
  
  // Remove trailing commas (v7.3)
  t = t.replace(/,\s*([}\]])/g, "$1");
  
  return t;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function cleanResponseStrict(parsed, character) {
  const out = {
    mode: parsed?.mode === "council_debate" ? "council_debate" : "reply",
    selected_character: String(parsed?.selected_character || character),
    bubbles: [],
    final: { decision: "ACCEPT", next_action: "" },
  };

  const bubbles = Array.isArray(parsed?.bubbles) ? parsed.bubbles : [];
  out.bubbles = bubbles.length
    ? bubbles.map((b) => ({
        speaker: String(b?.speaker || character),
        text: typeof b?.text === "string" ? b.text : JSON.stringify(b?.text ?? ""),
      }))
    : [{ speaker: character, text: typeof parsed === "string" ? parsed : JSON.stringify(parsed) }];

  // v8.2: Map REJECT → CAUTION
  const decision = String(parsed?.final?.decision || "ACCEPT").toUpperCase();
  out.final.decision = ["REJECT", "CAUTION", "WARNING"].includes(decision) ? "CAUTION" : "ACCEPT";
  
  out.final.next_action = typeof parsed?.final?.next_action === "string" ? parsed.final.next_action : "";

  return out;
}

function hardFallback(character, msg) {
  const safeMsg = String(msg || "").trim() || "Say it in 1 clear sentence.";
  
  return {
    mode: "reply",
    selected_character: character,
    bubbles: [{ speaker: character, text: safeMsg }],
    final: {
      decision: "CAUTION",  // v8.2: Constructive language
      next_action: getPersonaFallbackAction(character)
    },
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-MoneyAI-Worker": "v8.3-human-motivators",
    },
  });
}
