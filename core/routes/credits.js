/**
 * Credit system endpoints
 * /api/credits — balance, transactions, consume, monthly-reset
 */
import { randomUUID } from 'crypto';
import { MONTHLY_CREDITS } from '../config/index.js';

export function registerCreditRoutes(ctx) {
  const { app, db, stmts, requireAuth, sendError } = ctx;

  // ── GET /api/credits/balance — current credit balances ──
  app.get('/api/credits/balance', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const now = Date.now();

      // Clean up expired credits first
      stmts.deleteExpiredCredits.run(now);

      const rows = stmts.getCreditBalance.all(userId, now);
      const balance = {};
      for (const row of rows) {
        balance[row.credit_type] = row.total;
      }

      // Fill in zeros for missing credit types
      const allTypes = ['chat', 'tbwo_standard', 'tbwo_premium', 'tbwo_ultra', 'image', 'video', 'site_hosting', 'priority_queue'];
      for (const t of allTypes) {
        if (!(t in balance)) balance[t] = 0;
      }

      // Include plan allocation for reference
      const plan = req.user.isAdmin ? 'agency' : (req.user.plan || 'free');
      const allocation = MONTHLY_CREDITS[plan] || MONTHLY_CREDITS.free;

      res.json({ success: true, balance, plan, allocation });
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

  // ── POST /api/credits/consume — deduct credits (requireAuth + internal check) ──
  app.post('/api/credits/consume', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { creditType, amount, description, referenceId } = req.body;

      if (!creditType || !amount || amount <= 0) {
        return res.status(400).json({ error: 'creditType and positive amount required' });
      }

      const now = Date.now();

      // Check plan allocation — -1 means unlimited
      const plan = req.user.isAdmin ? 'agency' : (req.user.plan || 'free');
      const allocation = MONTHLY_CREDITS[plan] || MONTHLY_CREDITS.free;
      if (allocation[creditType] === -1) {
        // Unlimited — record transaction but don't deduct
        stmts.insertCreditTransaction.run(
          randomUUID(), userId, creditType, -amount, -1,
          description || `Consumed ${amount} ${creditType}`,
          referenceId || null, now
        );
        return res.json({ success: true, remaining: -1, unlimited: true });
      }

      // Check current balance
      const balanceRow = stmts.getCreditByType.get(userId, creditType, now);
      const currentBalance = balanceRow?.total || 0;

      if (currentBalance < amount) {
        return res.status(402).json({
          error: 'Insufficient credits',
          creditType,
          required: amount,
          available: currentBalance,
          plan,
          code: 'INSUFFICIENT_CREDITS',
        });
      }

      // Deduct from subscription credits first, then purchase, then bonus
      const sources = ['subscription', 'purchase', 'bonus'];
      let remaining = amount;

      const deductTxn = db.transaction(() => {
        for (const source of sources) {
          if (remaining <= 0) break;
          const result = stmts.decrementCredit.run(remaining, userId, creditType, source, remaining);
          if (result.changes > 0) {
            remaining = 0;
          } else {
            // Try partial deduction — get current amount for this source
            const row = db.prepare(
              'SELECT amount FROM user_credits WHERE user_id=? AND credit_type=? AND source=? AND amount > 0'
            ).get(userId, creditType, source);
            if (row && row.amount > 0) {
              const deduct = Math.min(row.amount, remaining);
              db.prepare(
                'UPDATE user_credits SET amount = amount - ? WHERE user_id=? AND credit_type=? AND source=?'
              ).run(deduct, userId, creditType, source);
              remaining -= deduct;
            }
          }
        }

        // Get new balance
        const newBalanceRow = stmts.getCreditByType.get(userId, creditType, now);
        const newBalance = newBalanceRow?.total || 0;

        // Record transaction
        stmts.insertCreditTransaction.run(
          randomUUID(), userId, creditType, -amount, newBalance,
          description || `Consumed ${amount} ${creditType}`,
          referenceId || null, now
        );

        return newBalance;
      });

      const newBalance = deductTxn();

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

          // Delete old subscription credits for this user
          stmts.deleteSubscriptionCredits.run(user.id, 'subscription');

          // Insert fresh subscription credits
          for (const [creditType, amount] of Object.entries(allocation)) {
            if (amount === 0) continue; // Don't create zero-credit rows
            stmts.upsertCredit.run(
              user.id, creditType, amount === -1 ? 999999 : amount,
              'subscription', null, now
            );

            // Record the reset transaction
            stmts.insertCreditTransaction.run(
              randomUUID(), user.id, creditType, amount === -1 ? 999999 : amount,
              amount === -1 ? 999999 : amount,
              `Monthly reset (${plan} plan)`,
              null, now
            );
          }

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
