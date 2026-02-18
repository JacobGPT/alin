/**
 * Proactive Intelligence — Background Intelligence Layer
 *
 * 4 Subsystems:
 *   1. Product Pulse       — track error_rate, tool_success, conversation_count
 *   2. User Rhythm Engine  — activity heatmap, mode preferences, session patterns
 *   3. Self-Awareness      — accuracy drift, tool failure clustering, overconfidence
 *   4. Alert Engine        — threshold-based alerts from metrics + awareness data
 *
 * Master Scheduler: checks scheduler_jobs every 30s, runs due collectors.
 * Event Bus: ctx.proactiveEventBus (in-memory EventEmitter) for subsystem comms.
 *
 * Private-only: mounted ONLY in private/server.js.
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

export function registerProactiveIntelligenceRoutes(ctx) {
  const { app, stmts, db, requireAuth } = ctx;
  const config = ctx.proactiveConfig || { enabled: true };

  // ── Event Bus ──
  ctx.proactiveEventBus = new EventEmitter();
  ctx.proactiveEventBus.setMaxListeners(20);

  // System user for private mode (single user)
  const SYSTEM_USER_ID = 'local-user';

  // ── Helpers ──

  function safeJsonParse(str, fallback = {}) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  function humanInterval(ms) {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  }

  // ========================================================================
  // SUBSYSTEM 1: Product Pulse — Collect Product Metrics
  // ========================================================================

  function collectProductMetrics(userId) {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const results = [];

    // 1. Conversation count (last hour)
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM conversations WHERE user_id=? AND updated_at>?').get(userId, oneHourAgo);
      const value = row?.count || 0;
      stmts.insertProductMetric.run(randomUUID(), 'conversation_count', value, '{}', now, userId);
      results.push({ type: 'conversation_count', value });
    } catch (e) {
      console.warn('[ProactiveIntel] conversation_count error:', e.message);
    }

    // 2. Error rate (from consequence engine outcomes)
    try {
      const total = db.prepare('SELECT COUNT(*) as count FROM outcomes WHERE user_id=? AND created_at>?').get(userId, oneHourAgo);
      const wrong = db.prepare("SELECT COUNT(*) as count FROM outcomes WHERE user_id=? AND created_at>? AND result='verified_wrong'").get(userId, oneHourAgo);
      const totalCount = total?.count || 0;
      const wrongCount = wrong?.count || 0;
      const errorRate = totalCount > 0 ? wrongCount / totalCount : 0;
      stmts.insertProductMetric.run(randomUUID(), 'error_rate', errorRate, JSON.stringify({ total: totalCount, wrong: wrongCount }), now, userId);
      results.push({ type: 'error_rate', value: errorRate });
    } catch (e) {
      console.warn('[ProactiveIntel] error_rate error:', e.message);
    }

    // 3. Tool success rate (from consequence engine outcomes with tool_result trigger)
    try {
      const totalTools = db.prepare("SELECT COUNT(*) as count FROM outcomes WHERE user_id=? AND created_at>? AND trigger_type='tool_result'").get(userId, oneHourAgo);
      const correctTools = db.prepare("SELECT COUNT(*) as count FROM outcomes WHERE user_id=? AND created_at>? AND trigger_type='tool_result' AND result='verified_correct'").get(userId, oneHourAgo);
      const totalCount = totalTools?.count || 0;
      const correctCount = correctTools?.count || 0;
      const successRate = totalCount > 0 ? correctCount / totalCount : 1;
      stmts.insertProductMetric.run(randomUUID(), 'tool_success_rate', successRate, JSON.stringify({ total: totalCount, correct: correctCount }), now, userId);
      results.push({ type: 'tool_success_rate', value: successRate });
    } catch (e) {
      console.warn('[ProactiveIntel] tool_success_rate error:', e.message);
    }

    ctx.proactiveEventBus.emit('metric:recorded', { userId, results, timestamp: now });
    return { collected: results.length, results };
  }

  // ========================================================================
  // SUBSYSTEM 2: User Rhythm Engine — Analyze Usage Patterns
  // ========================================================================

  function analyzeUserRhythm(userId) {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    let inserted = 0;

    // 1. Conversation activity by hour/day
    try {
      const convs = db.prepare('SELECT updated_at, mode FROM conversations WHERE user_id=? AND updated_at>? ORDER BY updated_at ASC').all(userId, oneDayAgo);
      let lastTs = 0;

      for (const c of convs) {
        const d = new Date(c.updated_at);
        const hourOfDay = d.getHours();
        const dayOfWeek = d.getDay();

        // Record activity
        stmts.insertUserRhythm.run(randomUUID(), 'activity', 'conversation', dayOfWeek, hourOfDay, c.updated_at, userId);
        inserted++;

        // Record mode usage
        if (c.mode) {
          stmts.insertUserRhythm.run(randomUUID(), 'mode_usage', c.mode, dayOfWeek, hourOfDay, c.updated_at, userId);
          inserted++;
        }

        // Detect session boundaries (gap > 30min = new session)
        if (lastTs > 0 && c.updated_at - lastTs > 30 * 60 * 1000) {
          stmts.insertUserRhythm.run(randomUUID(), 'session_start', 'new_session', dayOfWeek, hourOfDay, c.updated_at, userId);
          inserted++;
        }
        lastTs = c.updated_at;
      }
    } catch (e) {
      console.warn('[ProactiveIntel] analyzeUserRhythm error:', e.message);
    }

    return { inserted };
  }

  // ========================================================================
  // SUBSYSTEM 3: Self-Awareness Monitor
  // ========================================================================

  function runSelfAwareness(userId) {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const entries = [];

    // 1. Prediction accuracy drift: compare last 7d vs all-time
    try {
      const domainTrends = db.prepare(`SELECT domain,
        SUM(CASE WHEN status='verified_correct' AND created_at>? THEN 1 ELSE 0 END) as recent_correct,
        SUM(CASE WHEN status IN ('verified_correct','verified_wrong','verified_partial') AND created_at>? THEN 1 ELSE 0 END) as recent_total,
        SUM(CASE WHEN status='verified_correct' THEN 1 ELSE 0 END) as all_correct,
        SUM(CASE WHEN status IN ('verified_correct','verified_wrong','verified_partial') THEN 1 ELSE 0 END) as all_total
        FROM predictions WHERE user_id=? GROUP BY domain`).all(sevenDaysAgo, sevenDaysAgo, userId);

      for (const d of domainTrends) {
        if (d.all_total < 5 || d.recent_total < 3) continue;
        const allAccuracy = d.all_correct / d.all_total;
        const recentAccuracy = d.recent_correct / d.recent_total;
        const drift = recentAccuracy - allAccuracy;

        if (Math.abs(drift) > 0.1) {
          const severity = Math.abs(drift) > 0.2 ? 'warning' : 'info';
          const direction = drift > 0 ? 'improving' : 'declining';
          const summary = `Prediction accuracy ${direction} in ${d.domain}: ${Math.round(recentAccuracy * 100)}% (7d) vs ${Math.round(allAccuracy * 100)}% (all-time)`;
          stmts.insertSelfAwareness.run(randomUUID(), 'accuracy_drift', severity, summary, JSON.stringify({ domain: d.domain, recentAccuracy, allAccuracy, drift }), d.domain, now, userId);
          entries.push({ type: 'accuracy_drift', severity, summary });
        }
      }
    } catch (e) {
      console.warn('[ProactiveIntel] accuracy drift error:', e.message);
    }

    // 2. Tool failure clustering: group recent wrong outcomes by domain
    try {
      const failClusters = db.prepare("SELECT domain, COUNT(*) as count FROM outcomes WHERE user_id=? AND result='verified_wrong' AND created_at>? GROUP BY domain HAVING count>=3 ORDER BY count DESC").all(userId, sevenDaysAgo);

      for (const cluster of failClusters) {
        const severity = cluster.count >= 5 ? 'warning' : 'info';
        const summary = `Tool failure cluster in ${cluster.domain}: ${cluster.count} wrong outcomes in 7 days`;
        stmts.insertSelfAwareness.run(randomUUID(), 'failure_cluster', severity, summary, JSON.stringify({ domain: cluster.domain, count: cluster.count }), cluster.domain, now, userId);
        entries.push({ type: 'failure_cluster', severity, summary });
      }
    } catch (e) {
      console.warn('[ProactiveIntel] failure cluster error:', e.message);
    }

    // 3. Overconfidence detection: high-confidence predictions that were wrong
    try {
      const overconfident = db.prepare("SELECT COUNT(*) as count FROM predictions WHERE user_id=? AND status='verified_wrong' AND confidence>=0.8 AND created_at>?").get(userId, sevenDaysAgo);
      const highConf = db.prepare("SELECT COUNT(*) as count FROM predictions WHERE user_id=? AND confidence>=0.8 AND status IN ('verified_correct','verified_wrong','verified_partial') AND created_at>?").get(userId, sevenDaysAgo);

      if (highConf?.count >= 5 && overconfident?.count > 0) {
        const overconfRate = overconfident.count / highConf.count;
        if (overconfRate > 0.2) {
          const severity = overconfRate > 0.35 ? 'warning' : 'info';
          const summary = `Overconfidence detected: ${Math.round(overconfRate * 100)}% of high-confidence predictions were wrong (${overconfident.count}/${highConf.count})`;
          stmts.insertSelfAwareness.run(randomUUID(), 'overconfidence', severity, summary, JSON.stringify({ overconfRate, wrong: overconfident.count, total: highConf.count }), null, now, userId);
          entries.push({ type: 'overconfidence', severity, summary });
        }
      }
    } catch (e) {
      console.warn('[ProactiveIntel] overconfidence error:', e.message);
    }

    if (entries.length > 0) {
      ctx.proactiveEventBus.emit('awareness:logged', { userId, entries, timestamp: now });
    }

    return { entries: entries.length };
  }

  // ========================================================================
  // SUBSYSTEM 4: Alert Engine — Threshold Checks
  // ========================================================================

  function checkAlerts(userId) {
    const now = Date.now();
    const alerts = [];

    // 1. Error rate > 0.3
    try {
      const latest = stmts.latestProductMetric.get(userId, 'error_rate');
      if (latest && latest.value > 0.3) {
        const existing = db.prepare("SELECT id FROM product_alerts WHERE user_id=? AND alert_type='high_error_rate' AND acknowledged=0 AND created_at>?").get(userId, now - 30 * 60 * 1000);
        if (!existing) {
          stmts.insertProductAlert.run(randomUUID(), 'high_error_rate', 'warning', 'High error rate detected', `Error rate is ${Math.round(latest.value * 100)}%, above 30% threshold`, 'error_rate', latest.value, 0.3, now, userId);
          alerts.push({ type: 'high_error_rate', severity: 'warning' });
        }
      }
    } catch (e) {
      console.warn('[ProactiveIntel] error rate alert check error:', e.message);
    }

    // 2. Tool success rate < 0.7
    try {
      const latest = stmts.latestProductMetric.get(userId, 'tool_success_rate');
      if (latest && latest.value < 0.7) {
        const existing = db.prepare("SELECT id FROM product_alerts WHERE user_id=? AND alert_type='low_tool_success' AND acknowledged=0 AND created_at>?").get(userId, now - 30 * 60 * 1000);
        if (!existing) {
          stmts.insertProductAlert.run(randomUUID(), 'low_tool_success', 'warning', 'Low tool success rate', `Tool success rate is ${Math.round(latest.value * 100)}%, below 70% threshold`, 'tool_success_rate', latest.value, 0.7, now, userId);
          alerts.push({ type: 'low_tool_success', severity: 'warning' });
        }
      }
    } catch (e) {
      console.warn('[ProactiveIntel] tool success alert check error:', e.message);
    }

    // 3. Confidence drift > 15% downward
    try {
      const driftEntries = db.prepare("SELECT * FROM self_awareness_log WHERE user_id=? AND awareness_type='accuracy_drift' AND recorded_at>? ORDER BY recorded_at DESC LIMIT 1").get(userId, now - 60 * 60 * 1000);
      if (driftEntries) {
        const details = safeJsonParse(driftEntries.details);
        if (details.drift && details.drift < -0.15) {
          const existing = db.prepare("SELECT id FROM product_alerts WHERE user_id=? AND alert_type='accuracy_drift' AND acknowledged=0 AND created_at>?").get(userId, now - 60 * 60 * 1000);
          if (!existing) {
            stmts.insertProductAlert.run(randomUUID(), 'accuracy_drift', 'info', 'Accuracy drift detected', `${details.domain || 'Unknown'} domain accuracy dropped by ${Math.round(Math.abs(details.drift) * 100)}%`, 'accuracy_drift', details.drift, -0.15, now, userId);
            alerts.push({ type: 'accuracy_drift', severity: 'info' });
          }
        }
      }
    } catch (e) {
      console.warn('[ProactiveIntel] accuracy drift alert check error:', e.message);
    }

    // 4. 3+ warning-level self-awareness entries in 1 hour → critical
    try {
      const oneHourAgo = now - 60 * 60 * 1000;
      const warningCount = db.prepare("SELECT COUNT(*) as count FROM self_awareness_log WHERE user_id=? AND severity='warning' AND recorded_at>?").get(userId, oneHourAgo);
      if (warningCount && warningCount.count >= 3) {
        const existing = db.prepare("SELECT id FROM product_alerts WHERE user_id=? AND alert_type='awareness_cluster' AND acknowledged=0 AND created_at>?").get(userId, oneHourAgo);
        if (!existing) {
          stmts.insertProductAlert.run(randomUUID(), 'awareness_cluster', 'critical', 'Multiple self-awareness warnings', `${warningCount.count} warning-level self-awareness entries in the last hour`, null, warningCount.count, 3, now, userId);
          alerts.push({ type: 'awareness_cluster', severity: 'critical' });
        }
      }
    } catch (e) {
      console.warn('[ProactiveIntel] awareness cluster alert check error:', e.message);
    }

    return { alerts: alerts.length };
  }

  // ========================================================================
  // MASTER SCHEDULER
  // ========================================================================

  const handlers = {
    collectProductMetrics,
    analyzeUserRhythm,
    runSelfAwareness,
    checkAlerts,
  };

  // Seed default jobs
  const defaultJobs = [
    { name: 'collect_product_metrics', description: 'Collect error rate, tool success, conversation count', interval_ms: 5 * 60 * 1000, handler: 'collectProductMetrics' },
    { name: 'analyze_user_rhythm', description: 'Analyze user activity patterns and mode preferences', interval_ms: 10 * 60 * 1000, handler: 'analyzeUserRhythm' },
    { name: 'run_self_awareness', description: 'Check accuracy drift, failure clusters, overconfidence', interval_ms: 15 * 60 * 1000, handler: 'runSelfAwareness' },
    { name: 'check_alerts', description: 'Run threshold checks and generate alerts', interval_ms: 5 * 60 * 1000, handler: 'checkAlerts' },
  ];

  const now = Date.now();
  for (const job of defaultJobs) {
    stmts.insertSchedulerJob.run(randomUUID(), job.name, job.description, job.interval_ms, job.handler, now, SYSTEM_USER_ID);
  }

  // Scheduler loop (every 30s)
  const schedulerInterval = setInterval(() => {
    try {
      const jobs = stmts.listSchedulerJobs.all(SYSTEM_USER_ID);
      const runNow = Date.now();

      for (const job of jobs) {
        if (!job.enabled) continue;
        if (job.next_run_at > runNow && job.last_run_at > 0) continue;

        const handler = handlers[job.handler];
        if (!handler) continue;

        const historyId = randomUUID();
        stmts.insertSchedulerHistory.run(historyId, job.id, job.name, runNow, null, null, 'running', '', '', SYSTEM_USER_ID);

        try {
          const result = handler(SYSTEM_USER_ID);
          const duration = Date.now() - runNow;
          stmts.updateSchedulerHistory.run(Date.now(), duration, 'completed', JSON.stringify(result || {}), '', historyId, SYSTEM_USER_ID);
          stmts.updateJobAfterRun.run(runNow, runNow + job.interval_ms, '', job.id, SYSTEM_USER_ID);
        } catch (e) {
          const duration = Date.now() - runNow;
          stmts.updateSchedulerHistory.run(Date.now(), duration, 'failed', '', e.message, historyId, SYSTEM_USER_ID);
          stmts.updateJobError.run(e.message, job.id, SYSTEM_USER_ID);
        }
      }
    } catch (e) {
      console.warn('[ProactiveIntel] Scheduler loop error:', e.message);
    }
  }, 30000);

  // Store interval ref for cleanup
  ctx.proactiveSchedulerInterval = schedulerInterval;

  console.log('[ProactiveIntel] Scheduler started, 4 default jobs seeded');

  // ========================================================================
  // API ENDPOINTS (15 routes, all require auth)
  // ========================================================================

  // 1. GET /api/proactive/status — system status
  app.get('/api/proactive/status', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const jobs = stmts.listSchedulerJobs.all(userId);
      const unackAlerts = stmts.listUnacknowledgedAlerts.all(userId, 100);

      const lastCollectionTimes = {};
      for (const job of jobs) {
        if (job.last_run_at > 0) lastCollectionTimes[job.name] = job.last_run_at;
      }

      res.json({
        enabled: config.enabled !== false,
        jobCount: jobs.length,
        lastCollectionTimes,
        alertCount: unackAlerts.length,
        schedulerActive: true,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 2. GET /api/proactive/metrics — list metrics
  app.get('/api/proactive/metrics', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const type = req.query.type || 'error_rate';
      const since = parseInt(req.query.since) || (Date.now() - 24 * 60 * 60 * 1000);
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);

      const metrics = stmts.listProductMetrics.all(userId, type, since, limit);
      res.json({ metrics });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 3. GET /api/proactive/metrics/latest — latest value per metric type
  app.get('/api/proactive/metrics/latest', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const latest = stmts.listLatestProductMetrics.all(userId, userId);
      res.json({ metrics: latest });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 4. GET /api/proactive/alerts — list alerts
  app.get('/api/proactive/alerts', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const acknowledged = req.query.acknowledged;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);

      let alerts;
      if (acknowledged === '0') {
        alerts = stmts.listUnacknowledgedAlerts.all(userId, limit);
      } else {
        alerts = stmts.listProductAlerts.all(userId, limit);
      }
      res.json({ alerts });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 5. POST /api/proactive/alerts/:id/ack — acknowledge single alert
  app.post('/api/proactive/alerts/:id/ack', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      stmts.acknowledgeAlert.run(req.params.id, userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 6. POST /api/proactive/alerts/ack-all — acknowledge all
  app.post('/api/proactive/alerts/ack-all', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      stmts.acknowledgeAllAlerts.run(userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 7. GET /api/proactive/rhythm — list rhythm data
  app.get('/api/proactive/rhythm', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const type = req.query.type || 'activity';
      const limit = Math.min(parseInt(req.query.limit) || 100, 500);

      const rhythm = stmts.listUserRhythm.all(userId, type, limit);
      res.json({ rhythm });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 8. GET /api/proactive/rhythm/heatmap — 7x24 activity grid
  app.get('/api/proactive/rhythm/heatmap', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const type = req.query.type || 'activity';
      const since = parseInt(req.query.since) || (Date.now() - 30 * 24 * 60 * 60 * 1000);

      const raw = stmts.getUserRhythmHeatmap.all(userId, type, since);

      // Build 7x24 grid
      const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
      for (const r of raw) {
        if (r.day_of_week >= 0 && r.day_of_week < 7 && r.hour_of_day >= 0 && r.hour_of_day < 24) {
          grid[r.day_of_week][r.hour_of_day] = r.count;
        }
      }

      res.json({ heatmap: grid, raw });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 9. GET /api/proactive/rhythm/preferences — top mode/tool preferences
  app.get('/api/proactive/rhythm/preferences', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const type = req.query.type || 'mode_usage';
      const since = parseInt(req.query.since) || (Date.now() - 30 * 24 * 60 * 60 * 1000);
      const limit = Math.min(parseInt(req.query.limit) || 10, 50);

      const preferences = stmts.getUserRhythmPreferences.all(userId, type, since, limit);
      res.json({ preferences });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 10. GET /api/proactive/awareness — self-awareness log
  app.get('/api/proactive/awareness', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const type = req.query.type;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);

      let entries;
      if (type) {
        entries = stmts.listSelfAwarenessByType.all(userId, type, limit);
      } else {
        entries = stmts.listSelfAwareness.all(userId, limit);
      }
      res.json({ entries });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 11. GET /api/proactive/awareness/summary — severity counts + recent critical
  app.get('/api/proactive/awareness/summary', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const since = parseInt(req.query.since) || (Date.now() - 7 * 24 * 60 * 60 * 1000);

      const severityCounts = stmts.countSelfAwarenessBySeverity.all(userId, since);
      const recentCritical = stmts.recentSelfAwarenessBySeverity.all(userId, 'critical', since, 5);
      const recentWarning = stmts.recentSelfAwarenessBySeverity.all(userId, 'warning', since, 5);

      res.json({
        severityCounts,
        recentCritical,
        recentWarning,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 12. GET /api/proactive/scheduler — list all jobs
  app.get('/api/proactive/scheduler', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const jobs = stmts.listSchedulerJobs.all(userId);
      res.json({ jobs });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 13. POST /api/proactive/scheduler/:id/toggle — enable/disable
  app.post('/api/proactive/scheduler/:id/toggle', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const job = stmts.getSchedulerJob.get(req.params.id, userId);
      if (!job) return res.status(404).json({ error: 'Job not found' });

      const newEnabled = job.enabled ? 0 : 1;
      stmts.toggleSchedulerJob.run(newEnabled, req.params.id, userId);
      res.json({ ok: true, enabled: !!newEnabled });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 14. POST /api/proactive/scheduler/:id/run — manual trigger
  app.post('/api/proactive/scheduler/:id/run', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const job = stmts.getSchedulerJob.get(req.params.id, userId);
      if (!job) return res.status(404).json({ error: 'Job not found' });

      const handler = handlers[job.handler];
      if (!handler) return res.status(400).json({ error: 'Unknown handler: ' + job.handler });

      const runNow = Date.now();
      const historyId = randomUUID();
      stmts.insertSchedulerHistory.run(historyId, job.id, job.name, runNow, null, null, 'running', '', '', userId);

      try {
        const result = handler(userId);
        const duration = Date.now() - runNow;
        stmts.updateSchedulerHistory.run(Date.now(), duration, 'completed', JSON.stringify(result || {}), '', historyId, userId);
        stmts.updateJobAfterRun.run(runNow, runNow + job.interval_ms, '', job.id, userId);
        res.json({ ok: true, result, duration });
      } catch (e) {
        const duration = Date.now() - runNow;
        stmts.updateSchedulerHistory.run(Date.now(), duration, 'failed', '', e.message, historyId, userId);
        stmts.updateJobError.run(e.message, job.id, userId);
        res.status(500).json({ error: e.message });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 15. GET /api/proactive/scheduler/:id/history — run history for job
  app.get('/api/proactive/scheduler/:id/history', requireAuth, (req, res) => {
    try {
      const userId = req.userId || SYSTEM_USER_ID;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);

      const history = stmts.listSchedulerHistoryByJob.all(userId, req.params.id, limit);
      res.json({ history });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
