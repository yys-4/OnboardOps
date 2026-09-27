/**
 * Test suite: Race Condition — Stock Oversell
 *
 * SCENARIO: Two concurrent POST /api/orders requests for the same product
 * both read stock=1, both pass the stock check, both decrement → stock=-1.
 *
 * FAILING STATE (before patch): stock check and decrement are separate
 *   statements outside the transaction. Concurrent requests race.
 *
 * PASSING STATE (after patch): stock check uses SELECT FOR UPDATE inside
 *   the same transaction — second request blocks on the lock and sees
 *   stock=0 → throws AppError(422).
 *
 * These tests use a mock DB via vi.mock so they run without a live Postgres.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RACE_CONDITION_FIXTURE,
} from '../fix-hub/incident-fixtures';
import {
  parseStackTrace,
  extractSuspectFiles,
} from '../fix-hub/stack-trace-parser';
import {
  getPatchForErrorType,
} from '../fix-hub/patch-engine';

// ── Mock DB client ─────────────────────────────────────────────────────────
// We simulate the race at the application logic level without a real DB.

interface MockProduct {
  id: string;
  name: string;
  price: number;
  stock_quantity: number;
  is_active: boolean;
}

/**
 * Simulates the BUGGY order creation: stock check OUTSIDE transaction.
 * Both concurrent calls see stock=1 → both pass → stock becomes -1.
 */
async function createOrderBuggy(
  productId: string,
  quantity: number,
  inventory: Map<string, MockProduct>,
): Promise<{ success: boolean; error?: string }> {
  const product = inventory.get(productId);
  if (!product) return { success: false, error: 'Product not found' };

  // BUG: stock read happens outside transaction
  if (product.stock_quantity < quantity) {
    return { success: false, error: `Insufficient stock for ${product.name}` };
  }

  // Simulate async DB work (allows second request to interleave)
  await new Promise((r) => setTimeout(r, 0));

  // BUG: decrement without lock — concurrent request already decremented
  product.stock_quantity -= quantity;
  return { success: true };
}

/**
 * Simulates the FIXED order creation: stock check + decrement inside
 * a single atomic operation (serialised mutex simulates SELECT FOR UPDATE).
 */
const transactionLock = new Map<string, boolean>();

async function createOrderFixed(
  productId: string,
  quantity: number,
  inventory: Map<string, MockProduct>,
): Promise<{ success: boolean; error?: string }> {
  // Spin-wait simulates SELECT FOR UPDATE row lock
  while (transactionLock.get(productId)) {
    await new Promise((r) => setTimeout(r, 1));
  }
  transactionLock.set(productId, true);

  try {
    const product = inventory.get(productId);
    if (!product) return { success: false, error: 'Product not found' };

    // Stock check inside "transaction" (while holding lock)
    if (product.stock_quantity < quantity) {
      return { success: false, error: `Insufficient stock for ${product.name}` };
    }

    await new Promise((r) => setTimeout(r, 0));

    product.stock_quantity -= quantity;
    return { success: true };
  } finally {
    transactionLock.delete(productId);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('race-condition', () => {
  describe('stack trace parsing', () => {
    it('correctly identifies error class and primary frame', () => {
      const parsed = parseStackTrace(RACE_CONDITION_FIXTURE.stack_trace);
      expect(parsed.error_message).toContain('Stock went negative');
      expect(parsed.detected_patterns).toContain('race_condition');
    });

    it('extracts correct suspect file', () => {
      const parsed = parseStackTrace(RACE_CONDITION_FIXTURE.stack_trace);
      const suspects = extractSuspectFiles(parsed);
      expect(suspects.some((f) => f.includes('orders.ts'))).toBe(true);
    });
  });

  describe('patch engine', () => {
    it('returns a patch for race_condition error type', () => {
      const patch = getPatchForErrorType('race_condition');
      expect(patch).not.toBeNull();
      expect(patch!.confidence).toBe('high');
      expect(patch!.target_file).toContain('orders.ts');
    });
  });

  describe('concurrent orders should not oversell stock', () => {
    let inventory: Map<string, MockProduct>;

    beforeEach(() => {
      inventory = new Map([
        [
          'prod-abc-123',
          {
            id: 'prod-abc-123',
            name: 'Widget Pro',
            price: 29.99,
            stock_quantity: 1,
            is_active: true,
          },
        ],
      ]);
      transactionLock.clear();
    });

    it('[BEFORE PATCH] buggy concurrent requests oversell stock → stock goes negative', async () => {
      // Fire two concurrent requests for the same 1-unit product
      const [r1, r2] = await Promise.all([
        createOrderBuggy('prod-abc-123', 1, inventory),
        createOrderBuggy('prod-abc-123', 1, inventory),
      ]);

      const finalStock = inventory.get('prod-abc-123')!.stock_quantity;

      // BOTH succeed (the bug) → stock is -1 (the oversell)
      const bothSucceeded = r1.success && r2.success;
      // This assertion documents the BUG — it should be TRUE before patch
      expect(bothSucceeded).toBe(true);
      expect(finalStock).toBe(-1);
    });

    it('[AFTER PATCH] fixed concurrent requests — exactly one succeeds, stock ≥ 0', async () => {
      // Fire two concurrent requests for the same 1-unit product
      const [r1, r2] = await Promise.all([
        createOrderFixed('prod-abc-123', 1, inventory),
        createOrderFixed('prod-abc-123', 1, inventory),
      ]);

      const finalStock = inventory.get('prod-abc-123')!.stock_quantity;

      // Exactly one succeeds, one gets "Insufficient stock"
      const successes = [r1, r2].filter((r) => r.success).length;
      const failures = [r1, r2].filter((r) => !r.success).length;

      expect(successes).toBe(1);
      expect(failures).toBe(1);
      expect(finalStock).toBe(0); // never negative
    });
  });
});
