/**
 * Consequence Engine — 5-Layer Neural Architecture Routes
 *
 * Layer 1: Prediction Cortex      — auto-detect & store predictions
 * Layer 2: Outcome Cortex         — verify predictions against reality
 * Layer 3: Emotional Weightmap    — domain pain/satisfaction tracking
 * Layer 3b: Domain History        — temporal emotional tracking
 * Layer 4: Pattern Cortex         — cross-outcome intelligence & calibration
 * Layer 4b: Calibration Snapshots — per-bucket confidence accuracy curves
 * Layer 5: Behavioral Genome      — adaptive rules that evolve (genes)
 * Layer 5b: Gene Audit Log        — full mutation tracking history
 *
 * Silent on public (never surfaces internal state to users).
 * Transparent on private (full dashboards, gene management, intelligence reports).
 *
 * Config via ctx.consequenceConfig:
 *   isPrivate:      boolean — determines transparency level
 *   bootstrapUntil: number  — Unix timestamp, observation-only cutoff for public
 *   domains:        string[] — valid domains for this product
 */

import { randomUUID } from 'crypto';

export function registerConsequenceEngineRoutes(ctx) {
  const { app, stmts, requireAuth } = ctx;

  // ── Helpers ──

  function getConfig() {
    return ctx.consequenceConfig || {
      isPrivate: false,
      bootstrapUntil: Date.now() + 30 * 24 * 60 * 60 * 1000,
      domains: ['general'],
    };
  }

  function isBootstrapActive() {
    const config = getConfig();
    return !config.isPrivate && config.bootstrapUntil > Date.now();
  }

  function isValidDomain(domain) {
    const config = getConfig();
    return config.domains.includes(domain) || domain === 'general';
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  // Domain keyword classifier
  const DOMAIN_KEYWORDS = {
    // Public domains (craft-focused)
    model_routing: ['model', 'claude', 'gpt', 'haiku', 'sonnet', 'opus', 'gemini', 'deepseek', 'routing', 'provider', 'fallback'],
    tool_reliability: ['tool', 'file_write', 'file_read', 'scan', 'execute', 'search', 'edit_file', 'run_command', 'code_search', 'web_fetch'],
    time_estimation: ['minutes', 'hours', 'time', 'budget', 'sprint', 'estimate', 'duration', 'deadline', 'schedule', 'fast', 'slow', 'quickly'],
    response_quality: ['response', 'answer', 'output', 'result', 'quality', 'accurate', 'helpful', 'correct', 'wrong', 'mistake'],
    error_avoidance: ['error', 'fail', 'bug', 'crash', 'issue', 'exception', 'broken', 'fix', 'debug', 'retry', 'timeout'],
    // Private domains (product-focused)
    market_sensing: ['users', 'market', 'demand', 'adoption', 'feature', 'customer', 'engagement', 'retention', 'churn', 'growth'],
    first_slice: ['ship', 'mvp', 'subset', 'priority', 'launch', 'release', 'deploy', 'iterate', 'prototype', 'beta'],
    execution_strategy: ['build', 'architecture', 'approach', 'strategy', 'design', 'implement', 'refactor', 'plan', 'tradeoff'],
    competitive_positioning: ['differentiate', 'compete', 'unique', 'advantage', 'moat', 'rival', 'alternative', 'benchmark'],
    user_friction: ['confuse', 'friction', 'drop-off', 'onboarding', 'UX', 'usability', 'intuitive', 'frustrat', 'abandon', 'difficult'],
  };

  function classifyDomain(text, validDomains) {
    if (!text) return validDomains[0] || 'general';
    const lower = text.toLowerCase();
    const scores = {};
    for (const domain of validDomains) {
      const keywords = DOMAIN_KEYWORDS[domain] || [];
      scores[domain] = keywords.reduce((score, kw) => {
        const regex = new RegExp(kw, 'gi');
        const matches = (lower.match(regex) || []).length;
        return score + matches;
      }, 0);
    }
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return (best && best[1] > 0) ? best[0] : validDomains[0] || 'general';
  }

  // Prediction extraction patterns
  const PREDICTION_PATTERNS = [
    { regex: /(?:this (?:will|should|would|is going to))\s+(.{20,200}?)(?:\.|,|$)/gi, type: 'implicit', conf: 0.5 },
    { regex: /(?:I (?:predict|expect|anticipate|believe|think) (?:that )?)\s*(.{20,200}?)(?:\.|,|$)/gi, type: 'explicit', conf: 0.7 },
    { regex: /(?:the (?:result|outcome|output|effect) (?:will|should) (?:be |likely )?)\s*(.{20,200}?)(?:\.|,|$)/gi, type: 'outcome', conf: 0.6 },
    { regex: /(?:this approach (?:will|should|would))\s+(.{20,200}?)(?:\.|,|$)/gi, type: 'approach', conf: 0.55 },
    { regex: /(?:(?:likely|probably|almost certainly|I'm confident) )\s*(.{20,200}?)(?:\.|,|$)/gi, type: 'hedged', conf: 0.4 },
    { regex: /(?:the (?:best|optimal|right|correct) (?:approach|solution|answer|way) (?:is|would be) )\s*(.{20,200}?)(?:\.|,|$)/gi, type: 'prescriptive', conf: 0.65 },
    { regex: /(?:this (?:should|will) (?:take|require) (?:about |approximately |around )?)\s*(.{10,100}?)(?:\.|,|$)/gi, type: 'time_estimate', conf: 0.45 },
    { regex: /(?:the (?:error|issue|bug|problem) is (?:likely |probably )?(?:caused by |due to |because of )?)\s*(.{15,200}?)(?:\.|,|$)/gi, type: 'diagnosis', conf: 0.6 },
  ];

  function extractPredictions(text) {
    if (!text || text.length < 50) return [];
    const predictions = [];
    const seen = new Set();
    for (const pattern of PREDICTION_PATTERNS) {
      let match;
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      while ((match = regex.exec(text)) !== null) {
        const predText = match[1]?.trim();
        if (!predText || predText.length < 15 || seen.has(predText.toLowerCase())) continue;
        seen.add(predText.toLowerCase());
        predictions.push({
          text: predText.slice(0, 300),
          type: pattern.type,
          confidence: pattern.conf,
        });
      }
    }
    return predictions.slice(0, 8); // Cap at 8 predictions per message
  }

  // Compute exponential moving average for domain state updates
  function computeEMA(existing, newValue, alpha = 0.2) {
    if (existing === null || existing === undefined) return newValue;
    return alpha * newValue + (1 - alpha) * existing;
  }

  // Compute trend from recent history
  function computeTrend(recentValues) {
    if (!recentValues || recentValues.length < 3) return 'stable';
    const recent = recentValues.slice(-5);
    const firstHalf = recent.slice(0, Math.ceil(recent.length / 2));
    const secondHalf = recent.slice(Math.ceil(recent.length / 2));
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const delta = avgSecond - avgFirst;
    if (delta > 0.1) return 'improving';
    if (delta < -0.1) return 'declining';
    return 'stable';
  }

  // Compute volatility from recent values
  function computeVolatility(values) {
    if (!values || values.length < 2) return 0.5;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return clamp(Math.sqrt(variance), 0, 1);
  }

  // Extract common pattern from a set of wrong predictions
  function extractPatternSignature(wrongPredictions) {
    if (!wrongPredictions || wrongPredictions.length === 0) return '';
    const words = {};
    for (const p of wrongPredictions) {
      const tokens = p.prediction_text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const t of tokens) {
        words[t] = (words[t] || 0) + 1;
      }
    }
    const common = Object.entries(words)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
    return common.join(', ') || 'repeated_failures';
  }

  // Generate gene text from wrong predictions
  function generateGeneText(domain, wrongPredictions) {
    const signature = extractPatternSignature(wrongPredictions);
    const recentTexts = wrongPredictions.slice(0, 3).map(p => `"${p.prediction_text.slice(0, 60)}"`).join('; ');
    return `In ${domain}: exercise caution when predicting about ${signature}. Recent wrong predictions: ${recentTexts}`;
  }

  // Check if a gene would reduce capability (regression guard)
  function isCapabilityReducing(geneText) {
    const avoidancePatterns = /\b(avoid|don't|never|stop|skip|refuse|disable|remove|block|prevent|prohibit)\b/i;
    return avoidancePatterns.test(geneText);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CONFIGURATION ENDPOINT
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/consequence/config', requireAuth, (req, res) => {
    const config = getConfig();
    res.json({
      config: {
        isPrivate: config.isPrivate,
        bootstrapActive: isBootstrapActive(),
        bootstrapUntil: config.bootstrapUntil,
        domains: config.domains,
        predictionPatternCount: PREDICTION_PATTERNS.length,
        domainKeywordCoverage: Object.fromEntries(
          config.domains.map(d => [d, (DOMAIN_KEYWORDS[d] || []).length])
        ),
      },
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 1: PREDICTION CORTEX
  // ══════════════════════════════════════════════════════════════════════════

  // Record a new prediction
  app.post('/api/consequence/predictions', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const {
        conversationId, messageId, predictionText, predictionType,
        domain, confidence, contextSummary, sourceModel, extractionMethod,
      } = req.body;

      if (!predictionText) return res.status(400).json({ error: 'predictionText required' });

      const config = getConfig();
      const resolvedDomain = domain && isValidDomain(domain) ? domain
        : classifyDomain(predictionText, config.domains);

      // Check for duplicates (same message + text)
      if (messageId) {
        const existing = stmts.findDuplicatePrediction.get(userId, messageId, predictionText);
        if (existing) return res.json({ prediction: existing, deduplicated: true });
      }

      const id = randomUUID();
      const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 day TTL
      const now = Date.now();

      stmts.insertPrediction.run(
        id, conversationId || null, messageId || null,
        predictionText.slice(0, 500), predictionType || 'implicit',
        resolvedDomain, clamp(confidence || 0.5, 0, 1),
        (contextSummary || '').slice(0, 500), sourceModel || '',
        extractionMethod || 'manual', 'pending', expiresAt, now, userId
      );

      res.json({ prediction: { id, domain: resolvedDomain, status: 'pending' } });
    } catch (e) {
      console.error('[ConsequenceEngine] Insert prediction error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Batch-record predictions (from server-side extraction)
  app.post('/api/consequence/predictions/batch', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const { predictions, conversationId, messageId, sourceModel } = req.body;
      if (!Array.isArray(predictions) || predictions.length === 0) {
        return res.status(400).json({ error: 'predictions array required' });
      }

      const config = getConfig();
      const results = [];
      const now = Date.now();
      const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

      for (const pred of predictions.slice(0, 10)) {
        // Skip duplicates
        if (messageId) {
          const existing = stmts.findDuplicatePrediction.get(userId, messageId, pred.text);
          if (existing) { results.push({ id: existing.id, deduplicated: true }); continue; }
        }

        const id = randomUUID();
        const domain = pred.domain && isValidDomain(pred.domain)
          ? pred.domain
          : classifyDomain(pred.text, config.domains);

        stmts.insertPrediction.run(
          id, conversationId || null, messageId || null,
          (pred.text || '').slice(0, 500), pred.type || 'implicit',
          domain, clamp(pred.confidence || 0.5, 0, 1),
          '', sourceModel || '', 'regex', 'pending', expiresAt, now, userId
        );
        results.push({ id, domain, type: pred.type });
      }

      res.json({ recorded: results.length, predictions: results });
    } catch (e) {
      console.error('[ConsequenceEngine] Batch predictions error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // List predictions (with filters)
  app.get('/api/consequence/predictions', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const { status, domain, conversationId, type, limit } = req.query;
      const lim = Math.min(parseInt(limit) || 50, 200);

      let rows;
      if (conversationId) {
        rows = stmts.listPredictionsByConversation.all(userId, conversationId, lim);
      } else if (status && domain) {
        rows = stmts.listPredictionsByStatus.all(userId, status, domain, lim);
      } else if (domain) {
        rows = stmts.listPredictionsByDomain.all(userId, domain, lim);
      } else if (status) {
        rows = stmts.listPendingPredictions.all(userId, status, lim);
      } else if (type) {
        rows = stmts.listPredictionsByType.all(userId, type, lim);
      } else {
        rows = stmts.listPredictions.all(userId, lim);
      }

      res.json({ predictions: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Extract predictions from text (utility endpoint)
  app.post('/api/consequence/predictions/extract', requireAuth, (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const config = getConfig();
    const predictions = extractPredictions(text);
    const classified = predictions.map(p => ({
      ...p,
      domain: classifyDomain(p.text, config.domains),
    }));
    res.json({ predictions: classified, count: classified.length });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 2: OUTCOME CORTEX — resolve predictions + create outcomes
  // ══════════════════════════════════════════════════════════════════════════

  // Resolve a prediction with an outcome
  app.post('/api/consequence/predictions/:id/resolve', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const predictionId = req.params.id;
      const {
        result, triggerType, triggerSource, triggerData,
        lessonLearned, correctiveAction, severity,
      } = req.body;

      if (!result || !['correct', 'wrong', 'partial'].includes(result)) {
        return res.status(400).json({ error: 'result must be correct, wrong, or partial' });
      }
      if (!triggerType) return res.status(400).json({ error: 'triggerType required' });

      const prediction = stmts.getPrediction.get(predictionId, userId);
      if (!prediction) return res.status(404).json({ error: 'Prediction not found' });
      if (prediction.status !== 'pending') {
        return res.status(409).json({ error: `Prediction already resolved: ${prediction.status}` });
      }

      const now = Date.now();
      const domain = prediction.domain;
      const config = getConfig();

      // 1. Create outcome record
      const outcomeId = randomUUID();
      const painDelta = result === 'wrong' ? 0.2 : result === 'partial' ? 0.05 : 0;
      const satDelta = result === 'correct' ? 0.15 : result === 'partial' ? 0.05 : 0;
      const confDelta = result === 'correct' ? 0.05 : result === 'wrong' ? -0.1 : 0;

      // Compute cascade effects (what other domains might be affected)
      const cascadeEffects = [];
      if (result === 'wrong' && domain !== 'general') {
        // Wrong prediction in one domain may signal issues in related domains
        const relatedDomains = {
          model_routing: ['tool_reliability', 'response_quality'],
          tool_reliability: ['error_avoidance'],
          time_estimation: ['execution_strategy'],
          response_quality: ['error_avoidance'],
          execution_strategy: ['first_slice', 'time_estimation'],
          market_sensing: ['competitive_positioning', 'user_friction'],
          first_slice: ['execution_strategy'],
        };
        const related = relatedDomains[domain] || [];
        for (const rd of related) {
          if (config.domains.includes(rd)) {
            cascadeEffects.push({ domain: rd, impact: 'caution_increase', delta: 0.03 });
          }
        }
      }

      stmts.insertOutcomeResult.run(
        outcomeId, predictionId, triggerType,
        (triggerSource || '').slice(0, 200),
        JSON.stringify(triggerData || {}),
        result, confDelta, painDelta, satDelta,
        (lessonLearned || '').slice(0, 500),
        (correctiveAction || '').slice(0, 500),
        domain, severity || 'normal',
        JSON.stringify(cascadeEffects),
        now, userId
      );

      // 2. Resolve the prediction
      const statusMap = { correct: 'verified_correct', wrong: 'verified_wrong', partial: 'verified_partial' };
      stmts.resolvePrediction.run(statusMap[result], outcomeId, now, predictionId, userId);

      // 3. Recalculate domain state (exponential moving average)
      const domainStats = stmts.countPredictionsByDomain.all('verified_correct', 'verified_wrong', 'verified_partial', userId);
      const domainRow = domainStats.find(s => s.domain === domain);
      const accuracy = domainRow && domainRow.total > 0
        ? (domainRow.correct + domainRow.partial * 0.5) / domainRow.total
        : 0.5;

      const existing = stmts.getDomainState.get(domain, userId);
      const decayRate = existing?.decay_rate || 0.9;

      const newPain = result === 'wrong'
        ? clamp((existing?.pain_score || 0) * decayRate + 0.2, 0, 1)
        : result === 'partial'
          ? clamp((existing?.pain_score || 0) * decayRate + 0.05, 0, 1)
          : (existing?.pain_score || 0) * decayRate;

      const newSat = result === 'correct'
        ? clamp((existing?.satisfaction_score || 0) * decayRate + 0.15, 0, 1)
        : result === 'partial'
          ? clamp((existing?.satisfaction_score || 0) * decayRate + 0.05, 0, 1)
          : (existing?.satisfaction_score || 0) * decayRate;

      // Streak tracking
      let streakType = existing?.streak_type || 'none';
      let streakCount = existing?.streak_count || 0;
      let bestStreak = existing?.best_streak || 0;
      let worstStreak = existing?.worst_streak || 0;

      if (result === 'correct') {
        if (streakType === 'correct') {
          streakCount++;
          bestStreak = Math.max(bestStreak, streakCount);
        } else {
          streakType = 'correct';
          streakCount = 1;
        }
      } else if (result === 'wrong') {
        if (streakType === 'wrong') {
          streakCount++;
          worstStreak = Math.max(worstStreak, streakCount);
        } else {
          streakType = 'wrong';
          streakCount = 1;
        }
      }

      // Compute calibration offset (predicted confidence vs actual accuracy)
      const calibOffset = (prediction.confidence || 0.5) - (result === 'correct' ? 1 : result === 'partial' ? 0.5 : 0);

      // Get historical accuracy values for trend/volatility computation
      const history = stmts.listDomainHistory?.all?.(domain, userId, 20) || [];
      const recentAccuracies = history.map(h => h.prediction_accuracy);
      const trend = computeTrend(recentAccuracies.concat(accuracy));
      const volatility = computeVolatility(recentAccuracies.concat(accuracy));

      stmts.upsertDomainState.run(
        domain, userId,
        newPain, newSat, accuracy,
        computeEMA(existing?.calibration_offset || 0, calibOffset, 0.15),
        (existing?.total_predictions || 0) + 1,
        (existing?.correct_predictions || 0) + (result === 'correct' ? 1 : 0),
        (existing?.wrong_predictions || 0) + (result === 'wrong' ? 1 : 0),
        (existing?.partial_predictions || 0) + (result === 'partial' ? 1 : 0),
        streakType, streakCount, bestStreak, worstStreak,
        result === 'wrong' ? prediction.prediction_text.slice(0, 200) : '',
        result === 'correct' ? prediction.prediction_text.slice(0, 200) : '',
        now, decayRate, volatility, trend, now
      );

      // 3b. Record domain history snapshot
      try {
        stmts.insertDomainHistory.run(
          randomUUID(), domain, userId,
          newPain, newSat, accuracy,
          `prediction_${result}`,
          prediction.prediction_text.slice(0, 150),
          now
        );
      } catch {}

      // 4. Apply cascade effects to related domains
      for (const cascade of cascadeEffects) {
        try {
          const relatedState = stmts.getDomainState.get(cascade.domain, userId);
          if (relatedState) {
            const updatedPain = clamp(relatedState.pain_score + cascade.delta, 0, 1);
            stmts.upsertDomainState.run(
              cascade.domain, userId,
              updatedPain, relatedState.satisfaction_score,
              relatedState.prediction_accuracy, relatedState.calibration_offset,
              relatedState.total_predictions, relatedState.correct_predictions,
              relatedState.wrong_predictions, relatedState.partial_predictions,
              relatedState.streak_type, relatedState.streak_count,
              relatedState.best_streak, relatedState.worst_streak,
              '', '', relatedState.last_outcome_at,
              relatedState.decay_rate, relatedState.volatility, relatedState.trend, now
            );
          }
        } catch {}
      }

      // 5. Pattern detection + Gene creation (skip during bootstrap on public)
      let geneCreated = null;
      let patternDetected = null;

      if (!isBootstrapActive()) {
        // Get recent wrong predictions in this domain for pattern detection
        const recentWrong = stmts.listPredictionsByDomain.all(userId, domain, 30)
          .filter(p => p.status === 'verified_wrong');

        // Try to find or create a pattern
        if (recentWrong.length >= 2) {
          const signature = extractPatternSignature(recentWrong);
          const existingPattern = stmts.findPatternBySignature?.get?.(userId, domain, signature);

          if (existingPattern) {
            // Strengthen existing pattern
            const newContributing = safeJsonParse(existingPattern.contributing_outcomes, []);
            newContributing.push(outcomeId);
            const newConf = clamp(existingPattern.confidence + 0.1, 0, 1);
            stmts.updatePatternFrequency.run(
              now, JSON.stringify(newContributing.slice(-20)), newConf,
              existingPattern.id, userId
            );
            patternDetected = { id: existingPattern.id, frequency: existingPattern.frequency + 1, isNew: false };

            // If pattern frequency reaches threshold, promote to gene
            if (existingPattern.frequency + 1 >= 3 && existingPattern.status === 'emerging') {
              const geneText = generateGeneText(domain, recentWrong);
              const capReducing = isCapabilityReducing(geneText);
              const threshold = capReducing ? 5 : 3;

              if (existingPattern.frequency + 1 >= threshold) {
                const existingGene = stmts.findGeneByText?.get?.(userId, domain, geneText);
                if (!existingGene) {
                  const geneId = randomUUID();
                  const needsReview = capReducing || !config.isPrivate;
                  const geneStatus = needsReview ? 'pending_review' : 'active';

                  stmts.insertGene.run(
                    geneId, geneText, 'behavioral', domain,
                    signature, existingPattern.id,
                    `when_wrong_about_${signature.split(',')[0]?.trim() || 'topic'}`,
                    `increase_caution_and_verify`,
                    0.5, geneStatus, 0, 0, 0,
                    needsReview ? 1 : 0, capReducing ? 'moderate' : 'none',
                    null, '[]', now, now, userId
                  );

                  // Record gene audit
                  stmts.insertGeneAudit.run(
                    randomUUID(), geneId, 'created',
                    '{}', JSON.stringify({ strength: 0.5, status: geneStatus }),
                    `Auto-created from pattern "${signature}" with ${recentWrong.length} failures`,
                    'system', now, userId
                  );

                  // Update pattern status
                  stmts.updatePatternStatus.run('promoted', geneText, existingPattern.id, userId);

                  geneCreated = { id: geneId, geneText, status: geneStatus, requiresReview: needsReview };
                }
              }
            }
          } else if (recentWrong.length >= 2) {
            // Create new pattern
            const patternId = randomUUID();
            stmts.insertPattern.run(
              patternId, domain, 'failure_cluster', signature,
              `Repeated prediction failures around: ${signature}`,
              1, 0.3, now, now,
              JSON.stringify([outcomeId]), '', 'emerging', userId
            );
            patternDetected = { id: patternId, frequency: 1, isNew: true };
          }
        }
      }

      // Silent training data collection — fire-and-forget
      try {
        ctx.trainingData?.collectOutcomeVerified?.({
          userId,
          predictionId,
          predictionText: prediction.prediction_text,
          result,
          domain,
          confidence: prediction.confidence,
          sourceModel: prediction.source_model,
        });
      } catch {}

      res.json({
        outcome: {
          id: outcomeId,
          predictionId,
          result,
          domain,
          painDelta,
          cascadeEffects,
        },
        domainState: {
          domain,
          accuracy: Math.round(accuracy * 100) / 100,
          pain: Math.round(newPain * 100) / 100,
          satisfaction: Math.round(newSat * 100) / 100,
          trend,
          streak: { type: streakType, count: streakCount },
        },
        patternDetected,
        geneCreated,
        bootstrapActive: isBootstrapActive(),
      });
    } catch (e) {
      console.error('[ConsequenceEngine] Resolve prediction error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Resolve most recent pending prediction for a conversation
  app.post('/api/consequence/predictions/resolve-recent', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const { conversationId, result, triggerType, triggerSource } = req.body;
      if (!conversationId || !result) return res.status(400).json({ error: 'conversationId and result required' });

      const pending = stmts.getRecentPendingByConversation.get(userId, conversationId, 'pending');
      if (!pending) return res.json({ resolved: false, reason: 'no pending predictions' });

      // Forward to the resolve endpoint logic via internal function call
      // (duplicating core logic inline to avoid HTTP self-call)
      const now = Date.now();
      const domain = pending.domain;
      const config = getConfig();
      const outcomeId = randomUUID();

      const painDelta = result === 'wrong' ? 0.2 : result === 'partial' ? 0.05 : 0;
      const satDelta = result === 'correct' ? 0.15 : 0;

      stmts.insertOutcomeResult.run(
        outcomeId, pending.id, triggerType || 'auto',
        (triggerSource || '').slice(0, 200), '{}',
        result, 0, painDelta, satDelta,
        '', '', domain, 'normal', '[]', now, userId
      );

      const statusMap = { correct: 'verified_correct', wrong: 'verified_wrong', partial: 'verified_partial' };
      stmts.resolvePrediction.run(statusMap[result], outcomeId, now, pending.id, userId);

      // Lightweight domain state update (simplified version)
      const existing = stmts.getDomainState.get(domain, userId);
      const decay = existing?.decay_rate || 0.9;
      const newPain = result === 'wrong'
        ? clamp((existing?.pain_score || 0) * decay + 0.2, 0, 1)
        : (existing?.pain_score || 0) * decay;
      const newSat = result === 'correct'
        ? clamp((existing?.satisfaction_score || 0) * decay + 0.15, 0, 1)
        : (existing?.satisfaction_score || 0) * decay;

      const totalPred = (existing?.total_predictions || 0) + 1;
      const correctPred = (existing?.correct_predictions || 0) + (result === 'correct' ? 1 : 0);
      const accuracy = totalPred > 0 ? correctPred / totalPred : 0.5;

      stmts.upsertDomainState.run(
        domain, userId, newPain, newSat, accuracy, existing?.calibration_offset || 0,
        totalPred, correctPred,
        (existing?.wrong_predictions || 0) + (result === 'wrong' ? 1 : 0),
        (existing?.partial_predictions || 0) + (result === 'partial' ? 1 : 0),
        existing?.streak_type || 'none', existing?.streak_count || 0,
        existing?.best_streak || 0, existing?.worst_streak || 0,
        result === 'wrong' ? pending.prediction_text.slice(0, 200) : '',
        result === 'correct' ? pending.prediction_text.slice(0, 200) : '',
        now, decay, existing?.volatility || 0.5, existing?.trend || 'stable', now
      );

      res.json({
        resolved: true,
        predictionId: pending.id,
        outcomeId,
        result,
        domain,
      });
    } catch (e) {
      console.error('[ConsequenceEngine] Resolve-recent error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 2: STANDALONE OUTCOMES
  // ══════════════════════════════════════════════════════════════════════════

  app.post('/api/consequence/outcomes', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const {
        predictionId, triggerType, triggerSource, triggerData,
        result, lessonLearned, correctiveAction, domain, severity,
      } = req.body;

      if (!triggerType || !result) return res.status(400).json({ error: 'triggerType and result required' });

      const config = getConfig();
      const resolvedDomain = domain && isValidDomain(domain)
        ? domain : config.domains[0] || 'general';

      const id = randomUUID();
      stmts.insertOutcomeResult.run(
        id, predictionId || null, triggerType,
        (triggerSource || '').slice(0, 200),
        JSON.stringify(triggerData || {}),
        result, 0,
        result === 'wrong' ? 0.2 : 0,
        result === 'correct' ? 0.15 : 0,
        (lessonLearned || '').slice(0, 500),
        (correctiveAction || '').slice(0, 500),
        resolvedDomain, severity || 'normal', '[]', Date.now(), userId
      );

      res.json({ outcome: { id, domain: resolvedDomain, result } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/consequence/outcomes', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const { domain, triggerType, severity, limit } = req.query;
      const lim = Math.min(parseInt(limit) || 50, 200);

      let rows;
      if (domain) {
        rows = stmts.listOutcomesByDomain.all(userId, domain, lim);
      } else if (triggerType) {
        rows = stmts.listOutcomesByTrigger.all(userId, triggerType, lim);
      } else if (severity) {
        rows = stmts.listOutcomesBySeverity.all(userId, severity, lim);
      } else {
        rows = stmts.listOutcomeResults.all(userId, lim);
      }

      res.json({ outcomes: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 3: EMOTIONAL WEIGHTMAP — Domain States
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/consequence/domains', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const { sortBy } = req.query;
      let rows;
      if (sortBy === 'pain') {
        rows = stmts.listDomainStatesByPain.all(userId);
      } else if (sortBy === 'accuracy') {
        rows = stmts.listDomainStatesByAccuracy.all(userId);
      } else {
        rows = stmts.listDomainStates.all(userId);
      }
      res.json({ domains: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/consequence/domains/:domain', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const domain = req.params.domain;
      const state = stmts.getDomainState.get(domain, userId);
      if (!state) return res.json({ domain: null });

      // Include history for this domain
      const history = stmts.listDomainHistory?.all?.(domain, userId, 50) || [];

      res.json({ domain: state, history });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Domain history over time (for charts)
  app.get('/api/consequence/domains/:domain/history', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const domain = req.params.domain;
      const since = parseInt(req.query.since) || (Date.now() - 30 * 24 * 60 * 60 * 1000);
      const history = stmts.listDomainHistorySince?.all?.(domain, userId, since) || [];
      res.json({ history });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 4: PATTERN CORTEX
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/consequence/patterns', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const { domain, type, status, limit } = req.query;
      const lim = Math.min(parseInt(limit) || 50, 100);

      let rows;
      if (domain) {
        rows = stmts.listPatternsByDomain.all(userId, domain, lim);
      } else if (type) {
        rows = stmts.listPatternsByType.all(userId, type, lim);
      } else if (status) {
        rows = stmts.listEmergingPatterns.all(userId, status, lim);
      } else {
        rows = stmts.listPatterns.all(userId, lim);
      }

      res.json({ patterns: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 5: BEHAVIORAL GENOME
  // ══════════════════════════════════════════════════════════════════════════

  // Create a gene manually
  app.post('/api/consequence/genes', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const {
        geneText, geneType, domain, sourcePattern, triggerCondition,
        actionDirective, strength, regressionRisk,
      } = req.body;

      if (!geneText) return res.status(400).json({ error: 'geneText required' });

      const config = getConfig();
      const resolvedDomain = domain && isValidDomain(domain) ? domain : config.domains[0];
      const capReducing = isCapabilityReducing(geneText);
      const needsReview = capReducing || !config.isPrivate;
      const status = needsReview ? 'pending_review' : 'active';

      // Cap: max 20 active genes per domain
      const activeCount = stmts.countActiveGenesByDomain?.all?.(userId, 'active') || [];
      const domainCount = activeCount.find(r => r.domain === resolvedDomain);
      if (domainCount && domainCount.count >= 20) {
        return res.status(429).json({ error: `Domain ${resolvedDomain} already has 20 active genes. Delete weak genes first.` });
      }

      const id = randomUUID();
      const now = Date.now();

      stmts.insertGene.run(
        id, geneText, geneType || 'behavioral', resolvedDomain,
        (sourcePattern || '').slice(0, 300), null,
        (triggerCondition || '').slice(0, 200),
        (actionDirective || '').slice(0, 200),
        clamp(strength || 0.5, 0.1, 1), status, 0, 0, 0,
        needsReview ? 1 : 0,
        regressionRisk || (capReducing ? 'moderate' : 'none'),
        null, '[]', now, now, userId
      );

      // Audit log
      stmts.insertGeneAudit.run(
        randomUUID(), id, 'manual_create',
        '{}', JSON.stringify({ geneText, strength: strength || 0.5, status }),
        'Manually created gene', 'user', now, userId
      );

      res.json({ gene: { id, geneText, domain: resolvedDomain, status, requiresReview: needsReview } });
    } catch (e) {
      console.error('[ConsequenceEngine] Create gene error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // List genes (with filters)
  app.get('/api/consequence/genes', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const { domain, status, type, minStrength, limit } = req.query;
      const lim = Math.min(parseInt(limit) || 50, 100);

      let rows;
      if (status === 'active') {
        rows = stmts.listActiveGenes.all(userId, 'active', parseFloat(minStrength) || 0, lim);
      } else if (status === 'pending_review') {
        rows = stmts.listPendingReviewGenes.all(userId, 'pending_review', lim);
      } else if (domain) {
        rows = stmts.listGenesByDomain.all(userId, domain, 'deleted', lim);
      } else if (type) {
        rows = stmts.listGenesByType.all(userId, type, 'deleted', lim);
      } else {
        rows = stmts.listAllGenes.all(userId, 'deleted', lim);
      }

      res.json({ genes: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get single gene with full details + audit history
  app.get('/api/consequence/genes/:id', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const gene = stmts.getGene.get(req.params.id, userId);
      if (!gene) return res.status(404).json({ error: 'Gene not found' });

      const auditLog = stmts.listGeneAudit.all(req.params.id, userId, 20);
      res.json({ gene, auditLog });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Confirm (strengthen) a gene
  app.post('/api/consequence/genes/:id/confirm', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const geneId = req.params.id;
      const gene = stmts.getGene.get(geneId, userId);
      if (!gene) return res.status(404).json({ error: 'Gene not found' });

      const now = Date.now();
      stmts.confirmGene.run(now, now, geneId, userId);

      // Audit
      stmts.insertGeneAudit.run(
        randomUUID(), geneId, 'confirmed',
        JSON.stringify({ strength: gene.strength, confirmations: gene.confirmations }),
        JSON.stringify({ strength: Math.min(1, gene.strength + 0.1), confirmations: gene.confirmations + 1 }),
        req.body.reason || 'Outcome confirmed gene behavior',
        'system', now, userId
      );

      const updated = stmts.getGene.get(geneId, userId);
      res.json({ gene: updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Contradict (weaken) a gene
  app.post('/api/consequence/genes/:id/contradict', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const geneId = req.params.id;
      const gene = stmts.getGene.get(geneId, userId);
      if (!gene) return res.status(404).json({ error: 'Gene not found' });

      const now = Date.now();
      stmts.contradictGene.run('dormant', now, geneId, userId);

      // Audit
      const newStrength = Math.max(0, gene.strength - 0.15);
      stmts.insertGeneAudit.run(
        randomUUID(), geneId, 'contradicted',
        JSON.stringify({ strength: gene.strength, contradictions: gene.contradictions }),
        JSON.stringify({ strength: newStrength, contradictions: gene.contradictions + 1, dormant: newStrength < 0.2 }),
        req.body.reason || 'Outcome contradicted gene behavior',
        'system', now, userId
      );

      const updated = stmts.getGene.get(geneId, userId);
      res.json({ gene: updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Approve a pending_review gene (private only)
  app.post('/api/consequence/genes/:id/approve', requireAuth, (req, res) => {
    try {
      const config = getConfig();
      if (!config.isPrivate) {
        return res.status(403).json({ error: 'Gene approval is only available on private instances' });
      }

      const userId = req.userId;
      const geneId = req.params.id;
      const gene = stmts.getGene.get(geneId, userId);
      if (!gene) return res.status(404).json({ error: 'Gene not found' });
      if (gene.status !== 'pending_review') {
        return res.status(409).json({ error: `Gene is ${gene.status}, not pending_review` });
      }

      const now = Date.now();
      stmts.approveGene.run('active', (req.body.reviewNotes || '').slice(0, 500), now, geneId, userId);

      stmts.insertGeneAudit.run(
        randomUUID(), geneId, 'approved',
        JSON.stringify({ status: 'pending_review' }),
        JSON.stringify({ status: 'active', requires_review: 0 }),
        req.body.reviewNotes || 'Manually approved',
        'user', now, userId
      );

      const updated = stmts.getGene.get(geneId, userId);
      res.json({ gene: updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Mutate a gene (modify its text/behavior while preserving lineage)
  app.post('/api/consequence/genes/:id/mutate', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const geneId = req.params.id;
      const gene = stmts.getGene.get(geneId, userId);
      if (!gene) return res.status(404).json({ error: 'Gene not found' });

      const { newGeneText, newTriggerCondition, newActionDirective, reason } = req.body;
      if (!newGeneText) return res.status(400).json({ error: 'newGeneText required' });

      const now = Date.now();
      const mutationHistory = safeJsonParse(gene.mutation_history, []);
      mutationHistory.push({
        from: gene.gene_text,
        to: newGeneText,
        reason: reason || 'Manual mutation',
        at: now,
      });

      stmts.mutateGene.run(
        newGeneText, newTriggerCondition || gene.trigger_condition,
        newActionDirective || gene.action_directive,
        JSON.stringify(mutationHistory.slice(-10)), now, geneId, userId
      );

      stmts.insertGeneAudit.run(
        randomUUID(), geneId, 'mutated',
        JSON.stringify({ gene_text: gene.gene_text }),
        JSON.stringify({ gene_text: newGeneText }),
        reason || 'Gene mutation', 'user', now, userId
      );

      const updated = stmts.getGene.get(geneId, userId);
      res.json({ gene: updated });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Delete a gene
  app.delete('/api/consequence/genes/:id', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const geneId = req.params.id;
      const gene = stmts.getGene.get(geneId, userId);
      if (!gene) return res.status(404).json({ error: 'Gene not found' });

      const now = Date.now();
      stmts.updateGeneStatus.run('deleted', now, geneId, userId);

      stmts.insertGeneAudit.run(
        randomUUID(), geneId, 'deleted',
        JSON.stringify({ status: gene.status, strength: gene.strength }),
        JSON.stringify({ status: 'deleted' }),
        req.body?.reason || 'User-initiated deletion',
        'user', now, userId
      );

      res.json({ deleted: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GENE AUDIT LOG
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/consequence/genes/:id/audit', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const rows = stmts.listGeneAudit.all(req.params.id, userId, limit);
      res.json({ auditLog: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/consequence/audit', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const rows = stmts.listRecentGeneAudits.all(userId, limit);
      res.json({ auditLog: rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // COMPREHENSIVE DASHBOARD (Layer 4 — Pattern Cortex Intelligence)
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/consequence/dashboard', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const config = getConfig();

      // 1. Domain states with emotional weightmap
      const domainStates = stmts.listDomainStates.all(userId);

      // 2. Prediction stats by domain
      const predictionStats = stmts.countPredictionsByDomain.all(
        'verified_correct', 'verified_wrong', 'verified_partial', userId
      );

      // 3. Overall prediction counts
      const totalPredictions = stmts.countPredictions.get(userId)?.count || 0;
      const statusCounts = stmts.countPredictionsByStatus.all(userId);

      // 4. Calibration curve (5 confidence buckets)
      const calibrationData = stmts.predictionAccuracyByConfidenceBucket.all(userId);
      const calibrationCurve = [0, 1, 2, 3, 4].map(bucket => {
        const row = calibrationData.find(r => r.bucket === bucket);
        const bucketMin = bucket * 0.2;
        const bucketMax = (bucket + 1) * 0.2;
        const total = row?.total || 0;
        const correct = row?.correct || 0;
        const actualAccuracy = total > 0 ? correct / total : 0;
        const expectedAccuracy = (bucketMin + bucketMax) / 2;
        return {
          bucket,
          range: `${Math.round(bucketMin * 100)}%-${Math.round(bucketMax * 100)}%`,
          total,
          correct,
          actualAccuracy: Math.round(actualAccuracy * 100) / 100,
          expectedAccuracy: Math.round(expectedAccuracy * 100) / 100,
          overconfidenceDelta: Math.round((expectedAccuracy - actualAccuracy) * 100) / 100,
        };
      });

      // 5. Domain accuracy trend (7d vs all-time)
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const domainTrends = stmts.domainAccuracyTrend.all(sevenDaysAgo, sevenDaysAgo, userId);

      // 6. Gene stats
      const geneStats = stmts.countGenes.get(userId, 'deleted');
      const genesByDomain = stmts.countGenesByDomain.all(userId, 'deleted');
      const activeGenesByDomain = stmts.countActiveGenesByDomain?.all?.(userId, 'active') || [];
      const pendingReviewGenes = stmts.listPendingReviewGenes.all(userId, 'pending_review', 10);
      const geneEffectiveness = stmts.geneEffectiveness.all(userId, 'deleted', 10);

      // 7. Outcome stats
      const totalOutcomes = stmts.countOutcomes.get(userId)?.count || 0;
      const outcomesByResult = stmts.countOutcomesByResult.all(userId);

      // 8. Recent outcomes with prediction context
      const recentOutcomes = stmts.recentOutcomesWithPredictions.all(userId, 10);

      // 9. Active patterns
      const emergingPatterns = stmts.listEmergingPatterns?.all?.(userId, 'emerging', 10) || [];

      // 10. Regression alerts — genes with high contradiction rates
      const regressionAlerts = geneEffectiveness
        .filter(g => g.contradictions > g.confirmations && g.contradictions >= 3)
        .map(g => ({
          geneId: g.id,
          geneText: g.gene_text,
          domain: g.domain,
          effectiveness: Math.round(g.effectiveness * 100) / 100,
          contradictions: g.contradictions,
          confirmations: g.confirmations,
        }));

      // Build response — full on private, minimal on public
      const dashboard = {
        summary: {
          totalPredictions,
          totalOutcomes,
          totalGenes: geneStats?.count || 0,
          domainsTracked: domainStates.length,
          bootstrapActive: isBootstrapActive(),
          isPrivate: config.isPrivate,
        },
        statusCounts: Object.fromEntries(statusCounts.map(s => [s.status, s.count])),
        calibrationCurve,
        domainStates: domainStates.map(d => ({
          domain: d.domain,
          accuracy: Math.round(d.prediction_accuracy * 100) / 100,
          pain: Math.round(d.pain_score * 100) / 100,
          satisfaction: Math.round(d.satisfaction_score * 100) / 100,
          calibrationOffset: Math.round((d.calibration_offset || 0) * 100) / 100,
          total: d.total_predictions,
          correct: d.correct_predictions,
          wrong: d.wrong_predictions,
          partial: d.partial_predictions,
          streak: { type: d.streak_type, count: d.streak_count },
          bestStreak: d.best_streak,
          worstStreak: d.worst_streak,
          volatility: Math.round((d.volatility || 0) * 100) / 100,
          trend: d.trend,
        })),
        predictionsByDomain: predictionStats,
        domainTrends: domainTrends.map(d => ({
          domain: d.domain,
          recentAccuracy: d.recent_total > 0 ? Math.round((d.recent_correct / d.recent_total) * 100) : null,
          allTimeAccuracy: d.all_total > 0 ? Math.round((d.all_correct / d.all_total) * 100) : null,
          recentTotal: d.recent_total,
          allTotal: d.all_total,
        })),
        outcomesByResult: Object.fromEntries(outcomesByResult.map(o => [o.result, o.count])),
      };

      // Private gets full transparency
      if (config.isPrivate) {
        dashboard.genesByDomain = genesByDomain;
        dashboard.activeGenesByDomain = activeGenesByDomain;
        dashboard.pendingReviewGenes = pendingReviewGenes;
        dashboard.geneEffectiveness = geneEffectiveness;
        dashboard.regressionAlerts = regressionAlerts;
        dashboard.recentOutcomes = recentOutcomes;
        dashboard.emergingPatterns = emergingPatterns;
      } else {
        // Public gets minimal — just aggregates
        dashboard.activeGeneCount = activeGenesByDomain.reduce((sum, r) => sum + r.count, 0);
        dashboard.pendingReviewCount = pendingReviewGenes.length;
        dashboard.regressionAlertCount = regressionAlerts.length;
      }

      res.json({ dashboard });
    } catch (e) {
      console.error('[ConsequenceEngine] Dashboard error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CALIBRATION SNAPSHOTS
  // ══════════════════════════════════════════════════════════════════════════

  // Compute and store a calibration snapshot
  app.post('/api/consequence/calibration/snapshot', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const domain = req.body.domain || 'all';
      const now = Date.now();

      const calibrationData = stmts.predictionAccuracyByConfidenceBucket.all(userId);

      for (let bucket = 0; bucket < 5; bucket++) {
        const row = calibrationData.find(r => r.bucket === bucket);
        const bucketMin = bucket * 0.2;
        const bucketMax = (bucket + 1) * 0.2;
        const total = row?.total || 0;
        const correct = row?.correct || 0;
        const actualAccuracy = total > 0 ? correct / total : 0;
        const expected = (bucketMin + bucketMax) / 2;

        stmts.insertCalibrationSnapshot.run(
          randomUUID(), domain, bucket, bucketMin, bucketMax,
          total, correct, actualAccuracy,
          expected - actualAccuracy, now, userId
        );
      }

      res.json({ stored: true, domain, buckets: 5, timestamp: now });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get calibration history
  app.get('/api/consequence/calibration', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const domain = req.query.domain || 'all';
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);

      const rows = stmts.listCalibrationSnapshots.all(userId, domain, limit);
      const latest = stmts.getLatestCalibration?.all?.(userId, domain, userId, domain) || [];

      res.json({ snapshots: rows, latest });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  app.post('/api/consequence/lifecycle', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const now = Date.now();
      const results = {};

      // 1. Expire old predictions (> 7 days, still pending)
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const expiredByAge = stmts.expireOldPredictions.run('expired', userId, 'pending', sevenDaysAgo);
      results.expiredByAge = expiredByAge.changes;

      // 2. Expire predictions past their explicit expiry timestamp
      const expiredByTimestamp = stmts.expireByTimestamp.run('expired', userId, 'pending', now);
      results.expiredByTimestamp = expiredByTimestamp.changes;

      // 3. Delete weak genes (strength < 0.05, status = dormant)
      const deletedGenes = stmts.deleteWeakGenes.run(userId, 0.05, 'dormant');
      results.deletedWeakGenes = deletedGenes.changes;

      // 4. Prune weak patterns (frequency < 2, status = emerging, older than 14 days)
      const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;
      const prunedPatterns = stmts.pruneWeakPatterns?.run?.(userId, 2, 'emerging');
      results.prunedPatterns = prunedPatterns?.changes || 0;

      // 5. Prune old domain history (> 90 days)
      const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;
      const prunedHistory = stmts.pruneDomainHistory?.run?.(userId, ninetyDaysAgo);
      results.prunedHistory = prunedHistory?.changes || 0;

      // 6. Prune old calibration snapshots (> 90 days)
      const prunedCalibrations = stmts.pruneOldCalibrations?.run?.(userId, ninetyDaysAgo);
      results.prunedCalibrations = prunedCalibrations?.changes || 0;

      // 7. Auto-activate genes that have 5+ confirmations and 0 contradictions (public safe mode)
      const config = getConfig();
      if (!config.isPrivate) {
        const pendingGenes = stmts.listPendingReviewGenes.all(userId, 'pending_review', 100);
        let autoActivated = 0;
        for (const gene of pendingGenes) {
          if (gene.confirmations >= 5 && gene.contradictions === 0) {
            stmts.approveGene.run('active', 'Auto-activated: 5+ confirmations, 0 contradictions', now, gene.id, userId);
            stmts.insertGeneAudit.run(
              randomUUID(), gene.id, 'auto_activated',
              JSON.stringify({ status: 'pending_review', confirmations: gene.confirmations }),
              JSON.stringify({ status: 'active' }),
              'Lifecycle auto-activation: threshold met',
              'system', now, userId
            );
            autoActivated++;
          }
        }
        results.autoActivatedGenes = autoActivated;
      }

      // 8. Compute calibration snapshot (periodic)
      try {
        const calibrationData = stmts.predictionAccuracyByConfidenceBucket.all(userId);
        for (let bucket = 0; bucket < 5; bucket++) {
          const row = calibrationData.find(r => r.bucket === bucket);
          const bucketMin = bucket * 0.2;
          const bucketMax = (bucket + 1) * 0.2;
          const total = row?.total || 0;
          const correct = row?.correct || 0;
          const actualAccuracy = total > 0 ? correct / total : 0;
          const expected = (bucketMin + bucketMax) / 2;

          stmts.insertCalibrationSnapshot.run(
            randomUUID(), 'all', bucket, bucketMin, bucketMax,
            total, correct, actualAccuracy, expected - actualAccuracy, now, userId
          );
        }
        results.calibrationSnapshotCreated = true;
      } catch { results.calibrationSnapshotCreated = false; }

      // 9. Apply decay to all domain states
      const allDomains = stmts.listDomainStates.all(userId);
      for (const d of allDomains) {
        const decay = d.decay_rate || 0.9;
        const decayedPain = d.pain_score * decay;
        const decayedSat = d.satisfaction_score * decay;
        if (Math.abs(decayedPain - d.pain_score) > 0.001 || Math.abs(decayedSat - d.satisfaction_score) > 0.001) {
          stmts.upsertDomainState.run(
            d.domain, d.user_id,
            decayedPain, decayedSat,
            d.prediction_accuracy, d.calibration_offset,
            d.total_predictions, d.correct_predictions,
            d.wrong_predictions, d.partial_predictions,
            d.streak_type, d.streak_count,
            d.best_streak, d.worst_streak,
            '', '', d.last_outcome_at,
            d.decay_rate, d.volatility, d.trend, now
          );
        }
      }
      results.domainsDecayed = allDomains.length;

      res.json({ lifecycle: results, timestamp: now });
    } catch (e) {
      console.error('[ConsequenceEngine] Lifecycle error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // KILL SWITCH — instant observation-only toggle for public
  // ══════════════════════════════════════════════════════════════════════════

  // Runtime kill switch state (not persisted across restarts — use env var for persistent)
  let _killSwitchActive = false;

  app.get('/api/consequence/kill-switch', requireAuth, (req, res) => {
    res.json({
      active: _killSwitchActive,
      effect: _killSwitchActive
        ? 'Engine is in observation-only mode. Tracking continues but genes do NOT influence behavior.'
        : 'Engine is fully active. Genes influence behavior via system prompt addendum.',
    });
  });

  app.post('/api/consequence/kill-switch', requireAuth, (req, res) => {
    const { active } = req.body;
    if (typeof active !== 'boolean') return res.status(400).json({ error: 'active (boolean) required' });
    _killSwitchActive = active;
    console.log(`[ConsequenceEngine] Kill switch ${active ? 'ACTIVATED' : 'DEACTIVATED'} by user`);
    res.json({
      active: _killSwitchActive,
      message: active
        ? 'Kill switch activated. Genes will NOT be included in system prompt. Tracking continues.'
        : 'Kill switch deactivated. Genes are now influencing behavior again.',
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WEEKLY INTELLIGENCE REPORT
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/consequence/weekly-report', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const config = getConfig();
      const now = Date.now();
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

      // Predictions this week vs last week
      const allPredictions = stmts.listPredictions.all(userId, 500);
      const thisWeek = allPredictions.filter(p => p.created_at >= weekAgo);
      const lastWeek = allPredictions.filter(p => p.created_at >= twoWeeksAgo && p.created_at < weekAgo);

      const thisWeekCorrect = thisWeek.filter(p => p.status === 'verified_correct').length;
      const thisWeekWrong = thisWeek.filter(p => p.status === 'verified_wrong').length;
      const thisWeekPartial = thisWeek.filter(p => p.status === 'verified_partial').length;
      const thisWeekResolved = thisWeekCorrect + thisWeekWrong + thisWeekPartial;
      const thisWeekAccuracy = thisWeekResolved > 0
        ? Math.round(((thisWeekCorrect + thisWeekPartial * 0.5) / thisWeekResolved) * 100)
        : null;

      const lastWeekCorrect = lastWeek.filter(p => p.status === 'verified_correct').length;
      const lastWeekWrong = lastWeek.filter(p => p.status === 'verified_wrong').length;
      const lastWeekPartial = lastWeek.filter(p => p.status === 'verified_partial').length;
      const lastWeekResolved = lastWeekCorrect + lastWeekWrong + lastWeekPartial;
      const lastWeekAccuracy = lastWeekResolved > 0
        ? Math.round(((lastWeekCorrect + lastWeekPartial * 0.5) / lastWeekResolved) * 100)
        : null;

      const accuracyDelta = (thisWeekAccuracy !== null && lastWeekAccuracy !== null)
        ? thisWeekAccuracy - lastWeekAccuracy : null;

      // Top correct and wrong predictions this week
      const topCorrect = thisWeek
        .filter(p => p.status === 'verified_correct')
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, 5)
        .map(p => ({ text: p.prediction_text, domain: p.domain, confidence: p.confidence }));

      const topWrong = thisWeek
        .filter(p => p.status === 'verified_wrong')
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, 5)
        .map(p => ({ text: p.prediction_text, domain: p.domain, confidence: p.confidence }));

      // Genes formed this week
      const allGenes = stmts.listAllGenes?.all?.(userId, 'deleted', 200) || [];
      const newGenes = allGenes.filter(g => g.created_at >= weekAgo);
      const activatedGenes = allGenes.filter(g => g.updated_at >= weekAgo && g.status === 'active');
      const dormantGenes = allGenes.filter(g => g.updated_at >= weekAgo && g.status === 'dormant');

      // Domain drift — compare this week's accuracy per domain vs last week
      const domainDrift = [];
      for (const domain of config.domains) {
        const twPreds = thisWeek.filter(p => p.domain === domain);
        const lwPreds = lastWeek.filter(p => p.domain === domain);
        const twResolved = twPreds.filter(p => ['verified_correct', 'verified_wrong', 'verified_partial'].includes(p.status));
        const lwResolved = lwPreds.filter(p => ['verified_correct', 'verified_wrong', 'verified_partial'].includes(p.status));
        const twAcc = twResolved.length > 0
          ? (twResolved.filter(p => p.status === 'verified_correct').length / twResolved.length) : null;
        const lwAcc = lwResolved.length > 0
          ? (lwResolved.filter(p => p.status === 'verified_correct').length / lwResolved.length) : null;
        domainDrift.push({
          domain,
          thisWeekAccuracy: twAcc !== null ? Math.round(twAcc * 100) : null,
          lastWeekAccuracy: lwAcc !== null ? Math.round(lwAcc * 100) : null,
          drift: (twAcc !== null && lwAcc !== null) ? Math.round((twAcc - lwAcc) * 100) : null,
          thisWeekPredictions: twPreds.length,
          lastWeekPredictions: lwPreds.length,
        });
      }

      // Calibration shift — compare current bucket accuracies
      const calibrationData = stmts.predictionAccuracyByConfidenceBucket.all(userId);
      const calibrationShift = [0, 1, 2, 3, 4].map(bucket => {
        const row = calibrationData.find(r => r.bucket === bucket);
        const total = row?.total || 0;
        const correct = row?.correct || 0;
        const actual = total > 0 ? Math.round((correct / total) * 100) : 0;
        const expected = Math.round(((bucket * 0.2 + (bucket + 1) * 0.2) / 2) * 100);
        return { bucket, range: `${bucket * 20}%-${(bucket + 1) * 20}%`, total, correct, actual, expected, delta: actual - expected };
      });

      // Generate natural language summary
      const summaryLines = [];
      summaryLines.push(`This week: ${thisWeek.length} predictions made, ${thisWeekResolved} resolved.`);
      if (thisWeekAccuracy !== null) {
        summaryLines.push(`Accuracy: ${thisWeekAccuracy}%${accuracyDelta !== null ? ` (${accuracyDelta >= 0 ? '+' : ''}${accuracyDelta}% vs last week)` : ''}.`);
      }
      if (newGenes.length > 0) {
        summaryLines.push(`${newGenes.length} new gene${newGenes.length > 1 ? 's' : ''} formed this week.`);
      }
      const improvingDomains = domainDrift.filter(d => d.drift !== null && d.drift > 5);
      const decliningDomains = domainDrift.filter(d => d.drift !== null && d.drift < -5);
      if (improvingDomains.length > 0) {
        summaryLines.push(`Improving: ${improvingDomains.map(d => `${d.domain} (+${d.drift}%)`).join(', ')}.`);
      }
      if (decliningDomains.length > 0) {
        summaryLines.push(`Declining: ${decliningDomains.map(d => `${d.domain} (${d.drift}%)`).join(', ')}.`);
      }
      if (topWrong.length > 0) {
        summaryLines.push(`Biggest misses: ${topWrong.slice(0, 2).map(p => `"${p.text.slice(0, 60)}..." (${p.domain})`).join('; ')}.`);
      }

      res.json({
        report: {
          periodStart: weekAgo,
          periodEnd: now,
          generatedAt: now,
          summary: summaryLines.join(' '),
          predictions: {
            thisWeek: { total: thisWeek.length, correct: thisWeekCorrect, wrong: thisWeekWrong, partial: thisWeekPartial, accuracy: thisWeekAccuracy },
            lastWeek: { total: lastWeek.length, correct: lastWeekCorrect, wrong: lastWeekWrong, partial: lastWeekPartial, accuracy: lastWeekAccuracy },
            accuracyDelta,
          },
          topCorrect,
          topWrong,
          genes: {
            newThisWeek: newGenes.map(g => ({ id: g.id, text: g.gene_text, domain: g.domain, strength: g.strength, status: g.status })),
            activated: activatedGenes.length,
            goneDormant: dormantGenes.length,
            totalActive: allGenes.filter(g => g.status === 'active').length,
          },
          domainDrift,
          calibrationShift,
        },
      });
    } catch (e) {
      console.error('[ConsequenceEngine] Weekly report error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PREDICTION ACCURACY TREND — weekly accuracy over time for chart
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/consequence/accuracy-trend', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const weeks = Math.min(parseInt(req.query.weeks) || 12, 52);
      const now = Date.now();
      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

      const allPredictions = stmts.listPredictions.all(userId, 2000);
      const dataPoints = [];

      for (let w = weeks - 1; w >= 0; w--) {
        const weekStart = now - (w + 1) * WEEK_MS;
        const weekEnd = now - w * WEEK_MS;
        const weekPreds = allPredictions.filter(p => p.created_at >= weekStart && p.created_at < weekEnd);
        const resolved = weekPreds.filter(p => ['verified_correct', 'verified_wrong', 'verified_partial'].includes(p.status));
        const correct = resolved.filter(p => p.status === 'verified_correct').length;
        const partial = resolved.filter(p => p.status === 'verified_partial').length;
        const accuracy = resolved.length > 0
          ? Math.round(((correct + partial * 0.5) / resolved.length) * 100)
          : null;

        dataPoints.push({
          weekStart,
          weekEnd,
          weekLabel: new Date(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          total: weekPreds.length,
          resolved: resolved.length,
          correct,
          wrong: resolved.filter(p => p.status === 'verified_wrong').length,
          partial: partial,
          accuracy,
        });
      }

      // Overall trend direction
      const accuracies = dataPoints.filter(d => d.accuracy !== null).map(d => d.accuracy);
      let trendDirection = 'stable';
      if (accuracies.length >= 3) {
        const firstHalf = accuracies.slice(0, Math.ceil(accuracies.length / 2));
        const secondHalf = accuracies.slice(Math.ceil(accuracies.length / 2));
        const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        if (avgSecond - avgFirst > 3) trendDirection = 'improving';
        else if (avgSecond - avgFirst < -3) trendDirection = 'declining';
      }

      res.json({ trend: dataPoints, trendDirection, weeks });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GENE A/B COMPARISON — side-by-side before/after for pending genes
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/consequence/genes/:id/comparison', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const gene = stmts.getGene.get(req.params.id, userId);
      if (!gene) return res.status(404).json({ error: 'Gene not found' });

      const domain = gene.domain;

      // Get recent predictions in this domain to construct examples
      const recentPreds = stmts.listPredictionsByDomain.all(userId, domain, 30);
      const wrongPreds = recentPreds.filter(p => p.status === 'verified_wrong');
      const correctPreds = recentPreds.filter(p => p.status === 'verified_correct');

      // "Before" scenario — what ALIN did WITHOUT this gene (wrong predictions in domain)
      const beforeExamples = wrongPreds.slice(0, 5).map(p => ({
        prediction: p.prediction_text,
        confidence: p.confidence,
        outcome: 'wrong',
        context: p.context_summary || '',
        date: p.created_at,
      }));

      // "After" scenario — what ALIN WOULD do WITH the gene applied
      // Derive from the gene's action directive and trigger condition
      const afterExamples = beforeExamples.map(ex => {
        // Simulate how the gene would modify behavior
        const adjustedConfidence = Math.max(0.2, (ex.confidence || 0.5) - 0.2);
        return {
          originalPrediction: ex.prediction,
          adjustedBehavior: gene.action_directive
            ? `Apply: "${gene.action_directive}" → reduced confidence to ${Math.round(adjustedConfidence * 100)}%, would flag for verification`
            : `Would exercise caution, reduce confidence from ${Math.round((ex.confidence || 0.5) * 100)}% to ${Math.round(adjustedConfidence * 100)}%`,
          likelyOutcome: 'Avoid overconfident wrong prediction, or explicitly hedge',
          confidenceReduction: Math.round(((ex.confidence || 0.5) - adjustedConfidence) * 100),
        };
      });

      // Domain accuracy context
      const domainState = stmts.getDomainState.get(domain, userId);

      // Gene effectiveness estimate
      const potentialImprovement = wrongPreds.length > 0
        ? Math.round((wrongPreds.length / recentPreds.length) * 30) // rough estimate: gene could prevent ~30% of wrong in its pattern
        : 0;

      res.json({
        gene: {
          id: gene.id,
          text: gene.gene_text,
          type: gene.gene_type,
          domain: gene.domain,
          strength: gene.strength,
          status: gene.status,
          triggerCondition: gene.trigger_condition,
          actionDirective: gene.action_directive,
          regressionRisk: gene.regression_risk,
        },
        comparison: {
          before: {
            description: `Without this gene, ALIN made ${wrongPreds.length} wrong predictions in ${domain} recently`,
            examples: beforeExamples,
            domainAccuracy: domainState ? Math.round(domainState.prediction_accuracy * 100) : null,
            domainPain: domainState ? Math.round(domainState.pain_score * 100) / 100 : null,
          },
          after: {
            description: `With this gene active, ALIN would: "${gene.gene_text}"`,
            examples: afterExamples,
            estimatedAccuracyGain: potentialImprovement,
            estimatedPainReduction: potentialImprovement > 0 ? Math.round(potentialImprovement * 0.3) : 0,
          },
        },
        recommendation: gene.regression_risk === 'none' || gene.regression_risk === 'low'
          ? 'Low risk — safe to approve'
          : gene.regression_risk === 'moderate'
            ? 'Moderate risk — review carefully, may limit some capabilities'
            : 'High risk — this gene significantly restricts behavior, approve only if failures are severe',
        correctPredictionsInDomain: correctPreds.length,
        wrongPredictionsInDomain: wrongPreds.length,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EXPORT / IMPORT — snapshot & rollback for the brain
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/consequence/export', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const config = getConfig();

      const genes = stmts.listAllGenes?.all?.(userId, 'deleted', 500) || [];
      const domainStates = stmts.listDomainStates.all(userId);
      const patterns = stmts.listPatterns.all(userId, 200);
      const calibrationData = stmts.predictionAccuracyByConfidenceBucket.all(userId);
      const recentAudits = stmts.listRecentGeneAudits.all(userId, 100);
      const predictions = stmts.listPredictions.all(userId, 500);
      const outcomes = stmts.listOutcomeResults.all(userId, 500);

      res.json({
        version: 1,
        exportedAt: Date.now(),
        config: {
          isPrivate: config.isPrivate,
          domains: config.domains,
        },
        data: {
          genes,
          domainStates,
          patterns,
          calibration: calibrationData,
          recentAudits,
          predictions,
          outcomes,
        },
        stats: {
          totalGenes: genes.length,
          activeGenes: genes.filter(g => g.status === 'active').length,
          pendingGenes: genes.filter(g => g.status === 'pending_review').length,
          totalPredictions: predictions.length,
          totalOutcomes: outcomes.length,
          domainsTracked: domainStates.length,
        },
      });
    } catch (e) {
      console.error('[ConsequenceEngine] Export error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/consequence/import', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const { data, options } = req.body;
      if (!data) return res.status(400).json({ error: 'data object required' });

      const importGenes = options?.importGenes !== false;
      const importDomainStates = options?.importDomainStates !== false;
      const clearExisting = options?.clearExisting === true;
      const now = Date.now();
      let genesImported = 0;
      let domainsImported = 0;

      if (clearExisting) {
        // Clear existing data for this user (soft delete genes, zero domain states)
        const existingGenes = stmts.listAllGenes?.all?.(userId, 'deleted', 1000) || [];
        for (const g of existingGenes) {
          stmts.updateGeneStatus.run('deleted', now, g.id, userId);
        }
        const existingDomains = stmts.listDomainStates.all(userId);
        for (const d of existingDomains) {
          stmts.deleteDomainState?.run?.(d.domain, userId);
        }
      }

      // Import genes
      if (importGenes && Array.isArray(data.genes)) {
        for (const g of data.genes) {
          if (!g.gene_text || g.status === 'deleted') continue;
          const existingGene = stmts.findGeneByText?.get?.(userId, g.domain || 'general', g.gene_text);
          if (existingGene) continue;

          const geneId = randomUUID();
          stmts.insertGene.run(
            geneId, g.gene_text, g.gene_type || 'behavioral', g.domain || 'general',
            g.source_pattern || '', null,
            g.trigger_condition || '', g.action_directive || '',
            clamp(g.strength || 0.5, 0, 1), 'pending_review', // Always import as pending_review
            g.confirmations || 0, g.contradictions || 0, g.applications || 0,
            1, g.regression_risk || 'none', null, g.mutation_history || '[]', now, now, userId
          );

          stmts.insertGeneAudit.run(
            randomUUID(), geneId, 'imported_from_snapshot',
            '{}', JSON.stringify({ strength: g.strength, originalStatus: g.status }),
            `Imported from snapshot (original: ${g.status})`,
            'user', now, userId
          );
          genesImported++;
        }
      }

      // Import domain states
      if (importDomainStates && Array.isArray(data.domainStates)) {
        for (const d of data.domainStates) {
          if (!d.domain) continue;
          stmts.upsertDomainState.run(
            d.domain, userId,
            d.pain_score || 0, d.satisfaction_score || 0,
            d.prediction_accuracy || 0.5, d.calibration_offset || 0,
            d.total_predictions || 0, d.correct_predictions || 0,
            d.wrong_predictions || 0, d.partial_predictions || 0,
            d.streak_type || 'none', d.streak_count || 0,
            d.best_streak || 0, d.worst_streak || 0,
            '', '', d.last_outcome_at || null,
            d.decay_rate || 0.9, d.volatility || 0.5, d.trend || 'stable', now
          );
          domainsImported++;
        }
      }

      res.json({
        imported: { genes: genesImported, domains: domainsImported },
        options: { clearExisting, importGenes, importDomainStates },
      });
    } catch (e) {
      console.error('[ConsequenceEngine] Import error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SERVER-SIDE PREDICTION EXTRACTION (called from streaming.js post-stream)
  // ══════════════════════════════════════════════════════════════════════════

  // Expose extraction function on ctx for streaming.js to call
  ctx.consequenceEngine = {
    extractPredictions,
    classifyDomain,
    isBootstrapActive,

    /**
     * Fire-and-forget: extract + store predictions from completed assistant text.
     * Called from streaming.js after stream ends.
     */
    async recordPredictionsFromStream(userId, conversationId, messageId, text, sourceModel) {
      try {
        const predictions = extractPredictions(text);
        if (predictions.length === 0) return;

        const config = getConfig();
        const now = Date.now();
        const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

        for (const pred of predictions) {
          // Deduplicate
          const existing = stmts.findDuplicatePrediction.get(userId, messageId, pred.text);
          if (existing) continue;

          const domain = classifyDomain(pred.text, config.domains);
          stmts.insertPrediction.run(
            randomUUID(), conversationId || null, messageId || null,
            pred.text, pred.type, domain, pred.confidence,
            '', sourceModel || '', 'regex_server', 'pending',
            expiresAt, now, userId
          );
        }

        console.log(`[ConsequenceEngine] Extracted ${predictions.length} predictions from stream (${sourceModel || 'unknown'})`);
      } catch (e) {
        console.error('[ConsequenceEngine] Stream prediction extraction error:', e.message);
      }
    },

    /**
     * Get the consequence addendum for system prompt injection.
     * Called by selfModelService or directly by streaming.js.
     */
    getAddendumData(userId) {
      try {
        const config = getConfig();
        const domainStates = stmts.listDomainStates.all(userId);
        // Kill switch: return genes as empty when active (observation-only mode)
        const activeGenes = _killSwitchActive ? [] : stmts.listActiveGenes.all(userId, 'active', 0.3, 20);
        const pendingCount = stmts.listPendingReviewGenes.all(userId, 'pending_review', 100).length;

        return {
          isPrivate: config.isPrivate,
          bootstrapActive: isBootstrapActive() || _killSwitchActive,
          bootstrapUntil: config.bootstrapUntil,
          killSwitchActive: _killSwitchActive,
          domainStates,
          activeGenes,
          pendingReviewCount: pendingCount,
          domains: config.domains,
        };
      } catch (e) {
        console.error('[ConsequenceEngine] getAddendumData error:', e.message);
        return null;
      }
    },
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ACTIVE GENES — top genes actively shaping behavior (feedback loop)
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/consequence/active-genes', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const minStrength = parseFloat(req.query.minStrength) || 0.6;
      const minActivations = parseInt(req.query.minActivations) || 3;
      const limit = Math.min(parseInt(req.query.limit) || 10, 50);

      // Get active genes above strength threshold
      const genes = stmts.listActiveGenes.all(userId, 'active', minStrength, 50);

      // Filter by activation count (confirmations + applications) and take top N
      const qualified = genes
        .filter(g => (g.confirmations + g.applications) > minActivations)
        .slice(0, limit)
        .map(g => ({
          id: g.id,
          geneText: g.gene_text,
          domain: g.domain,
          strength: Math.round(g.strength * 100) / 100,
          triggerCondition: g.trigger_condition,
          actionDirective: g.action_directive,
          confirmations: g.confirmations,
          contradictions: g.contradictions,
          applications: g.applications,
          regressionRisk: g.regression_risk,
          createdAt: g.created_at,
          lastAppliedAt: g.last_applied_at,
        }));

      // Also return a "fallback" set: top active genes by strength even if activation threshold not met
      // Useful during early phase when genes haven't been applied many times yet
      const fallback = minActivations > 0 && qualified.length < 3
        ? genes.slice(0, limit).map(g => ({
            id: g.id,
            geneText: g.gene_text,
            domain: g.domain,
            strength: Math.round(g.strength * 100) / 100,
            triggerCondition: g.trigger_condition,
            actionDirective: g.action_directive,
            confirmations: g.confirmations,
            applications: g.applications,
          }))
        : [];

      res.json({
        activeGenes: qualified,
        fallbackGenes: fallback,
        total: genes.length,
        qualifiedCount: qualified.length,
        killSwitchActive: _killSwitchActive,
      });
    } catch (e) {
      console.error('[ConsequenceEngine] Active genes error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // INSIGHTS — human-readable summaries of what ALIN has learned
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/consequence/insights', requireAuth, (req, res) => {
    try {
      const userId = req.userId;
      const config = getConfig();

      // Gather data
      const domainStates = stmts.listDomainStates.all(userId);
      const activeGenes = stmts.listActiveGenes.all(userId, 'active', 0.3, 50);
      const recentOutcomes = stmts.recentOutcomesWithPredictions?.all?.(userId, 20) || [];
      const emergingPatterns = stmts.listEmergingPatterns?.all?.(userId, 'emerging', 10) || [];

      const insights = [];

      // 1. Domain strength insights
      for (const d of domainStates) {
        if (d.total_predictions < 3) continue;
        const accuracy = Math.round(d.prediction_accuracy * 100);

        if (accuracy >= 80) {
          insights.push({
            type: 'strength',
            domain: d.domain,
            title: `Strong in ${d.domain.replace(/_/g, ' ')}`,
            summary: `${accuracy}% prediction accuracy across ${d.total_predictions} predictions. ${d.trend === 'improving' ? 'And still improving.' : ''}`,
            confidence: d.prediction_accuracy,
          });
        } else if (accuracy < 50 && d.total_predictions >= 5) {
          insights.push({
            type: 'weakness',
            domain: d.domain,
            title: `Struggling with ${d.domain.replace(/_/g, ' ')}`,
            summary: `Only ${accuracy}% accuracy across ${d.total_predictions} predictions. ${d.wrong_predictions} wrong calls. ${d.trend === 'declining' ? 'Getting worse.' : d.trend === 'improving' ? 'But improving.' : ''}`,
            confidence: 1 - d.prediction_accuracy,
          });
        }

        if (d.pain_score > 0.5) {
          insights.push({
            type: 'pain_point',
            domain: d.domain,
            title: `High pain in ${d.domain.replace(/_/g, ' ')}`,
            summary: `Pain score ${Math.round(d.pain_score * 100)}%. Recent failures are accumulating. ${d.streak_type === 'wrong' && d.streak_count >= 2 ? `Currently on a ${d.streak_count}-streak of wrong predictions.` : ''}`,
            confidence: d.pain_score,
          });
        }
      }

      // 2. Gene-based behavioral insights
      for (const g of activeGenes.slice(0, 10)) {
        insights.push({
          type: 'learned_behavior',
          domain: g.domain,
          title: `Learned: ${g.action_directive || g.gene_text.slice(0, 60)}`,
          summary: g.gene_text,
          strength: g.strength,
          confirmations: g.confirmations,
          applications: g.applications,
        });
      }

      // 3. Emerging pattern insights
      for (const p of emergingPatterns) {
        insights.push({
          type: 'emerging_pattern',
          domain: p.domain,
          title: `Emerging pattern in ${p.domain.replace(/_/g, ' ')}`,
          summary: p.description || `Detected recurring failure pattern: ${p.pattern_signature}`,
          frequency: p.frequency,
        });
      }

      // 4. Calibration insight
      const calibrationData = stmts.predictionAccuracyByConfidenceBucket?.all?.(userId) || [];
      const overconfidentBuckets = calibrationData.filter(b => {
        const expected = ((b.bucket * 0.2) + ((b.bucket + 1) * 0.2)) / 2;
        const actual = b.total > 0 ? b.correct / b.total : 0;
        return b.total >= 5 && (expected - actual) > 0.15;
      });
      if (overconfidentBuckets.length > 0) {
        insights.push({
          type: 'calibration',
          domain: 'general',
          title: 'Overconfidence detected',
          summary: `ALIN tends to be overconfident in ${overconfidentBuckets.length} confidence bracket${overconfidentBuckets.length > 1 ? 's' : ''}. High-confidence predictions are less accurate than expected.`,
          confidence: 0.8,
        });
      }

      // Sort: weaknesses and pain points first, then strengths, then behaviors
      const priority = { weakness: 0, pain_point: 1, calibration: 2, emerging_pattern: 3, learned_behavior: 4, strength: 5 };
      insights.sort((a, b) => (priority[a.type] ?? 99) - (priority[b.type] ?? 99));

      res.json({
        insights,
        totalInsights: insights.length,
        domainsAnalyzed: domainStates.length,
        activeGeneCount: activeGenes.length,
        generatedAt: Date.now(),
      });
    } catch (e) {
      console.error('[ConsequenceEngine] Insights error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  console.log(`[ConsequenceEngine] Routes registered (${getConfig().isPrivate ? 'PRIVATE' : 'PUBLIC'} mode, ${getConfig().domains.length} domains, bootstrap=${isBootstrapActive() ? 'ACTIVE' : 'OFF'})`);
}
