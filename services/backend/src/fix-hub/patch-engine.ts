/**
 * Patch Engine.
 *
 * For each known error_type, returns:
 *   1. A minimal unified diff (patch)
 *   2. A human-readable description of the fix
 *   3. The test ID that should go GREEN after the patch
 *
 * In a real autonomous workflow, the patch would be written to disk
 * and applied with `git apply`. Here patches are represented as
 * structured diffs with before/after code sections.
 */

export interface CodePatch {
  error_type: string;
  target_file: string;
  target_fn: string;
  description: string;
  before: string;   // exact code snippet to replace
  after: string;    // replacement code
  test_id: string;  // vitest test that proves the fix
  confidence: 'high' | 'medium' | 'low';
}

// ── Patch catalogue ────────────────────────────────────────────────────────

export const PATCHES: Record<string, CodePatch> = {

  // ── Fix 1: Race condition — move stock check INSIDE transaction ──────────
  race_condition: {
    error_type: 'race_condition',
    target_file: 'services/backend/src/routes/orders.ts',
    target_fn: 'POST /api/orders (transactional insert)',
    description:
      'Move stock validation inside the DB transaction and add ' +
      'SELECT ... FOR UPDATE to prevent concurrent reads from both passing the check.',
    confidence: 'high',
    before: `    // Validate products exist and have stock
    const productIds = body.items.map(i => i.product_id);
    const products: Product[] = await db('products')
      .whereIn('id', productIds)
      .where({ is_active: true });

    if (products.length !== productIds.length) {
      throw new AppError(422, 'One or more products not found or inactive');
    }

    // Calculate totals + check stock
    let totalAmount = 0;
    const orderItems = body.items.map(item => {
      const product = products.find(p => p.id === item.product_id)!;
      if (product.stock_quantity < item.quantity) {
        throw new AppError(422, \`Insufficient stock for \${product.name}\`);
      }
      const subtotal = Number(product.price) * item.quantity;
      totalAmount += subtotal;
      return { product_id: item.product_id, quantity: item.quantity, unit_price: Number(product.price), subtotal };
    });

    // Transactional insert
    const order: Order = await db.transaction(async (trx) => {
      const [created]: Order[] = await trx('orders').insert({`,
    after: `    // Transactional insert — stock check + decrement inside same trx with row-level lock
    const order: Order = await db.transaction(async (trx) => {
      const productIds = body.items.map(i => i.product_id);

      // SELECT FOR UPDATE — acquires row lock, prevents concurrent oversell
      const products: Product[] = await trx('products')
        .whereIn('id', productIds)
        .where({ is_active: true })
        .forUpdate();

      if (products.length !== productIds.length) {
        throw new AppError(422, 'One or more products not found or inactive');
      }

      let totalAmount = 0;
      const orderItems = body.items.map(item => {
        const product = products.find(p => p.id === item.product_id)!;
        if (product.stock_quantity < item.quantity) {
          throw new AppError(422, \`Insufficient stock for \${product.name}\`);
        }
        const subtotal = Number(product.price) * item.quantity;
        totalAmount += subtotal;
        return { product_id: item.product_id, quantity: item.quantity, unit_price: Number(product.price), subtotal };
      });

      const [created]: Order[] = await trx('orders').insert({`,
    test_id: 'race-condition > concurrent orders should not oversell stock',
  },

  // ── Fix 2: Null pointer — guard metadata + add ownership check ───────────
  null_pointer: {
    error_type: 'null_pointer',
    target_file: 'services/backend/src/routes/orders.ts',
    target_fn: 'PATCH /:id/status',
    description:
      'Add null-guard on order.metadata before reading .notify. ' +
      'Also add ownership check for developer role (not just viewer).',
    confidence: 'high',
    before: `  ordersRouter.patch('/:id/status', async (req, res, next) => {
  try {
    if (req.user!.role === 'viewer') throw new AppError(403, 'Viewers cannot update orders');
    const { status } = updateStatusSchema.parse(req.body);

    const order: Order = await db('orders').where({ id: req.params.id }).first();
    if (!order) throw new AppError(404, 'Order not found');`,
    after: `  ordersRouter.patch('/:id/status', async (req, res, next) => {
  try {
    if (req.user!.role === 'viewer') throw new AppError(403, 'Viewers cannot update orders');
    const { status } = updateStatusSchema.parse(req.body);

    const order: Order = await db('orders').where({ id: req.params.id }).first();
    if (!order) throw new AppError(404, 'Order not found');

    // Ownership check: non-admins can only update their own orders
    if (req.user!.role !== 'admin' && order.user_id !== req.user!.sub) {
      throw new AppError(403, 'Access denied');
    }

    // Null-guard: metadata may be NULL in older rows
    const metadata = order.metadata ?? {};
    const notify = (metadata as any).notify ?? null;`,
    test_id: 'null-pointer > PATCH status with null metadata should not throw TypeError',
  },

  // ── Fix 3: Payment timeout — add AbortController ──────────────────────────
  payment_timeout: {
    error_type: 'payment_timeout',
    target_file: 'services/backend/src/services/payment.ts',
    target_fn: 'chargePaymentGateway',
    description:
      'Wrap fetch with AbortController. Timeout defaults to 5 s via ' +
      'PAYMENT_GATEWAY_TIMEOUT_MS env var. Replace chargePaymentGateway with ' +
      'chargePaymentGateway_fixed export.',
    confidence: 'high',
    before: `export async function chargePaymentGateway(
  req: ChargeRequest,
): Promise<ChargeResponse> {
  // BUG: no timeout — if gateway is slow, this hangs forever
  const response = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    // ← MISSING: signal: controller.signal
  });`,
    after: `export async function chargePaymentGateway(
  req: ChargeRequest,
): Promise<ChargeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(\`Payment gateway timeout after \${PAYMENT_GATEWAY_TIMEOUT_MS}ms\`)),
    PAYMENT_GATEWAY_TIMEOUT_MS,
  );
  try {
    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });`,
    test_id: 'payment-timeout > slow gateway should reject after PAYMENT_GATEWAY_TIMEOUT_MS',
  },
};

/**
 * Retrieve patch for given error type.
 * Returns null if no known patch exists (manual review required).
 */
export function getPatchForErrorType(error_type: string): CodePatch | null {
  return PATCHES[error_type] ?? null;
}

/**
 * Apply a patch to source code string (simple before→after replacement).
 * Returns patched source, or throws if before section not found.
 */
export function applyPatch(source: string, patch: CodePatch): string {
  const normalise = (s: string) =>
    s
      .split('\n')
      .map((l) => l.trimEnd())
      .join('\n');

  const normSource = normalise(source);
  const normBefore = normalise(patch.before);

  if (!normSource.includes(normBefore)) {
    throw new Error(
      `Patch for ${patch.error_type}: target snippet not found in ${patch.target_file}. ` +
        `Manual review required.`,
    );
  }
  return normSource.replace(normBefore, normalise(patch.after));
}
