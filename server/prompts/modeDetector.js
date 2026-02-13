/**
 * ALIN Mode Detector
 *
 * Conservative regex-based mode detection with confidence scoring.
 * Only runs when currentMode is 'chat'/'regular'.
 * Never auto-switches — returns a hint the frontend can display.
 */

// Strong signals — high confidence when matched
const MODE_SIGNALS = {
  website: {
    strong: [
      /\b(build|create|make|design)\s+(me\s+)?(a\s+)?(website|web\s*site|landing\s*page|web\s*page|homepage)/i,
      /\bwebsite\s+(for|about|with)\b/i,
      /\b(portfolio|storefront|blog)\s+(site|website|page)\b/i,
      /\bmulti[- ]?page\s+(site|website)\b/i,
    ],
    moderate: [
      /\blanding\s*page\b/i,
      /\bhero\s+(section|banner|image)\b/i,
      /\bresponsive\s+design\b/i,
      /\bdeploy\s+(to|on)\s+(cloudflare|vercel|netlify)/i,
      /\b(html|css)\s+and\s+(css|js|javascript)\b/i,
    ],
    context: [
      /\bseo\b/i,
      /\bnavigation\b/i,
      /\bfooter\b/i,
      /\babove\s+the\s+fold\b/i,
    ],
  },
  coding: {
    strong: [
      /\b(fix|debug|refactor|implement|code)\s+(the|this|a|my)\b/i,
      /\b(add|create|write)\s+(a\s+)?(function|class|component|module|api|endpoint|test)\b/i,
      /\bnpm\s+(test|run|install|build)\b/i,
      /\btsc\s+--noEmit\b/i,
      /\bgit\s+(commit|push|pull|merge|rebase|status|diff)\b/i,
    ],
    moderate: [
      /\b(typescript|javascript|python|react|vue|angular|node)\b/i,
      /\b(bug|error|exception|stack\s*trace|crash)\b/i,
      /\b(import|export|async|await|const|let|function)\b/i,
      /\bpull\s+request\b/i,
      /\bcode\s+review\b/i,
    ],
    context: [
      /\bpackage\.json\b/i,
      /\btsconfig\b/i,
      /\.tsx?\b/i,
      /\.py\b/i,
    ],
  },
  research: {
    strong: [
      /\b(research|investigate|find\s+out|look\s+into)\s+(about|how|what|why|whether)\b/i,
      /\bcompare\s+(and\s+contrast\s+)?(between\s+)?[\w]+\s+(and|vs|versus)\s+/i,
      /\bwhat\s+(are|is)\s+the\s+(latest|current|recent)\b/i,
    ],
    moderate: [
      /\bpros\s+and\s+cons\b/i,
      /\bsources?\b.*\b(cite|citation|reference)\b/i,
      /\bin[- ]depth\s+(analysis|look|review)\b/i,
      /\bstate\s+of\s+the\s+art\b/i,
    ],
    context: [
      /\baccording\s+to\b/i,
      /\bpeer[- ]reviewed\b/i,
      /\bstatistics\b/i,
    ],
  },
  image: {
    strong: [
      /\b(generate|create|make|draw|design)\s+(me\s+)?(a\s+)?(image|picture|photo|illustration|icon|logo|graphic|banner|avatar)/i,
      /\bdall[- ]?e\b/i,
      /\bimage\s+of\b/i,
    ],
    moderate: [
      /\b(visual|artwork|art|render)\b/i,
      /\b(1024x1024|1792x1024|1024x1792)\b/i,
      /\b(photorealistic|watercolor|illustration\s+style|flat\s+design)\b/i,
    ],
    context: [
      /\bcolor\s+palette\b/i,
      /\bcomposition\b/i,
    ],
  },
};

// Weights for signal types
const WEIGHTS = { strong: 0.35, moderate: 0.15, context: 0.05 };
const SWITCH_THRESHOLD = 0.65;

/**
 * Detect which mode a message might be best served by.
 *
 * @param {string} message - The user's message text
 * @param {string} currentMode - Current active mode ('chat', 'regular', etc.)
 * @param {string[]} recentMessages - Recent user message texts for context
 * @param {string} [urlMode] - Mode from URL parameter (always wins)
 * @returns {{ mode: string, confidence: number, reason: string, shouldSwitch: boolean }}
 */
export function detectMode(message, currentMode = 'chat', recentMessages = [], urlMode = undefined) {
  // URL mode always wins — never override explicit user choice
  if (urlMode) {
    return { mode: urlMode, confidence: 1.0, reason: 'URL parameter', shouldSwitch: false };
  }

  // Only run detection when in chat/regular mode
  if (currentMode !== 'chat' && currentMode !== 'regular') {
    return { mode: currentMode, confidence: 1.0, reason: 'Already in specific mode', shouldSwitch: false };
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { mode: 'chat', confidence: 1.0, reason: 'Empty message', shouldSwitch: false };
  }

  const scores = {};

  for (const [mode, signals] of Object.entries(MODE_SIGNALS)) {
    let score = 0;
    const reasons = [];

    for (const [level, patterns] of Object.entries(signals)) {
      const weight = WEIGHTS[level] || 0;
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          score += weight;
          if (level === 'strong') reasons.push(pattern.source.slice(0, 40));
        }
      }
    }

    // Bonus: check recent messages for consistent context
    if (recentMessages.length > 0) {
      let contextHits = 0;
      for (const recent of recentMessages.slice(-3)) {
        for (const patterns of Object.values(signals)) {
          for (const pattern of patterns) {
            if (pattern.test(recent)) contextHits++;
          }
        }
      }
      if (contextHits >= 3) score += 0.1; // Consistent context bonus
    }

    scores[mode] = { score: Math.min(score, 1.0), reasons };
  }

  // Find highest scoring mode
  let bestMode = 'chat';
  let bestScore = 0;
  let bestReasons = [];

  for (const [mode, { score, reasons }] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestMode = mode;
      bestReasons = reasons;
    }
  }

  const shouldSwitch = bestScore >= SWITCH_THRESHOLD;
  const reason = bestReasons.length > 0
    ? `Detected ${bestMode} intent: ${bestReasons.slice(0, 2).join(', ')}`
    : `Low confidence for mode switch`;

  return {
    mode: bestMode,
    confidence: Math.round(bestScore * 100) / 100,
    reason,
    shouldSwitch,
  };
}
