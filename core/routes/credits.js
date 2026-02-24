/**
 * Credit system endpoints — unified single-pool credits
 * /api/credits — balance, transactions, consume, monthly-reset
 */
import { randomUUID } from 'crypto';
import { MONTHLY_CREDITS } from '../config/index.js';
import { deductCredits, getCreditBalance } from '../services/creditService.js';

export function registerCreditRoutes(ctx) {
  const { app, db, stmts, requireAuth, sendError } = ctx;

  // ── GET /api/credits/balance — current unified credit balance ──
  app.get('/api/credits/balance', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const plan = req.user.isAdmin ? 'agency' : (req.user.plan || 'free');
      const allocation = MONTHLY_CREDITS[plan] || MONTHLY_CREDITS.free;
      const balance = getCreditBalance(stmts, userId);

      res.json({ success: true, balance, allocation: allocation.credits, plan });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // ── GET /api/credits/transactions — paginated transaction history ──
  app.get('/api/credits/transactions', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = parseInt(req.query.offset) || 0;
      const creditType = req.query.type;

      let rows;
      if (creditType) {
        rows = stmts.listCreditTransactionsByType.all(userId, creditType, limit);
      } else {
        rows = stmts.listCreditTransactions.all(userId, limit, offset);
      }

      res.json({ success: true, transactions: rows, limit, offset });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // ── POST /api/credits/consume — deduct credits from unified pool ──
  app.post('/api/credits/consume', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { amount, description, referenceId } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Positive amount required' });
      }

      const plan = req.user.isAdmin ? 'agency' : (req.user.plan || 'free');
      const allocation = MONTHLY_CREDITS[plan] || MONTHLY_CREDITS.free;

      // Unlimited plan — record transaction but don't deduct
      if (allocation.credits === -1) {
        const now = Date.now();
        stmts.insertCreditTransaction.run(
          randomUUID(), userId, 'credits', -amount, -1,
          description || `Consumed ${amount} credits`,
          referenceId || null, now
        );
        return res.json({ success: true, remaining: -1, unlimited: true });
      }

      // Check balance
      const balance = getCreditBalance(stmts, userId);
      if (balance < amount) {
        return res.status(402).json({
          error: 'Insufficient credits',
          required: amount,
          available: balance,
          plan,
          code: 'INSUFFICIENT_CREDITS',
        });
      }

      const newBalance = deductCredits(db, stmts, userId, amount,
        description || `Consumed ${amount} credits`, referenceId);

      res.json({ success: true, remaining: newBalance, consumed: amount });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // ── POST /api/credits/monthly-reset — admin: reset subscription credits to plan allocation ──
  app.post('/api/credits/monthly-reset', requireAuth, (req, res) => {
    try {
      if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const now = Date.now();
      const users = stmts.listAllUsers.all();
      let resetCount = 0;

      const resetTxn = db.transaction(() => {
        for (const user of users) {
          const plan = user.plan || 'free';
          const allocation = MONTHLY_CREDITS[plan];
          if (!allocation) continue;

          const amount = allocation.credits;
          if (amount === 0) continue;

          // Delete old subscription credits for this user
          stmts.deleteSubscriptionCredits.run(user.id, 'subscription');

          // Insert fresh subscription credits (single type)
          stmts.upsertCredit.run(
            user.id, 'credits', amount === -1 ? 999999 : amount,
            'subscription', null, now
          );

          // Record the reset transaction
          stmts.insertCreditTransaction.run(
            randomUUID(), user.id, 'credits', amount === -1 ? 999999 : amount,
            amount === -1 ? 999999 : amount,
            `Monthly reset (${plan} plan)`,
            null, now
          );

          resetCount++;
        }
      });

      resetTxn();

      res.json({ success: true, usersReset: resetCount, timestamp: now });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });
}
