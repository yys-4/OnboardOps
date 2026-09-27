/**
 * Error reproduction endpoints — deliberately trigger known failure patterns.
 * Used by OnboardOps to demonstrate incidents and test observability.
 *
 * NEVER enable in production (gated by ENABLE_ERROR_ENDPOINTS=true).
 */
import { Router } from 'express';
import { db } from '../db/client';
import { logger } from '../telemetry/logger';

export const errorReprodRouter = Router();

// ── 1. Memory Leak ────────────────────────────────────────────────────────
// Simulates a leak where objects accumulate in a closure
const leakBucket: Buffer[] = [];

errorReprodRouter.post('/memory-leak', (req, res) => {
  const mb = Number(req.query.mb ?? 10);
  const buf = Buffer.alloc(mb * 1024 * 1024, 'x');
  leakBucket.push(buf);
  logger.warn({ heapUsed: process.memoryUsage().heapUsed, leaked_mb: mb }, 'Memory leak triggered');
  res.json({
    scenario: 'memory_leak',
    allocated_mb: mb,
    total_leaked_mb: leakBucket.reduce((s, b) => s + b.length, 0) / 1_048_576,
    heap_used_mb: process.memoryUsage().heapUsed / 1_048_576,
  });
});

errorReprodRouter.delete('/memory-leak', (_req, res) => {
  const freed = leakBucket.reduce((s, b) => s + b.length, 0);
  leakBucket.length = 0;
  res.json({ freed_mb: freed / 1_048_576 });
});

// ── 2. N+1 Query ──────────────────────────────────────────────────────────
// Classic ORM anti-pattern: query for each row instead of JOIN

errorReprodRouter.get('/n-plus-one', async (_req, res, next) => {
  try {
    const start = Date.now();
    const orders = await db('orders').limit(20);

    // N+1: one query per order to get user — intentionally bad
    const result = await Promise.all(
      orders.map(async (o) => {
        const user = await db('users').where({ id: o.user_id }).first();
        const items = await db('order_items').where({ order_id: o.id });
        return { ...o, user, items };
      })
    );

    const duration = Date.now() - start;
    logger.warn({ query_count: 1 + orders.length * 2, duration_ms: duration }, 'N+1 query triggered');

    res.json({
      scenario: 'n_plus_one',
      order_count: orders.length,
      query_count: 1 + orders.length * 2,
      duration_ms: duration,
      data: result,
    });
  } catch (err) { next(err); }
});

// Fixed version for comparison
errorReprodRouter.get('/n-plus-one/fixed', async (_req, res, next) => {
  try {
    const start = Date.now();
    const orders = await db('orders as o')
      .join('users as u', 'o.user_id', 'u.id')
      .leftJoin('order_items as oi', 'o.id', 'oi.order_id')
      .select('o.*', 'u.email', 'u.name as user_name')
      .limit(20);

    const duration = Date.now() - start;
    res.json({ scenario: 'n_plus_one_fixed', query_count: 1, duration_ms: duration, data: orders });
  } catch (err) { next(err); }
});

// ── 3. Timeout Cascade ────────────────────────────────────────────────────
// Simulates a downstream service timing out, cascading to caller

errorReprodRouter.get('/timeout', async (req, res) => {
  const delay = Number(req.query.delay_ms ?? 5000);
  const abort = Number(req.query.timeout_ms ?? 3000);

  logger.warn({ delay_ms: delay, timeout_ms: abort }, 'Timeout cascade triggered');

  const result = await Promise.race([
    new Promise<string>((resolve) => setTimeout(() => resolve('success'), delay)),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('Downstream timeout after ' + abort + 'ms')), abort)
    ),
  ]).catch((err: Error) => ({ error: err.message }));

  if (typeof result === 'object' && 'error' in result) {
    return res.status(504).json({ scenario: 'timeout_cascade', ...result, delay_ms: delay, timeout_ms: abort });
  }
  res.json({ scenario: 'timeout_cascade', result, delay_ms: delay });
});

// ── 4. Unhandled Promise Rejection (caught at process level) ──────────────

errorReprodRouter.post('/unhandled-rejection', (_req, res) => {
  // Fire-and-forget promise that rejects
  Promise.reject(new Error('Simulated unhandled rejection from error-reprod endpoint'))
    .catch((err) => {
      logger.error({ err }, 'Caught simulated unhandled rejection');
    });

  res.json({ scenario: 'unhandled_rejection', message: 'Rejection fired — check logs' });
});

// ── 5. High CPU Spike ─────────────────────────────────────────────────────

errorReprodRouter.post('/cpu-spike', (req, res) => {
  const duration_ms = Number(req.query.duration_ms ?? 2000);
  logger.warn({ duration_ms }, 'CPU spike triggered');

  const start = Date.now();
  // Busy-loop — blocks event loop intentionally
  while (Date.now() - start < duration_ms) {
    Math.sqrt(Math.random() * 1e10);
  }

  res.json({ scenario: 'cpu_spike', duration_ms, actual_ms: Date.now() - start });
});

// ── 6. DB Connection Exhaustion ───────────────────────────────────────────
// Hold connections in parallel until pool exhausted

errorReprodRouter.post('/pool-exhaustion', async (req, res, next) => {
  const connections = Number(req.query.connections ?? 15);
  const hold_ms = Number(req.query.hold_ms ?? 3000);

  logger.warn({ connections, hold_ms }, 'Pool exhaustion triggered');

  try {
    const start = Date.now();
    await Promise.all(
      Array.from({ length: connections }, () =>
        db.raw('SELECT pg_sleep(?)', [hold_ms / 1000])
          .timeout(hold_ms + 1000)
          .catch((e: Error) => ({ error: e.message }))
      )
    );
    res.json({ scenario: 'pool_exhaustion', connections, hold_ms, duration_ms: Date.now() - start });
  } catch (err) { next(err); }
});

// ── 7. Slow query ─────────────────────────────────────────────────────────

errorReprodRouter.get('/slow-query', async (req, res, next) => {
  const sleep_s = Number(req.query.sleep_s ?? 3);
  try {
    const start = Date.now();
    await db.raw('SELECT pg_sleep(?)', [sleep_s]);
    res.json({ scenario: 'slow_query', sleep_s, actual_ms: Date.now() - start });
  } catch (err) { next(err); }
});

// ── Scenario index ────────────────────────────────────────────────────────

errorReprodRouter.get('/', (_req, res) => {
  res.json({
    scenarios: [
      { id: 'memory_leak',      method: 'POST', path: '/api/debug/memory-leak?mb=10',        description: 'Allocate N MB into leak bucket' },
      { id: 'memory_free',      method: 'DELETE', path: '/api/debug/memory-leak',             description: 'Free leaked memory' },
      { id: 'n_plus_one',       method: 'GET',  path: '/api/debug/n-plus-one',               description: 'N+1 query pattern (bad)' },
      { id: 'n_plus_one_fixed', method: 'GET',  path: '/api/debug/n-plus-one/fixed',         description: 'N+1 pattern fixed with JOIN' },
      { id: 'timeout',          method: 'GET',  path: '/api/debug/timeout?delay_ms=5000',    description: 'Downstream timeout cascade' },
      { id: 'unhandled',        method: 'POST', path: '/api/debug/unhandled-rejection',      description: 'Fire unhandled promise rejection' },
      { id: 'cpu_spike',        method: 'POST', path: '/api/debug/cpu-spike?duration_ms=2000', description: 'Block event loop (CPU spike)' },
      { id: 'pool_exhaustion',  method: 'POST', path: '/api/debug/pool-exhaustion',          description: 'Exhaust DB connection pool' },
      { id: 'slow_query',       method: 'GET',  path: '/api/debug/slow-query?sleep_s=3',     description: 'Trigger slow PostgreSQL query' },
    ],
  });
});
