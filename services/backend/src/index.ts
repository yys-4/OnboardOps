// Must be first import — instruments before any other require
import './telemetry/instrumentation';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';

import { logger } from './telemetry/logger';
import { metricsMiddleware } from './telemetry/metrics';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { ordersRouter } from './routes/orders';
import { productsRouter } from './routes/products';
import { errorReprodRouter } from './routes/error-reprod';
import { errorHandler } from './middleware/error-handler';
import { env } from './config/env';

const app = express();

// ── Security ──────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') ?? '*',
  credentials: true,
}));
app.use(compression());

// ── Observability ─────────────────────────────────────────────────────────
app.use(pinoHttp({ logger }));
app.use(metricsMiddleware);

// ── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/products', productsRouter);

// Error reproduction endpoints — gated by feature flag
if (env.ENABLE_ERROR_ENDPOINTS) {
  app.use('/api/debug', errorReprodRouter);
  logger.warn('⚠️  Error reproduction endpoints ENABLED — not for production!');
}

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not Found' }));

// ── Error handler ─────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'OnboardOps backend listening');
});

// Graceful shutdown
const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutdown initiated');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
