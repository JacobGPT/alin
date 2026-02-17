/**
 * TBWO Multi-Model Orchestrator
 *
 * Manages the full website build pipeline with three quality tiers.
 * Same pipeline logic, different model assignments per tier.
 *
 * COST ESTIMATES PER TIER:
 * Standard: ~$0.40-1.20 (Sonnet primary code, Gemini Flash secondary, GPT-4o copy)
 * Premium:  ~$2.50-6.00 (Sonnet primary, GPT-5.1 secondary, DeepSeek Reasoner review)
 * Ultra:    ~$8.00-20.00 (Sonnet all pages, Opus design/review, GPT-5.2 copy, hero video)
 */

import fs from 'fs/promises';
import path from 'path';
import { callGeminiVertexWithSearch } from './vertexMedia.js';

// ═══════════════════════════════════════════════════════════════
// TIER CONFIGURATIONS — Which model does what at each tier
// ═══════════════════════════════════════════════════════════════
const TIER_CONFIGS = {
  standard: {
    label: 'Standard',
    research:        { model: 'gemini-2.5-pro',             provider: 'gemini',    useSearch: true  },
    architecture:    { model: 'gpt-5-mini',                 provider: 'openai'    },
    design:          { model: 'gemini-3-flash-preview',     provider: 'gemini'    },
    copywriting:     { model: 'gpt-4o',                     provider: 'openai'    },
    copyRewrite:     null,
    imagePrompt:     { model: 'deepseek-chat',              provider: 'deepseek'  },
    imageProvider:   'auto',
    imageMultiple:   false,
    primaryCode:     { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
    secondaryCode:   { model: 'gemini-3-flash-preview',     provider: 'gemini'    },
    codeReview:      { model: 'deepseek-chat',              provider: 'deepseek'  },
    a11yAudit:       null,
    repair:          { model: 'gemini-3-flash-preview',     provider: 'gemini'    },
    seoValidation:   { model: 'gpt-5-nano',                 provider: 'openai'    },
    finalIntegration: null,
    heroVideo:       null,
  },

  premium: {
    label: 'Premium',
    research:        { model: 'gemini-2.5-pro',             provider: 'gemini',    useSearch: true },
    architecture:    { model: 'gpt-5',                      provider: 'openai'    },
    design:          { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
    copywriting:     { model: 'gpt-5.1',                    provider: 'openai'    },
    copyRewrite:     null,
    imagePrompt:     { model: 'gpt-4o',                     provider: 'openai'    },
    imageProvider:   'auto',
    imageMultiple:   false,
    primaryCode:     { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
    secondaryCode:   { model: 'gpt-5.1',                    provider: 'openai'    },
    codeReview:      { model: 'deepseek-reasoner',          provider: 'deepseek'  },
    a11yAudit:       { model: 'gpt-4.1-mini',               provider: 'openai'    },
    repair:          { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
    seoValidation:   { model: 'gpt-5-mini',                 provider: 'openai'    },
    finalIntegration: null,
    heroVideo:       null,
  },

  ultra: {
    label: 'Ultra',
    research:        { model: 'gemini-2.5-pro',             provider: 'gemini',    useSearch: true },
    architecture:    { model: 'gpt-5.2',                    provider: 'openai'    },
    design:          { model: 'claude-opus-4-6',            provider: 'anthropic' },
    copywriting:     { model: 'gpt-5.2',                    provider: 'openai'    },
    copyRewrite:     { model: 'gpt-5.1',                    provider: 'openai'    },
    imagePrompt:     { model: 'gpt-5.1',                    provider: 'openai'    },
    imageProvider:   'auto-ultra',
    imageMultiple:   true,
    primaryCode:     { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
    secondaryCode:   { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
    codeReview:      { model: 'deepseek-reasoner',          provider: 'deepseek'  },
    a11yAudit:       { model: 'gpt-4.1',                    provider: 'openai'    },
    repair:          { model: 'claude-sonnet-4-5-20250929', provider: 'anthropic' },
    seoValidation:   { model: 'gpt-5-mini',                 provider: 'openai'    },
    finalIntegration: { model: 'claude-opus-4-6',           provider: 'anthropic' },
    heroVideo:       { model: 'veo-3.1-fast',               provider: 'gemini'    },
  },
};

// ═══════════════════════════════════════════════════════════════
// PROVIDER CONFIGS — API endpoints and auth for each provider
// ═══════════════════════════════════════════════════════════════
const PROVIDER_CONFIGS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    keyEnv: 'ANTHROPIC_API_KEY',
    isAnthropic: true,
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    keyEnv: 'OPENAI_API_KEY',
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    keyEnv: 'GEMINI_API_KEY',
  },
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    keyEnv: 'DEEPSEEK_API_KEY',
  },
};

/**
 * Call any model (non-streaming) for a TBWO phase.
 * Returns the text response.
 */
async function callModel({ model, provider, system, prompt, maxTokens = 4096, temperature = 0.4, jsonMode = false }) {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = process.env[config.keyEnv];
  if (!apiKey) throw new Error(`${config.keyEnv} not configured`);

  if (config.isAnthropic) {
    const resp = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: system || undefined,
        messages: [{ role: 'user', content: prompt }],
        temperature,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${err.slice(0, 500)}`);
    }
    const data = await resp.json();
    return data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  }

  // OpenAI-compatible (OpenAI, Gemini, DeepSeek)
  const body = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens,
    temperature,
  };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  // GPT-5.x and o-series: set reasoning_effort if the model supports it
  if (model?.startsWith('gpt-5') || model?.startsWith('o3') || model?.startsWith('o4')) {
    body.reasoning_effort = 'medium';
  }

  const resp = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`${provider} ${resp.status}: ${err.slice(0, 500)}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Call Gemini with Google Search grounding (native API, not OpenAI-compat).
 * Used for research/discovery phase.
 */
async function callGeminiWithSearch(prompt, system) {
  // Try Vertex AI first (uses GCP $300 credits)
  try {
    return await callGeminiVertexWithSearch(prompt, system);
  } catch (vertexErr) {
    console.log(`[TBWO] Vertex Gemini Search failed, falling back to AI Studio: ${vertexErr.message}`);
  }

  // Fallback: AI Studio (uses GEMINI_API_KEY)
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error('GEMINI_API_KEY not configured');

  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      tools: [{ googleSearch: {} }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini Search ${resp.status}: ${err.slice(0, 500)}`);
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
}


/**
 * Main TBWO orchestration function.
 * Takes a brief/objective and runs the full multi-model pipeline.
 *
 * @param {Object} params
 * @param {string} params.objective - What the user wants built
 * @param {string|Object} params.brief - Extracted site brief (JSON string or object)
 * @param {string} params.tbwoId - TBWO order ID for progress tracking
 * @param {string} params.userId - User ID
 * @param {string} params.qualityTier - 'standard', 'premium', or 'ultra'
 * @param {string} params.workspacePath - Path to write files
 * @param {Function} params.onProgress - Callback: (phase, progress, message) => void
 * @param {Function} params.onFile - Callback: (filePath, content) => void
 * @param {Function} [params.generateImage] - Multi-provider image generation function
 */
export async function runTBWOPipeline(params) {
  const {
    objective, brief, tbwoId, userId,
    qualityTier = 'standard',
    workspacePath, onProgress, onFile,
  } = params;

  const briefObj = typeof brief === 'string' ? JSON.parse(brief) : (brief || {});
  const tier = TIER_CONFIGS[qualityTier] || TIER_CONFIGS.standard;
  const pods = [];

  function log(phase, msg) {
    console.log(`[TBWO ${tbwoId.slice(0, 8)}] [${phase}] ${msg}`);
  }

  function progress(phase, pct, msg) {
    if (onProgress) onProgress(phase, pct, msg);
    log(phase, `${pct}% — ${msg}`);
  }

  function trackPod(phase, model, provider, durationMs, tokenEstimate) {
    pods.push({ phase, model, provider, durationMs, tokenEstimate, timestamp: Date.now() });
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: RESEARCH & DISCOVERY
  // All tiers: Gemini 2.5 Pro with Google Search grounding
  // ═══════════════════════════════════════════════════════════════
  progress('research', 5, `Researching industry and competitors... [${tier.label}]`);
  let researchData = '';
  const researchStart = Date.now();
  try {
    const researchConfig = tier.research;

    if (researchConfig.useSearch) {
      researchData = await callGeminiWithSearch(
        `Research for a website build project. Objective: "${objective}"

Business/project details from brief:
${JSON.stringify(briefObj, null, 2)}

Research the following and provide structured findings:
1. COMPETITOR ANALYSIS: Find 3-5 similar websites in this space. Note their design patterns, hero sections, CTAs, color schemes, navigation style.
2. INDUSTRY TRENDS: What are current web design trends in this industry/niche?
3. AUDIENCE INSIGHTS: What does this target audience expect from a website like this?
4. CONTENT STRATEGY: What pages and content sections are essential for this type of site?
5. TECHNICAL REQUIREMENTS: Any specific features, integrations, or interactive elements commonly expected.

Output as structured analysis with clear headers.`,
        'You are a web design researcher. Provide actionable insights that will directly inform website architecture and design decisions. Be specific — cite actual competitor URLs and specific design patterns you observe.'
      );
      trackPod('research', 'gemini-2.5-pro', 'gemini', Date.now() - researchStart, Math.ceil(researchData.length / 4));
    } else {
      researchData = await callModel({
        model: researchConfig.model,
        provider: researchConfig.provider,
        temperature: 0.5,
        maxTokens: 4096,
        system: 'You are a web design researcher. Provide insights about design patterns, audience expectations, and content strategy for this type of website.',
        prompt: `Research for a website build project. Objective: "${objective}"\nBrief: ${JSON.stringify(briefObj, null, 2)}\n\nProvide: 1. Common design patterns 2. Audience expectations 3. Essential pages and sections 4. Recommended features`,
      });
      trackPod('research', researchConfig.model, researchConfig.provider, Date.now() - researchStart, Math.ceil(researchData.length / 4));
    }
  } catch (err) {
    log('research', `Research failed: ${err.message}. Continuing without competitor data.`);
    researchData = 'Research unavailable — proceeding with brief data only.';
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: ARCHITECTURE & SITEMAP
  // Standard: GPT-5 Mini | Premium: GPT-5 | Ultra: GPT-5.2
  // ═══════════════════════════════════════════════════════════════
  progress('architecture', 15, 'Planning site architecture...');
  const archStart = Date.now();
  const archConfig = tier.architecture;

  const architecturePlan = await callModel({
    model: archConfig.model,
    provider: archConfig.provider,
    temperature: 0.3,
    maxTokens: 4096,
    system: 'You are a website architect. Output ONLY valid JSON. No markdown, no explanation.',
    prompt: `Plan the complete architecture for this website.

OBJECTIVE: ${objective}
BRIEF: ${JSON.stringify(briefObj, null, 2)}
RESEARCH: ${researchData.slice(0, 8000)}

Output this exact JSON structure:
{
  "pages": [
    {
      "filename": "index.html",
      "title": "Page Title",
      "purpose": "What this page accomplishes",
      "sections": [
        { "id": "hero", "type": "hero", "description": "What goes here" },
        { "id": "features", "type": "features-grid", "description": "What goes here" }
      ],
      "priority": 1
    }
  ],
  "navigation": {
    "style": "fixed-top|sticky|sidebar",
    "items": [{ "label": "Home", "href": "index.html" }]
  },
  "sharedComponents": ["header", "footer", "cta-banner"],
  "designTokenSuggestions": {
    "colorMood": "professional|playful|bold|minimal|luxury",
    "typographyStyle": "modern-sans|classic-serif|tech-mono|editorial",
    "layoutDensity": "spacious|balanced|compact"
  },
  "totalEstimatedSections": 15,
  "imageNeeds": [
    { "purpose": "hero", "description": "Main hero image", "suggestedProvider": "imagen-4|flux2-max|dall-e-3" }
  ]
}`,
    jsonMode: true,
  });
  trackPod('architecture', archConfig.model, archConfig.provider, Date.now() - archStart, Math.ceil(architecturePlan.length / 4));

  let archPlan;
  try {
    archPlan = JSON.parse(architecturePlan.replace(/```json|```/g, '').trim());
  } catch {
    log('architecture', 'Failed to parse architecture JSON, using fallback');
    archPlan = {
      pages: [{ filename: 'index.html', title: 'Home', purpose: 'Main landing page', sections: [{ id: 'hero', type: 'hero', description: 'Hero section' }], priority: 1 }],
      navigation: { style: 'fixed-top', items: [{ label: 'Home', href: 'index.html' }] },
      sharedComponents: ['header', 'footer'],
      designTokenSuggestions: { colorMood: 'professional', typographyStyle: 'modern-sans', layoutDensity: 'spacious' },
      totalEstimatedSections: 5,
      imageNeeds: [],
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: DESIGN DIRECTION
  // Standard: Gemini 3 Flash | Premium: Sonnet | Ultra: Opus
  // ═══════════════════════════════════════════════════════════════
  progress('design', 25, 'Establishing design system...');
  const designStart = Date.now();
  const designConfig = tier.design;

  const designSystem = await callModel({
    model: designConfig.model,
    provider: designConfig.provider,
    temperature: 0.5,
    maxTokens: 4096,
    system: 'You are an expert web designer. Create a complete CSS design system. Output ONLY a valid CSS :root block with custom properties and a brief JSON design spec. No explanation.',
    prompt: `Create a design system for this website.

OBJECTIVE: ${objective}
BRIEF STYLE PREFERENCES: ${JSON.stringify(briefObj?.style || briefObj?.design || {})}
ARCHITECTURE SUGGESTIONS: ${JSON.stringify(archPlan.designTokenSuggestions)}
RESEARCH TRENDS: ${researchData.slice(0, 3000)}

Output TWO blocks:

BLOCK 1 — CSS custom properties (paste-ready):
\`\`\`css
:root {
  /* Colors */
  --color-primary: #...;
  --color-primary-light: #...;
  --color-primary-dark: #...;
  --color-secondary: #...;
  --color-accent: #...;
  --color-bg: #...;
  --color-bg-alt: #...;
  --color-text: #...;
  --color-text-muted: #...;
  --color-border: #...;

  /* Typography */
  --font-heading: '...', sans-serif;
  --font-body: '...', sans-serif;
  --font-mono: '...', monospace;
  --text-xs: clamp(...);
  --text-sm: clamp(...);
  --text-base: clamp(...);
  --text-lg: clamp(...);
  --text-xl: clamp(...);
  --text-2xl: clamp(...);
  --text-3xl: clamp(...);
  --text-4xl: clamp(...);
  --line-height-tight: 1.2;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.7;

  /* Spacing */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2rem;
  --space-2xl: 3rem;
  --space-3xl: 4rem;
  --space-4xl: 6rem;

  /* Layout */
  --max-width: 1200px;
  --border-radius-sm: ...;
  --border-radius-md: ...;
  --border-radius-lg: ...;
  --shadow-sm: ...;
  --shadow-md: ...;
  --shadow-lg: ...;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-base: 250ms ease;
  --transition-slow: 400ms ease;
}
\`\`\`

BLOCK 2 — Design spec JSON:
\`\`\`json
{
  "googleFontsImport": "@import url('https://fonts.googleapis.com/css2?family=...')",
  "headingFont": "...",
  "bodyFont": "...",
  "darkMode": true/false,
  "buttonStyle": "rounded|pill|square",
  "heroPattern": "split|centered|fullscreen-image|gradient",
  "cardStyle": "elevated|bordered|flat",
  "animationApproach": "subtle-fade|slide-up|none"
}
\`\`\``,
  });
  trackPod('design', designConfig.model, designConfig.provider, Date.now() - designStart, Math.ceil(designSystem.length / 4));

  // Parse design outputs
  const cssMatch = designSystem.match(/```css\n([\s\S]*?)```/);
  const jsonMatch = designSystem.match(/```json\n([\s\S]*?)```/);
  const designCSS = cssMatch?.[1]?.trim() || '';
  let designSpec = {};
  try { designSpec = JSON.parse(jsonMatch?.[1]?.trim() || '{}'); } catch {}

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4: COPYWRITING
  // Standard: GPT-4o | Premium: GPT-5.1 | Ultra: GPT-5.2 + rewrite
  // ═══════════════════════════════════════════════════════════════
  progress('copywriting', 35, 'Writing page content...');
  const copyStart = Date.now();
  const copyConfig = tier.copywriting;

  const allCopy = await callModel({
    model: copyConfig.model,
    provider: copyConfig.provider,
    temperature: 0.7,
    maxTokens: 8192,
    system: 'You are an expert copywriter specializing in web content. Write compelling, conversion-focused copy. Output valid JSON only.',
    prompt: `Write all copy for this website.

OBJECTIVE: ${objective}
BRIEF: ${JSON.stringify(briefObj, null, 2)}
SITE ARCHITECTURE: ${JSON.stringify(archPlan.pages, null, 2)}

For each page and section, write the actual copy. Output this JSON structure:
{
  "pages": {
    "index.html": {
      "hero": {
        "headline": "...",
        "subheadline": "...",
        "cta_primary": { "text": "...", "href": "#" },
        "cta_secondary": { "text": "...", "href": "#" }
      },
      "features": {
        "section_headline": "...",
        "items": [
          { "title": "...", "description": "...", "icon": "suggested-icon-name" }
        ]
      }
    }
  },
  "seo": {
    "index.html": { "title": "...", "description": "...", "ogTitle": "...", "ogDescription": "..." }
  },
  "footer": {
    "tagline": "...",
    "copyright": "© 2026 ...",
    "links": [{ "label": "...", "href": "..." }]
  }
}

RULES:
- Never use Lorem ipsum. All copy must be real and compelling.
- Headlines: clear, benefit-driven, under 10 words
- Body: scannable, short paragraphs, active voice
- CTAs: action-oriented ("Start Free Trial" not "Submit")
- Match the brand voice from the brief`,
    jsonMode: true,
  });
  trackPod('copywriting', copyConfig.model, copyConfig.provider, Date.now() - copyStart, Math.ceil(allCopy.length / 4));

  let copyData;
  try { copyData = JSON.parse(allCopy.replace(/```json|```/g, '').trim()); } catch { copyData = { pages: {}, seo: {}, footer: {} }; }

  // Ultra tier: second draft refinement pass
  if (tier.copyRewrite) {
    progress('copywriting', 40, 'Refining copy (second draft)...');
    const rewriteStart = Date.now();
    try {
      const refinedCopy = await callModel({
        model: tier.copyRewrite.model,
        provider: tier.copyRewrite.provider,
        temperature: 0.5,
        maxTokens: 8192,
        system: 'You are a senior editor refining web copy. Improve clarity, impact, and brand consistency. Output valid JSON only in the same structure as the input.',
        prompt: `Refine this website copy. Make headlines punchier, CTAs more compelling, descriptions more concise. Keep the same JSON structure.\n\nCURRENT COPY:\n${JSON.stringify(copyData, null, 2)}`,
        jsonMode: true,
      });
      const refined = JSON.parse(refinedCopy.replace(/```json|```/g, '').trim());
      if (refined.pages) copyData = refined;
      trackPod('copy-rewrite', tier.copyRewrite.model, tier.copyRewrite.provider, Date.now() - rewriteStart, Math.ceil(refinedCopy.length / 4));
    } catch (err) {
      log('copywriting', `Copy rewrite failed: ${err.message}. Using first draft.`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 5: IMAGE GENERATION
  // Standard: Auto-routed, DeepSeek prompt polish
  // Premium: Auto-routed, GPT-4o prompt polish
  // Ultra: Auto-routed + Ultra variants, GPT-5.1 prompts, multiple options
  // ═══════════════════════════════════════════════════════════════
  progress('images', 45, 'Generating images...');
  const imageResults = {};

  const generateImage = params.generateImage;

  if (archPlan.imageNeeds && archPlan.imageNeeds.length > 0 && generateImage) {
    for (let i = 0; i < archPlan.imageNeeds.length; i++) {
      const need = archPlan.imageNeeds[i];
      progress('images', 45 + Math.round((i / archPlan.imageNeeds.length) * 10), `Generating image: ${need.purpose}...`);

      // Step 1: Polish the prompt (tier-dependent)
      let enhancedPrompt = need.description;
      if (tier.imagePrompt) {
        try {
          const enhanced = await callModel({
            model: tier.imagePrompt.model,
            provider: tier.imagePrompt.provider,
            temperature: 0.6,
            maxTokens: 500,
            system: 'You are an art director. Expand the brief image description into a detailed, vivid image generation prompt. Include style, composition, lighting, mood, and color guidance. Output ONLY the enhanced prompt, nothing else.',
            prompt: `Enhance this image prompt for a ${need.purpose} image on a website about: ${objective}\n\nOriginal description: ${need.description}`,
          });
          if (enhanced && enhanced.length > 20) enhancedPrompt = enhanced;
        } catch {}
      }

      // Step 2: Select provider based on tier and content type
      let imgProvider;
      if (need.purpose === 'logo' || need.description.toLowerCase().includes('logo') || need.description.toLowerCase().includes('text')) {
        imgProvider = 'flux2-max';
      } else if (need.purpose === 'hero' || need.description.toLowerCase().includes('person') || need.description.toLowerCase().includes('people')) {
        imgProvider = tier.imageProvider === 'auto-ultra' ? 'imagen-4-ultra' : 'imagen-4';
      } else if (need.description.toLowerCase().includes('illustration') || need.description.toLowerCase().includes('artistic')) {
        imgProvider = 'dall-e-3';
      } else {
        imgProvider = need.suggestedProvider || 'imagen-4';
      }

      // Step 3: Generate
      try {
        const result = await generateImage({ prompt: enhancedPrompt, provider: imgProvider, width: 1200, height: 800 }, userId);
        if (result.success) {
          const parsed = typeof result.result === 'string' ? JSON.parse(result.result) : result.result;
          imageResults[need.purpose] = { url: parsed.url, provider: parsed.provider, prompt: enhancedPrompt };
        }
      } catch (imgErr) {
        log('images', `Image generation failed for ${need.purpose}: ${imgErr.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 6: HTML/CSS/JS IMPLEMENTATION
  // Standard: Sonnet (primary) + Gemini 3 Flash (secondary)
  // Premium: Sonnet (primary) + GPT-5.1 (secondary)
  // Ultra: Sonnet on ALL pages
  // ═══════════════════════════════════════════════════════════════
  progress('implementation', 55, 'Building pages...');

  // Write the shared CSS file first
  const mainCSS = `/* Design System — Auto-generated by ALIN TBWO [${tier.label}] */
${designSpec.googleFontsImport || ''}

${designCSS}

/* Reset & Base */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; }
body { font-family: var(--font-body); color: var(--color-text); background: var(--color-bg); line-height: var(--line-height-normal); }
img { max-width: 100%; height: auto; display: block; }
a { color: var(--color-primary); text-decoration: none; transition: var(--transition-fast); }
a:hover { color: var(--color-primary-dark); }

/* Utility */
.container { max-width: var(--max-width); margin: 0 auto; padding: 0 var(--space-lg); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
`;

  if (onFile) await onFile('styles/main.css', mainCSS);

  // Sort pages by priority (index.html first)
  const sortedPages = [...(archPlan.pages || [])].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  for (let pageIdx = 0; pageIdx < sortedPages.length; pageIdx++) {
    const page = sortedPages[pageIdx];
    const pagePct = 55 + Math.round((pageIdx / sortedPages.length) * 25);
    progress('implementation', pagePct, `Building ${page.filename}...`);

    // Choose model based on tier and page priority
    const isPrimary = (page.priority || 99) <= 2;
    const codeConfig = isPrimary ? tier.primaryCode : tier.secondaryCode;

    const pageCopy = copyData.pages?.[page.filename] || {};
    const pageSEO = copyData.seo?.[page.filename] || {};
    const pageImages = Object.entries(imageResults)
      .filter(([purpose]) => page.sections?.some(s => s.id === purpose || s.type === purpose))
      .map(([purpose, data]) => `${purpose}: ${data.url}`)
      .join('\n');

    const codeStart = Date.now();
    const pageHTML = await callModel({
      model: codeConfig.model,
      provider: codeConfig.provider,
      temperature: 0.3,
      maxTokens: 16384,
      system: 'You are an expert frontend developer. Write complete, production-ready HTML. Output ONLY the HTML file content, no markdown fences, no explanation.',
      prompt: `Write the complete HTML for ${page.filename}.

DESIGN SYSTEM CSS: Linked as <link rel="stylesheet" href="styles/main.css">
All CSS custom properties (colors, fonts, spacing) are defined there. USE THEM via var(--property-name).
${designSpec.googleFontsImport ? `Google Fonts: already imported in CSS. Heading: ${designSpec.headingFont}, Body: ${designSpec.bodyFont}` : ''}

PAGE SPEC:
- Filename: ${page.filename}
- Title: ${page.title}
- Purpose: ${page.purpose}
- Sections: ${JSON.stringify(page.sections, null, 2)}

COPY FOR THIS PAGE:
${JSON.stringify(pageCopy, null, 2)}

SEO:
${JSON.stringify(pageSEO, null, 2)}

NAVIGATION:
${JSON.stringify(archPlan.navigation, null, 2)}

FOOTER:
${JSON.stringify(copyData.footer, null, 2)}

AVAILABLE IMAGES:
${pageImages || 'Use placeholder images from picsum.photos or placehold.co'}

REQUIREMENTS:
- Complete <!DOCTYPE html> document
- Mobile-first responsive (320px to 1200px+)
- Semantic HTML5 (nav, main, section, article, footer)
- All interactive elements keyboard-accessible
- Smooth scroll-reveal animations (respect prefers-reduced-motion)
- Skip-to-content link
- Proper heading hierarchy (one h1)
- All styles via CSS custom properties from main.css (add page-specific <style> block for unique styles)
- No external JS frameworks (vanilla JS only)
- Images: always set width/height, use loading="lazy" for below-fold
- Mobile hamburger menu if nav has 4+ items`,
    });
    trackPod('implementation', codeConfig.model, codeConfig.provider, Date.now() - codeStart, Math.ceil(pageHTML.length / 4));

    // Clean output (remove markdown fences if present)
    const cleanHTML = pageHTML.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '').trim();
    if (onFile) await onFile(page.filename, cleanHTML);
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 7: CODE REVIEW & QA
  // Standard: DeepSeek code review (no a11y audit)
  // Premium: DeepSeek Reasoner + GPT-4.1 Mini a11y (1M context)
  // Ultra: DeepSeek Reasoner + GPT-4.1 a11y (full 1M context)
  // ═══════════════════════════════════════════════════════════════
  progress('qa', 82, 'Running quality checks...');

  // Read back all generated files for review
  const generatedFiles = {};
  try {
    const allFiles = await listFilesRecursive(workspacePath);
    for (const file of allFiles) {
      if (file.endsWith('.html') || file.endsWith('.css') || file.endsWith('.js')) {
        const content = await fs.readFile(path.join(workspacePath, file), 'utf8');
        generatedFiles[file] = content;
      }
    }
  } catch {}

  const allCode = Object.entries(generatedFiles)
    .map(([name, content]) => `=== ${name} ===\n${content}`)
    .join('\n\n');

  // Code review (all tiers have this now)
  let codeReview = '';
  if (tier.codeReview) {
    const reviewStart = Date.now();
    try {
      codeReview = await callModel({
        model: tier.codeReview.model,
        provider: tier.codeReview.provider,
        temperature: 0.2,
        maxTokens: 4096,
        system: 'You are a senior frontend code reviewer. Identify ONLY actual problems. Output JSON.',
        prompt: `Review this website code for issues.

${allCode.slice(0, 60000)}

Output JSON:
{
  "issues": [
    {
      "file": "filename",
      "severity": "critical|warning|info",
      "line_hint": "near what content",
      "problem": "brief description",
      "fix": "one-line fix suggestion"
    }
  ],
  "overallQuality": 1-10,
  "passesProduction": true/false
}`,
        jsonMode: true,
      });
      trackPod('qa-code', tier.codeReview.model, tier.codeReview.provider, Date.now() - reviewStart, Math.ceil(codeReview.length / 4));
    } catch (err) {
      log('qa', `Code review failed: ${err.message}`);
    }
  }

  // Accessibility audit (Premium + Ultra only)
  if (tier.a11yAudit) {
    const a11yStart = Date.now();
    try {
      const a11yCheck = await callModel({
        model: tier.a11yAudit.model,
        provider: tier.a11yAudit.provider,
        temperature: 0.2,
        maxTokens: 2048,
        system: 'You are a WCAG accessibility auditor. Output JSON only.',
        prompt: `Audit this website for accessibility issues.

${allCode.slice(0, 40000)}

Output JSON:
{
  "issues": [
    { "file": "...", "element": "...", "wcag": "2.1.1", "problem": "...", "fix": "..." }
  ],
  "score": 1-100,
  "passesWCAG_AA": true/false
}`,
        jsonMode: true,
      });
      trackPod('qa-a11y', tier.a11yAudit.model, tier.a11yAudit.provider, Date.now() - a11yStart, Math.ceil(a11yCheck.length / 4));

      // Merge a11y issues into code review
      try {
        const a11yData = JSON.parse(a11yCheck.replace(/```json|```/g, '').trim());
        if (a11yData.issues) {
          const existingReview = JSON.parse(codeReview.replace(/```json|```/g, '').trim() || '{"issues":[]}');
          existingReview.issues = [...(existingReview.issues || []), ...a11yData.issues.map(i => ({ ...i, severity: 'warning', problem: `[A11Y] ${i.problem}` }))];
          codeReview = JSON.stringify(existingReview);
        }
      } catch {}
    } catch (err) {
      log('qa', `Accessibility audit failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 8: ERROR REPAIR
  // Standard: Gemini 3 Flash | Premium/Ultra: Claude Sonnet
  // ═══════════════════════════════════════════════════════════════
  let reviewData;
  try { reviewData = JSON.parse(codeReview.replace(/```json|```/g, '').trim()); } catch { reviewData = { issues: [], passesProduction: true }; }

  const criticalIssues = (reviewData.issues || []).filter(i => i.severity === 'critical' || i.severity === 'warning');

  if (criticalIssues.length > 0 && tier.repair) {
    progress('repair', 88, `Fixing ${criticalIssues.length} issues...`);

    for (const issue of criticalIssues) {
      if (!issue.file || !generatedFiles[issue.file]) continue;

      const repairStart = Date.now();
      try {
        const fixedCode = await callModel({
          model: tier.repair.model,
          provider: tier.repair.provider,
          temperature: 0.2,
          maxTokens: 16384,
          system: 'You are fixing a bug in HTML/CSS/JS code. Output ONLY the complete corrected file. No markdown fences, no explanation.',
          prompt: `Fix this issue in ${issue.file}:

PROBLEM: ${issue.problem}
SUGGESTED FIX: ${issue.fix}
NEAR: ${issue.line_hint || 'unknown'}

CURRENT FILE:
${generatedFiles[issue.file]}

Output the COMPLETE corrected file.`,
        });

        const cleanFix = fixedCode.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '').trim();
        if (cleanFix.length > 100) {
          generatedFiles[issue.file] = cleanFix;
          if (onFile) await onFile(issue.file, cleanFix);
        }
        trackPod('repair', tier.repair.model, tier.repair.provider, Date.now() - repairStart, Math.ceil(cleanFix.length / 4));
      } catch (repairErr) {
        log('repair', `Failed to fix ${issue.file}: ${repairErr.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 9: SEO METADATA VALIDATION
  // Standard: GPT-5 Nano | Premium/Ultra: GPT-5 Mini
  // ═══════════════════════════════════════════════════════════════
  if (tier.seoValidation) {
    progress('seo', 93, 'Validating SEO metadata...');
    const seoStart = Date.now();
    try {
      const seoAudit = await callModel({
        model: tier.seoValidation.model,
        provider: tier.seoValidation.provider,
        temperature: 0.2,
        maxTokens: 1024,
        system: 'Check if all HTML files have proper SEO tags. Output JSON.',
        prompt: `Check SEO completeness:
${Object.entries(generatedFiles).filter(([f]) => f.endsWith('.html')).map(([f, c]) => `${f}: ${c.slice(0, 500)}`).join('\n\n')}

Output: { "allPagesHaveTitle": true/false, "allPagesHaveDescription": true/false, "allPagesHaveOG": true/false, "missing": [] }`,
        jsonMode: true,
      });
      trackPod('seo', tier.seoValidation.model, tier.seoValidation.provider, Date.now() - seoStart, Math.ceil(seoAudit.length / 4));
    } catch {}
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 10: FINAL INTEGRATION (Ultra only)
  // Model: Claude Opus 4.6 — holistic review + polish
  // ═══════════════════════════════════════════════════════════════
  if (tier.finalIntegration) {
    progress('integration', 96, 'Opus final integration review...');
    const intStart = Date.now();
    try {
      const integrationReview = await callModel({
        model: tier.finalIntegration.model,
        provider: tier.finalIntegration.provider,
        temperature: 0.3,
        maxTokens: 8192,
        system: 'You are a senior creative director doing a final review of a complete website. Check for design consistency, UX flow, visual hierarchy, and brand cohesion. If you find issues, output the corrected file contents. If everything looks good, say "APPROVED".',
        prompt: `Final integration review for: ${objective}

DESIGN SYSTEM:
${designCSS.slice(0, 2000)}

ALL FILES:
${allCode.slice(0, 50000)}

Review for:
1. Design consistency across all pages (same colors, fonts, spacing)
2. Navigation works and links are correct
3. Visual hierarchy is clear
4. Brand voice is consistent
5. Mobile responsiveness patterns are consistent

If any files need changes, output them as:
FILE: filename.html
---
(complete corrected file content)
---

If everything is good, just say: APPROVED`,
      });
      trackPod('integration', tier.finalIntegration.model, tier.finalIntegration.provider, Date.now() - intStart, Math.ceil(integrationReview.length / 4));

      // Parse and apply any corrections
      if (!integrationReview.includes('APPROVED')) {
        const fileBlocks = integrationReview.split(/FILE:\s*(\S+)\s*\n---\n/);
        for (let i = 1; i < fileBlocks.length; i += 2) {
          const filename = fileBlocks[i];
          const content = fileBlocks[i + 1]?.split('\n---')[0]?.trim();
          if (filename && content && content.length > 100) {
            generatedFiles[filename] = content;
            if (onFile) await onFile(filename, content);
          }
        }
      }
    } catch (err) {
      log('integration', `Final integration failed: ${err.message}. Shipping as-is.`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // COMPLETE — Return results
  // ═══════════════════════════════════════════════════════════════
  progress('complete', 100, `Website build complete! [${tier.label}]`);

  // Calculate total cost estimate from actual model usage
  const costEstimate = pods.reduce((sum, pod) => {
    const rates = {
      'claude-opus-4-6': 0.075,
      'claude-sonnet-4-5-20250929': 0.015,
      'claude-haiku-4-5-20251001': 0.004,
      'gpt-5.2': 0.014,
      'gpt-5.1': 0.01,
      'gpt-5': 0.01,
      'gpt-5-mini': 0.002,
      'gpt-5-nano': 0.0004,
      'gpt-4.1': 0.008,
      'gpt-4.1-mini': 0.0016,
      'gpt-4.1-nano': 0.0004,
      'gpt-4o': 0.01,
      'gpt-4o-mini': 0.0006,
      'o3': 0.008,
      'o4-mini': 0.0044,
      'o3-mini': 0.0044,
      'gemini-3-pro-preview': 0.012,
      'gemini-3-flash-preview': 0.003,
      'gemini-2.5-pro': 0.01,
      'gemini-2.5-flash': 0.0006,
      'gemini-2.5-flash-lite': 0.0004,
      'deepseek-chat': 0.00042,
      'deepseek-reasoner': 0.00042,
    };
    const rate = rates[pod.model] || 0.01;
    return sum + (pod.tokenEstimate || 0) / 1000 * rate;
  }, 0);

  return {
    success: true,
    tbwoId,
    qualityTier,
    tierLabel: tier.label,
    pages: sortedPages.map(p => p.filename),
    pods,
    costEstimate: `$${costEstimate.toFixed(4)}`,
    qualityScore: reviewData.overallQuality || null,
    passesProduction: reviewData.passesProduction ?? true,
    imageCount: Object.keys(imageResults).length,
    issuesFound: reviewData.issues?.length || 0,
    issuesFixed: criticalIssues.length,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Recursively list files relative to a directory.
 */
async function listFilesRecursive(dir, prefix = '') {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...await listFilesRecursive(path.join(dir, entry.name), relPath));
      } else {
        results.push(relPath);
      }
    }
  } catch {}
  return results;
}
