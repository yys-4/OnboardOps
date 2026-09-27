/**
 * Sample incident fixtures representing 3 realistic production failure scenarios.
 * Used by the Fix Hub pipeline and test suites.
 */

export interface IncidentFixture {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium';
  affected_services: string[];
  error_type: 'race_condition' | 'null_pointer' | 'payment_timeout';
  stack_trace: string;
  log_lines: string[];
  // The deliberate bug in source code this fixture represents
  bug_description: string;
  // File + function where the bug lives
  suspect_location: { file: string; fn: string; line_hint: number };
}

// ── FIXTURE 1: Race Condition ─────────────────────────────────────────────
// Two concurrent POST /api/orders requests for the same product both pass
// the stock check (both read stock=1) then both decrement → stock = -1.
// Root cause: stock check + decrement not inside the same DB transaction.

export const RACE_CONDITION_FIXTURE: IncidentFixture = {
  id: 'inc-race-001',
  title: 'Race condition: stock oversell on concurrent order creation',
  severity: 'critical',
  affected_services: ['backend', 'postgres'],
  error_type: 'race_condition',
  stack_trace: `
Error: Stock went negative — oversell detected
    at validateStockIntegrity (/app/src/routes/orders.ts:89)
    at stockIntegrityCheck (/app/src/db/client.ts:41)
    at processTicksAndRejections (node:internal/process/task_queues:95)

Additional context:
  product_id: "prod-abc-123"
  expected_min_stock: 0
  actual_stock: -1
  concurrent_requests: 2
  trace_id: "abc123def456"
`.trim(),
  log_lines: [
    '{"level":"info","msg":"POST /api/orders user=u1 product=prod-abc-123 qty=1 stock_before=1"}',
    '{"level":"info","msg":"POST /api/orders user=u2 product=prod-abc-123 qty=1 stock_before=1"}',
    '{"level":"info","msg":"Stock check passed user=u1 stock=1 required=1"}',
    '{"level":"info","msg":"Stock check passed user=u2 stock=1 required=1"}',
    '{"level":"warn","msg":"DECREMENT products stock_quantity=1 for prod-abc-123 (u1)"}',
    '{"level":"warn","msg":"DECREMENT products stock_quantity=1 for prod-abc-123 (u2)"}',
    '{"level":"error","msg":"Stock went negative — oversell detected product=prod-abc-123 stock=-1"}',
  ],
  bug_description:
    'Stock check (SELECT stock_quantity) and decrement (UPDATE) execute as separate statements. ' +
    'Two concurrent requests both read stock=1, both pass, both decrement → stock=-1.',
  suspect_location: {
    file: 'services/backend/src/routes/orders.ts',
    fn: 'POST /api/orders',
    line_hint: 86,
  },
};

// ── FIXTURE 2: Null Pointer / Missing Guard ────────────────────────────────
// PATCH /api/orders/:id/status called on an order that belongs to another user.
// req.user is set (auth passes) but order.user_id check is skipped when
// role === 'developer', hitting order.metadata.notify which is null → TypeError.

export const NULL_POINTER_FIXTURE: IncidentFixture = {
  id: 'inc-null-002',
  title: 'TypeError: Cannot read properties of null (reading "notify")',
  severity: 'high',
  affected_services: ['backend'],
  error_type: 'null_pointer',
  stack_trace: `
TypeError: Cannot read properties of null (reading 'notify')
    at /app/src/routes/orders.ts:142
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95)
    at next (/app/node_modules/express/lib/router/route.js:137)
    at Route.dispatch (/app/node_modules/express/lib/router/route.js:112)
    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95)
    at /app/node_modules/express/lib/router/index.js:284

Frame locals:
  order.id = "ord-xyz-789"
  order.metadata = null
  status = "shipped"
  req.user.role = "developer"
`.trim(),
  log_lines: [
    '{"level":"info","msg":"PATCH /api/orders/ord-xyz-789/status user=dev-user-1 role=developer"}',
    '{"level":"info","msg":"Order found id=ord-xyz-789 user_id=other-user metadata=null"}',
    '{"level":"error","msg":"TypeError: Cannot read properties of null (reading \'notify\') path=/api/orders/ord-xyz-789/status"}',
    '{"level":"error","msg":"UnhandledPromiseRejection in ordersRouter.patch"}',
  ],
  bug_description:
    "PATCH /:id/status reads order.metadata.notify without null-checking order.metadata. " +
    "The DB column defaults to '{}' but older seed rows have NULL. " +
    "Also missing ownership check for 'developer' role (only 'viewer' check present).",
  suspect_location: {
    file: 'services/backend/src/routes/orders.ts',
    fn: 'PATCH /:id/status',
    line_hint: 134,
  },
};

// ── FIXTURE 3: Payment Processing Timeout ────────────────────────────────
// POST /api/orders with payment_method='bank_transfer' calls an imaginary
// external payment gateway that hangs. No timeout guard → request hangs
// for 30 s, knex pool connection held, cascading to pool exhaustion.

export const PAYMENT_TIMEOUT_FIXTURE: IncidentFixture = {
  id: 'inc-pay-003',
  title: 'Payment gateway timeout causing DB pool exhaustion cascade',
  severity: 'critical',
  affected_services: ['backend', 'postgres'],
  error_type: 'payment_timeout',
  stack_trace: `
Error: Payment gateway timeout after 30000ms
    at Timeout._onTimeout (/app/src/services/payment.ts:38)
    at listOnTimeout (node:internal/timers:559)
    at processTimers (node:internal/timers:500)

Caused by pool exhaustion:
Error: Knex: Timeout acquiring a connection. The pool is probably full.
    at /app/node_modules/knex/lib/client.js:376
    at processTicksAndRejections (node:internal/process/task_queues:95)

Context:
  payment_method: "bank_transfer"
  gateway_url: "https://pay.example.com/v1/charge"
  timeout_ms: undefined   ← no timeout set
  pool_used: 10/10
  waiting_requests: 47
`.trim(),
  log_lines: [
    '{"level":"info","msg":"POST /api/orders payment_method=bank_transfer"}',
    '{"level":"info","msg":"Calling payment gateway url=https://pay.example.com/v1/charge"}',
    '{"level":"warn","msg":"Payment gateway no response after 10000ms"}',
    '{"level":"warn","msg":"Payment gateway no response after 20000ms"}',
    '{"level":"error","msg":"Payment gateway timeout after 30000ms"}',
    '{"level":"error","msg":"Knex: Timeout acquiring a connection. The pool is probably full. pool_used=10/10 waiting=47"}',
    '{"level":"error","msg":"FATAL: 47 requests waiting for DB pool connection"}',
  ],
  bug_description:
    'createOrder calls external payment gateway with no AbortController/timeout. ' +
    'Gateway hangs → DB transaction held open 30 s → pool exhausted → all /api/* requests fail.',
  suspect_location: {
    file: 'services/backend/src/services/payment.ts',
    fn: 'chargePaymentGateway',
    line_hint: 32,
  },
};

export const ALL_FIXTURES: IncidentFixture[] = [
  RACE_CONDITION_FIXTURE,
  NULL_POINTER_FIXTURE,
  PAYMENT_TIMEOUT_FIXTURE,
];
