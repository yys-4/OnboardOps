import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { metrics } from '@opentelemetry/api';
import type { Request, Response, NextFunction } from 'express';

const meter = metrics.getMeter('onboardops-backend');

// Custom business metrics
export const orderCounter = meter.createCounter('orders_created_total', {
  description: 'Total orders created',
});

export const orderValueHistogram = meter.createHistogram('order_value_usd', {
  description: 'Distribution of order values in USD',
  unit: 'USD',
});

export const activeOrdersGauge = meter.createObservableGauge('orders_active', {
  description: 'Currently active (unshipped) orders',
});

export const httpRequestDuration = meter.createHistogram('http_request_duration_ms', {
  description: 'HTTP request duration',
  unit: 'ms',
});

export const dbQueryDuration = meter.createHistogram('db_query_duration_ms', {
  description: 'DB query duration',
  unit: 'ms',
});

// Express middleware — records request duration + status
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    httpRequestDuration.record(Date.now() - start, {
      method: req.method,
      route: req.route?.path ?? req.path,
      status_code: String(res.statusCode),
    });
  });
  next();
}
