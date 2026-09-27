import pino from 'pino';
import { env } from '../config/env';

let transport: any;
if (env.NODE_ENV === 'development') {
  try {
    require.resolve('pino-pretty');
    transport = { target: 'pino-pretty', options: { colorize: true } };
  } catch {
    // pino-pretty not installed, fallback to default json output
  }
}

export const logger = pino({
  level: env.LOG_LEVEL,
  transport,
  base: {
    service: env.OTEL_SERVICE_NAME,
    env: env.NODE_ENV,
  },
});
