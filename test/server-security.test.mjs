import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { createAiReviewGuard, readJsonBody, validateAiReviewPayload } from '../server-security.mjs';
import * as serverSecurity from '../server-security.mjs';

const serverSource = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');

test('readJsonBody_counts_utf8_bytes_and_rejects_above_256kb', async () => {
  const valid = await readJsonBody(Readable.from([Buffer.from('{"draft":"ok"}')]), 32);
  assert.deepEqual(valid, { draft: 'ok' });

  const multibyte = Buffer.from(JSON.stringify({ draft: 'é'.repeat(20) }));
  assert.ok(multibyte.byteLength > 32);
  await assert.rejects(
    readJsonBody(Readable.from([multibyte.subarray(0, 25), multibyte.subarray(25)]), 32),
    error => error.statusCode === 413
  );

  const aboveDefaultLimit = Buffer.from(JSON.stringify({ draft: 'é'.repeat(128_000) }));
  assert.ok(aboveDefaultLimit.byteLength > 256_000);
  await assert.rejects(
    readJsonBody(Readable.from([aboveDefaultLimit.subarray(0, 100_000), aboveDefaultLimit.subarray(100_000)])),
    error => error.statusCode === 413
  );
});

test('readJsonBody_rejects_and_pauses_as_soon_as_stream_crosses_limit', async () => {
  const request = new PassThrough();
  const pending = readJsonBody(request, 8);
  request.write(Buffer.from('0123456789'));

  const outcome = await Promise.race([
    pending.then(() => null, error => error),
    new Promise(resolve => setTimeout(() => resolve('still waiting for end'), 50))
  ]);
  assert.equal(outcome?.statusCode, 413);
  assert.equal(request.isPaused(), true);
  request.destroy();
});

test('readJsonResponse_cancels_model_output_above_byte_limit', async () => {
  assert.equal(typeof serverSecurity.readJsonResponse, 'function');
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(17)));
    },
    cancel() { cancelled = true; }
  });
  const response = new Response(body);
  await assert.rejects(serverSecurity.readJsonResponse(response, 16), /response exceeds/i);
  assert.equal(cancelled, true);
});

test('validateAiReviewPayload_rejects_bad_shape_and_source_limits', () => {
  assert.equal(validateAiReviewPayload({}).valid, false);
  assert.equal(validateAiReviewPayload({ draft: 'x'.repeat(30_001) }).valid, false);
  assert.equal(validateAiReviewPayload({ draft: 'ok', sources: Array.from({ length: 21 }, () => ({})) }).valid, false);
  assert.equal(validateAiReviewPayload({ draft: 'ok', sources: [{ title: 'x'.repeat(201), content: 'x' }] }).valid, false);
  assert.equal(validateAiReviewPayload({ draft: 'ok', sources: [{ title: 'x', content: 'x'.repeat(12_001) }] }).valid, false);
  assert.equal(validateAiReviewPayload({ draft: 'ok', sources: [{ title: 'x', content: 'x'.repeat(12_000) }, { title: 'y', content: 'y'.repeat(138_001) }] }).valid, false);
  assert.equal(validateAiReviewPayload({ draft: 'valid', sources: [{ title: 'Facts', content: 'Approved text.' }] }).valid, true);
});

test('ai_review_guard_caps_12_requests_per_minute_and_2_concurrent', () => {
  let now = 1_000;
  const guard = createAiReviewGuard({ now: () => now });
  const first = guard.acquire();
  const second = guard.acquire();
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  const concurrent = guard.acquire();
  assert.equal(concurrent.allowed, false);
  assert.equal(concurrent.reason, 'concurrency_limited');
  assert.ok(concurrent.retryAfterSeconds >= 1);

  first.release();
  first.release();
  second.release();
  for (let index = 0; index < 10; index += 1) {
    const next = guard.acquire();
    assert.equal(next.allowed, true, 'concurrency rejections must not consume request quota');
    next.release();
  }
  const rateLimited = guard.acquire();
  assert.equal(rateLimited.allowed, false);
  assert.equal(rateLimited.reason, 'rate_limited');
  assert.ok(rateLimited.retryAfterSeconds >= 1);

  now += 60_000;
  const afterWindow = guard.acquire();
  assert.equal(afterWindow.allowed, true);
  afterWindow.release();
});

test('ai_review_route_validates_payload_and_limits_before_ollama_fetch', () => {
  const route = serverSource.slice(serverSource.indexOf("url.pathname === '/api/ai-review'"), serverSource.indexOf("const decoded = decodeURIComponent"));
  assert.match(serverSource, /createAiReviewGuard/);
  const parseAt = route.indexOf('readJsonBody(req)');
  const validateAt = route.indexOf('validateAiReviewPayload(payload)');
  const acquireAt = route.indexOf('aiReviewGuard.acquire()');
  const fetchAt = route.indexOf('await fetch(');
  assert.ok(parseAt >= 0 && validateAt > parseAt && acquireAt > validateAt && fetchAt > acquireAt);
  assert.match(route, /finally\s*\{[\s\S]*?reservation\?\.release\s*\(\s*\)/);
  assert.match(route, /\[400,\s*413\]\.includes\(error\.statusCode\)/);
  assert.match(route, /send\(res,\s*429/);
  assert.match(route, /readJsonResponse\(response\)/);
  assert.match(route, /num_predict\s*:\s*512/);
  assert.match(serverSource, /requestTimeout\s*:\s*30_000/);
});
