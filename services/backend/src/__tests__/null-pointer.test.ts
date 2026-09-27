/**
 * Test suite: Null Pointer — order.metadata null dereference
 *
 * SCENARIO: PATCH /api/orders/:id/status on an order with metadata=NULL
 * throws TypeError when code tries to read order.metadata.notify.
 *
 * FAILING STATE (before patch): no null-guard on metadata.
 * PASSING STATE (after patch): `const metadata = order.metadata ?? {}`.
 *
 * Also tests the missing ownership check: developer role can currently
 * update any user's order status — only viewer is blocked.
 */

import { describe, it, expect } from 'vitest';
import {
  NULL_POINTER_FIXTURE,
} from '../fix-hub/incident-fixtures';
import {
  parseStackTrace,
  extractSuspectFiles,
} from '../fix-hub/stack-trace-parser';
import {
  getPatchForErrorType,
} from '../fix-hub/patch-engine';

// ── Minimal representations of the domain types used in the route ──────────

interface MockOrder {
  id: string;
  user_id: string;
  status: string;
  metadata: Record<string, unknown> | null;
}

interface MockUser {
  sub: string;
  role: 'admin' | 'developer' | 'viewer';
}

// ── Simulated route handlers (before / after patch) ────────────────────────

/**
 * BUGGY handler: reads metadata.notify without null-guard.
 * Also lacks ownership check for developer role.
 */
function patchOrderStatusBuggy(
  order: MockOrder,
  user: MockUser,
  newStatus: string,
): { status: number; body: unknown } {
  if (user.role === 'viewer') {
    return { status: 403, body: { error: 'Viewers cannot update orders' } };
  }

  // BUG: no ownership check for developer
  // BUG: order.metadata may be null
  const notify = (order.metadata as any).notify; // ← throws TypeError when metadata=null

  const updated = { ...order, status: newStatus, notify };
  return { status: 200, body: { data: updated } };
}

/**
 * FIXED handler: null-guards metadata, adds ownership check.
 */
function patchOrderStatusFixed(
  order: MockOrder,
  user: MockUser,
  newStatus: string,
): { status: number; body: unknown } {
  if (user.role === 'viewer') {
    return { status: 403, body: { error: 'Viewers cannot update orders' } };
  }

  // FIXED: ownership check for non-admins
  if (user.role !== 'admin' && order.user_id !== user.sub) {
    return { status: 403, body: { error: 'Access denied' } };
  }

  // FIXED: null-guard on metadata
  const metadata = order.metadata ?? {};
  const notify = (metadata as any).notify ?? null;

  const updated = { ...order, status: newStatus, notify };
  return { status: 200, body: { data: updated } };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('null-pointer', () => {
  describe('stack trace parsing', () => {
    it('correctly identifies TypeError as null_pointer pattern', () => {
      const parsed = parseStackTrace(NULL_POINTER_FIXTURE.stack_trace);
      expect(parsed.error_class).toBe('TypeError');
      expect(parsed.detected_patterns).toContain('null_pointer');
    });

    it('primary frame points to orders.ts', () => {
      const parsed = parseStackTrace(NULL_POINTER_FIXTURE.stack_trace);
      expect(parsed.primary_frame?.file).toContain('orders.ts');
      expect(parsed.primary_frame?.line).toBe(142);
    });

    it('extractSuspectFiles returns orders.ts first', () => {
      const parsed = parseStackTrace(NULL_POINTER_FIXTURE.stack_trace);
      const suspects = extractSuspectFiles(parsed);
      expect(suspects[0]).toContain('orders.ts');
    });
  });

  describe('patch engine', () => {
    it('returns high-confidence patch for null_pointer', () => {
      const patch = getPatchForErrorType('null_pointer');
      expect(patch).not.toBeNull();
      expect(patch!.confidence).toBe('high');
    });
  });

  describe('PATCH status with null metadata should not throw TypeError', () => {
    const orderWithNullMetadata: MockOrder = {
      id: 'ord-xyz-789',
      user_id: 'other-user',
      status: 'confirmed',
      metadata: null,   // ← the problematic value
    };

    const devUser: MockUser = { sub: 'dev-user-1', role: 'developer' };
    const adminUser: MockUser = { sub: 'admin-1', role: 'admin' };

    it('[BEFORE PATCH] null metadata throws TypeError', () => {
      expect(() =>
        patchOrderStatusBuggy(orderWithNullMetadata, devUser, 'shipped'),
      ).toThrow(TypeError);
    });

    it('[AFTER PATCH] null metadata is safe — no throw, returns 200 for admin', () => {
      const result = patchOrderStatusFixed(orderWithNullMetadata, adminUser, 'shipped');
      expect(result.status).toBe(200);
    });

    it('[AFTER PATCH] developer cannot update another user\'s order → 403', () => {
      const result = patchOrderStatusFixed(orderWithNullMetadata, devUser, 'shipped');
      expect(result.status).toBe(403);
      expect((result.body as any).error).toBe('Access denied');
    });

    it('[AFTER PATCH] developer can update own order → 200', () => {
      const ownOrder: MockOrder = {
        ...orderWithNullMetadata,
        user_id: devUser.sub,
      };
      const result = patchOrderStatusFixed(ownOrder, devUser, 'shipped');
      expect(result.status).toBe(200);
    });

    it('[AFTER PATCH] viewer is still blocked regardless of ownership', () => {
      const viewer: MockUser = { sub: 'viewer-1', role: 'viewer' };
      const ownOrder: MockOrder = {
        ...orderWithNullMetadata,
        user_id: viewer.sub,
      };
      const result = patchOrderStatusFixed(ownOrder, viewer, 'shipped');
      expect(result.status).toBe(403);
    });
  });
});
