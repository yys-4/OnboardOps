/**
 * Test setup: stub out OTel SDK so it doesn't try to connect during tests.
 * Also stub process.env defaults needed by config/env.ts.
 */
import { vi } from 'vitest';

// Prevent OTel SDK from loading / connecting in test environment
vi.mock('../telemetry/instrumentation', () => ({}));
vi.mock('../telemetry/metrics', () => ({
  metricsMiddleware: (_req: any, _res: any, next: () => void) => next(),
  orderCounter: { add: vi.fn() },
  orderValueHistogram: { record: vi.fn() },
  activeOrdersGauge: { addCallback: vi.fn() },
  httpRequestDuration: { record: vi.fn() },
  dbQueryDuration: { record: vi.fn() },
}));

// Required env vars for config/env.ts Zod schema
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://onboardops:password@localhost:5432/onboardops_test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-minimum-32-characters!!';
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317';
process.env.PAYMENT_GATEWAY_URL = 'http://mock-gateway.test/v1/charge';
process.env.PAYMENT_GATEWAY_TIMEOUT_MS = '500';
