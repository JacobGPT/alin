/**
 * Shared Credit Service — unified credit pool deduction logic
 * Used by credits.js, tbwo.js, sites.js
 */
import { randomUUID } from 'crypto';
import { MONTHLY_CREDITS } from '../config/index.js';

export function deductCredits(db, stmts, userId, amount, description, referenceId) {
  const now = Date.now();
  stmts.deleteExpiredCredits.run(now);

  const deductTxn = db.transaction(() => {
    let remaining = amount;
    for (const source of ['subscription', 'purchase', 'bonus']) {
      if (remaining <= 0) break;
      const row = db.prepare(
        'SELECT amount FROM user_credits WHERE user_id=? AND credit_type=? AND source=? AND amount > 0'
      ).get(userId, 'credits', source);
      if (row && row.amount > 0) {
        const deduct = Math.min(row.amount, remaining);
        db.prepare(
          'UPDATE user_credits SET amount = amount - ? WHERE user_id=? AND credit_type=? AND source=?'
        ).run(deduct, userId, 'credits', source);
        remaining -= deduct;
      }
    }
    const newBalance = stmts.getCreditByType.get(userId, 'credits', now)?.total || 0;
    stmts.insertCreditTransaction.run(
      randomUUID(), userId, 'credits', -amount, newBalance,
      description, referenceId || null, now
    );
    return newBalance;
  });
  return deductTxn();
}

export function getCreditBalance(stmts, userId) {
  const now = Date.now();
  const row = stmts.getCreditByType.get(userId, 'credits', now);
  return row?.total || 0;
}

export function checkCredits(stmts, userId, required, plan) {
  const allocation = MONTHLY_CREDITS[plan] || MONTHLY_CREDITS.free;
  if (allocation.credits === -1) return { ok: true, unlimited: true };
  const balance = getCreditBalance(stmts, userId);
  if (balance < required) return { ok: false, balance, required };
  return { ok: true, balance };
}
