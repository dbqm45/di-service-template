import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed messages between suite services, the scheme every suite application already uses (pdi, ShipScope,
 * DI Channels): `X-DI-Signature: v1=<hex HMAC-SHA256(secret, "<X-DI-Timestamp>.<raw body>")>`, with the timestamp in
 * Unix seconds and a 5-minute window both ways. Older senders use their own header names (X-ShipScope-*, X-PDI-*)
 * with the same value; a service that receives from them reads those headers instead.
 */
export const SIGNATURE_HEADER = 'x-di-signature';
export const TIMESTAMP_HEADER = 'x-di-timestamp';
export const TOLERANCE_SECONDS = 300;

export const sign = (secret: string, timestamp: string, body: string): string =>
  `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

/** Why the signature is not accepted, or null when it is. */
export function signatureProblem(input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  body: string;
  nowSeconds?: number;
}): string | null {
  const { secret, timestamp, signature, body } = input;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return 'missing or invalid X-DI-Timestamp';
  if (Math.abs(now - Number(timestamp)) > TOLERANCE_SECONDS) return 'X-DI-Timestamp is outside the 5-minute window';
  const expected = sign(secret, timestamp, body);
  if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return 'invalid X-DI-Signature';
  }
  return null;
}
