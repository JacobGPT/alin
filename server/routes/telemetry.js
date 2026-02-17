/**
 * Telemetry + Webhook/Contact endpoints
 * /api/telemetry/* — event, tool, conversation, feedback
 * /api/webhook/email — email webhook
 * /api/contact — contact form
 */
import { randomUUID } from 'crypto';
import express from 'express';

export function registerTelemetryRoutes(ctx) {
  const { app, db, requireAuth, resend } = ctx;

  // Log generic telemetry event
  app.post('/api/telemetry/event', requireAuth, (req, res) => {
    try {
      const { eventType, eventData, sessionId } = req.body;
      if (!eventType) return res.status(400).json({ error: 'eventType required' });
      db.prepare(`
        INSERT INTO telemetry_events (user_id, session_id, event_type, event_data)
        VALUES (?, ?, ?, ?)
      `).run(req.user.id, sessionId || null, eventType, JSON.stringify(eventData || {}));
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Log tool usage telemetry
  app.post('/api/telemetry/tool', requireAuth, (req, res) => {
    try {
      const { conversationId, toolName, success, durationMs, errorMessage, sessionId } = req.body;
      db.prepare(`
        INSERT INTO telemetry_tool_usage (id, user_id, session_id, conversation_id, tool_name, success, duration_ms, error_message, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), req.user.id, sessionId || '', conversationId || '', toolName || '', success ? 1 : 0, durationMs || 0, errorMessage || null, Date.now());
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Log conversation summary telemetry
  app.post('/api/telemetry/conversation', requireAuth, (req, res) => {
    try {
      const { conversationId, model, mode, messageCount, toolCalls, inputTokens, outputTokens, duration, sessionId } = req.body;
      db.prepare(`
        INSERT INTO telemetry_conversations (user_id, conversation_id, model_used, mode, message_count, tool_calls_count, total_input_tokens, total_output_tokens, duration_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.user.id, conversationId || '', model || 'unknown', mode || 'regular', messageCount || 0, toolCalls || 0, inputTokens || 0, outputTokens || 0, duration || 0);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Log feedback (thumbs up/down, corrections)
  app.post('/api/telemetry/feedback', requireAuth, (req, res) => {
    try {
      const { conversationId, messageId, feedbackType,
              originalResponse, correctedResponse } = req.body;
      db.prepare(`
        INSERT INTO telemetry_feedback
          (user_id, conversation_id, message_id, feedback_type,
           original_response, corrected_response)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(req.user.id, conversationId, messageId, feedbackType,
             originalResponse || null, correctedResponse || null);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Email webhook
  app.post('/api/webhook/email', express.json(), (req, res) => {
    const event = req.body;

    if (event.type === 'email.received') {
      const { from, to, subject, text, html } = event.data;

      if (to.some(addr => addr.includes('help@'))) {
        console.log(`[Webhook] Support email from ${from}: ${subject}`);

        resend.emails.send({
          from: 'noreply@alinai.dev',
          to: from,
          subject: `Re: ${subject}`,
          text: 'Thanks for reaching out! We received your message and will respond shortly.'
        }).catch(err => console.error('[Webhook] Auto-reply failed:', err.message));
      }
    }

    res.json({ received: true });
  });

  // Contact form
  app.post('/api/contact', express.json(), async (req, res) => {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !message)
      return res.status(400).json({ error: 'Name, email, and message required.' });

    try {
      await resend.emails.send({
        from: 'ALIN Contact <noreply@alinai.dev>',
        to: 'jacobbeach2@icloud.com',
        replyTo: email,
        subject: `[${subject}] from ${name}`,
        text: `From: ${name} <${email}>\nSubject: ${subject}\n\n${message}`
      });
      res.json({ success: true });
    } catch (err) {
      console.error('[Contact] Failed to send:', err.message);
      res.status(500).json({ error: 'Failed to send message.' });
    }
  });
}
