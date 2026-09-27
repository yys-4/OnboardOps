import { Router } from 'express';
import { db } from '../db/client';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const checks: Record<string, 'ok' | 'fail'> = {
    db: 'fail',
  };

  try {
    await db.raw('SELECT 1');
    checks.db = 'ok';
  } catch { /* leave as fail */ }

  const healthy = Object.values(checks).every(v => v === 'ok');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get('/ready', (_req, res) => res.json({ ready: true }));
