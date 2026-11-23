import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sign, signatureProblem } from '../src/events/signature.ts';
import { SECRET } from './helpers.ts';

const now = 1_800_000_000;
const body = '{"id":"evt-1"}';

test('a signature made with the shared secret is accepted', () => {
  assert.equal(signatureProblem({ secret: SECRET, timestamp: String(now), signature: sign(SECRET, String(now), body), body, nowSeconds: now }), null);
});

test('same value as the suite senders (pdi verify_signature): v1=HMAC-SHA256(secret, "<ts>.<body>")', () => {
  // Vector computed with Python's hmac, as pdi does.
  assert.equal(sign('s', '1', 'b'), 'v1=8a24cdd4ca35ebc2922810a126f457252f7eaa83834bb009baafc362912addda');
});

test('refused: other secret, changed body, old or missing timestamp', () => {
  const ts = String(now);
  const good = sign(SECRET, ts, body);
  assert.match(signatureProblem({ secret: 'other', timestamp: ts, signature: good, body, nowSeconds: now }) ?? '', /invalid X-DI-Signature/);
  assert.match(signatureProblem({ secret: SECRET, timestamp: ts, signature: good, body: `${body} `, nowSeconds: now }) ?? '', /invalid/);
  assert.match(signatureProblem({ secret: SECRET, timestamp: String(now - 301), signature: sign(SECRET, String(now - 301), body), body, nowSeconds: now }) ?? '', /5-minute/);
  assert.match(signatureProblem({ secret: SECRET, timestamp: undefined, signature: good, body, nowSeconds: now }) ?? '', /X-DI-Timestamp/);
  assert.match(signatureProblem({ secret: SECRET, timestamp: ts, signature: undefined, body, nowSeconds: now }) ?? '', /invalid/);
});
