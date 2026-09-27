import knex from 'knex';
import { env } from '../config/env';
import { dbQueryDuration } from '../telemetry/metrics';

export const db = knex({
  client: 'pg',
  connection: env.DATABASE_URL,
  pool: {
    min: Number(process.env.DATABASE_POOL_MIN ?? 2),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  },
  // Wrap queries to emit duration metric
  log: {
    debug(msg: string) {
      // pino picks this up via pino-http context
    },
  },
});

// Instrument all queries with duration histogram
const originalQueryBuilder = db.queryBuilder.bind(db);
// Use knex hooks for instrumentation
db.on('query', (query: { __knexQueryUid: string; sql: string }) => {
  (query as any).__startTime = Date.now();
});
db.on('query-response', (_response: unknown, query: any) => {
  if (query.__startTime) {
    dbQueryDuration.record(Date.now() - query.__startTime, {
      query_type: query.sql.trim().split(' ')[0].toUpperCase(),
    });
  }
});

export default db;
