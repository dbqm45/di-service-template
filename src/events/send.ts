import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign } from './signature.ts';
import type { Event } from './envelope.ts';

/**
 * Sends a signed event to another suite service. The address comes from this service's configuration, never from a
 * request; redirects are refused and the call gives up after 10 seconds. The receiver deduplicates by `id`, so a
 * retry with the same event is safe.
 */
export async function sendEvent(input: { url: string; secret: string; event: Event; fetchImpl?: typeof fetch; nowSeconds?: number }): Promise<void> {
  const body = JSON.stringify(input.event);
  const timestamp = String(input.nowSeconds ?? Math.floor(Date.now() / 1000));
  const res = await (input.fetchImpl ?? fetch)(input.url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'content-type': 'application/json',
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: sign(input.secret, timestamp, body),
    },
    body,
  });
  if (!res.ok) throw new Error(`the receiver answered HTTP ${res.status}`);
}
