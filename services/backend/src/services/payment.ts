/**
 * Payment gateway client.
 *
 * BUG (GFI-PAY-001): No timeout on gateway fetch → hangs indefinitely
 * → holds DB transaction open → pool exhaustion cascade.
 *
 * Fix: add AbortController with configurable PAYMENT_GATEWAY_TIMEOUT_MS.
 */

export interface ChargeRequest {
  payment_method: string;
  amount_cents: number;
  currency: string;
  idempotency_key: string;
}

export interface ChargeResponse {
  success: boolean;
  gateway_tx_id?: string;
  error?: string;
}

const GATEWAY_URL =
  process.env.PAYMENT_GATEWAY_URL ?? 'https://pay.example.com/v1/charge';

// BUG: PAYMENT_GATEWAY_TIMEOUT_MS is read but never used in the fetch call.
const PAYMENT_GATEWAY_TIMEOUT_MS = Number(
  process.env.PAYMENT_GATEWAY_TIMEOUT_MS ?? 5000,
);

/**
 * Charge external payment gateway.
 *
 * ⚠️  BUG: no AbortController → fetch can hang for 30 s+.
 * Fix is in chargePaymentGateway_fixed below.
 */
export async function chargePaymentGateway(
  req: ChargeRequest,
): Promise<ChargeResponse> {
  // BUG: no timeout — if gateway is slow, this hangs forever
  const response = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    // ← MISSING: signal: controller.signal
  });

  if (!response.ok) {
    return { success: false, error: `Gateway HTTP ${response.status}` };
  }
  return response.json() as Promise<ChargeResponse>;
}

/**
 * FIXED version: wraps fetch with AbortController timeout.
 * Swap chargePaymentGateway usages to this after patch is applied.
 */
export async function chargePaymentGateway_fixed(
  req: ChargeRequest,
): Promise<ChargeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Payment gateway timeout after ${PAYMENT_GATEWAY_TIMEOUT_MS}ms`)),
    PAYMENT_GATEWAY_TIMEOUT_MS,
  );

  try {
    const response = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { success: false, error: `Gateway HTTP ${response.status}` };
    }
    return response.json() as Promise<ChargeResponse>;
  } finally {
    clearTimeout(timer);
  }
}
