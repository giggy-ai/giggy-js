import assert from 'node:assert/strict';
import test from 'node:test';

import { Giggy, GiggyAPIError } from '../dist/index.js';

const originalFetch = globalThis.fetch;
test.after(() => {
  globalThis.fetch = originalFetch;
});

const voiceId = '00000000-0000-0000-0000-000000000000';
const apiKey = 'giggy_sk_test_not_real';

test('requires an API key', () => {
  assert.throws(() => new Giggy({ apiKey: '' }), /non-empty apiKey/);
});

test('speech.create maps SDK fields to the native Giggy API', async () => {
  let capturedUrl;
  let capturedInit;
  globalThis.fetch = async (url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    });
  };

  const giggy = new Giggy({ apiKey });
  const audio = await giggy.speech.create({ text: 'Hello.', voiceId, speed: 1 });
  assert.deepEqual(Array.from(audio), [1, 2, 3]);
  assert.equal(capturedUrl, 'https://giggy.ai/v1/text-to-speech');
  assert.equal(capturedInit.method, 'POST');

  const headers = new Headers(capturedInit.headers);
  assert.equal(headers.get('xi-api-key'), apiKey);
  assert.equal(headers.get('authorization'), null);
  assert.ok(headers.get('idempotency-key'));

  assert.deepEqual(JSON.parse(String(capturedInit.body)), {
    text: 'Hello.',
    voice_id: voiceId,
    model_id: 'giggyspeech',
    mode: 'batch',
    output_format: 'mp3_24000_160',
    voice_settings: { speed: 1 },
  });
});

test('speech.create preserves a supplied idempotency key exactly', async () => {
  let capturedInit;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return new Response(new Uint8Array([1]), { status: 200 });
  };

  const giggy = new Giggy({ apiKey });
  await giggy.speech.create({ text: 'Hello.', voiceId, idempotencyKey: 'request-123' });
  assert.equal(new Headers(capturedInit.headers).get('idempotency-key'), 'request-123');
});

test('speech.create supports fast mode', async () => {
  let capturedInit;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return new Response(new Uint8Array([1]), { status: 200 });
  };

  const giggy = new Giggy({ apiKey });
  await giggy.speech.create({ text: 'Hello.', voiceId, mode: 'fast' });
  assert.equal(JSON.parse(String(capturedInit.body)).mode, 'fast');
});

test('speech.stream forces streaming mode and returns the response stream without an idempotency key', async () => {
  let capturedInit;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return new Response(new Uint8Array([4, 5, 6]), {
      status: 200,
      headers: { 'content-type': 'audio/pcm' },
    });
  };

  const giggy = new Giggy({ apiKey });
  const stream = await giggy.speech.stream({ text: 'Stream this.', voiceId });
  const payload = JSON.parse(String(capturedInit.body));
  assert.equal(payload.mode, 'streaming');
  assert.equal(payload.output_format, 'pcm_24000');
  assert.equal(new Headers(capturedInit.headers).get('idempotency-key'), null);

  const result = await stream.getReader().read();
  assert.equal(result.done, false);
  assert.deepEqual(Array.from(result.value), [4, 5, 6]);
});

test('API failures throw GiggyAPIError with the raw response body', async () => {
  globalThis.fetch = async () => new Response('invalid request', { status: 400 });
  const giggy = new Giggy({ apiKey });
  await assert.rejects(
    () => giggy.speech.create({ text: 'Hello.', voiceId }),
    (error) => {
      assert.ok(error instanceof GiggyAPIError);
      assert.equal(error.status, 400);
      assert.equal(error.body, 'invalid request');
      assert.equal(error.method, 'POST');
      assert.equal(error.url, 'https://giggy.ai/v1/text-to-speech');
      return true;
    },
  );
});

test('custom baseURL has trailing slashes removed', async () => {
  let capturedUrl;
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(new Uint8Array([1]), { status: 200 });
  };

  const giggy = new Giggy({ apiKey, baseURL: 'https://example.test/v1///' });
  await giggy.speech.create({ text: 'Hello.', voiceId });
  assert.equal(capturedUrl, 'https://example.test/v1/text-to-speech');
});

test('speech methods reject blank text and voice IDs without making a request', async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(new Uint8Array([1]), { status: 200 });
  };
  const giggy = new Giggy({ apiKey });

  await assert.rejects(() => giggy.speech.create({ text: ' ', voiceId }), /text must be/);
  await assert.rejects(() => giggy.speech.stream({ text: 'Hi.', voiceId: ' ' }), /voiceId must be/);
  assert.equal(requests, 0);
});

test('speech.stream rejects unexpected PCM content types', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'unexpected response' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const giggy = new Giggy({ apiKey });
  await assert.rejects(
    () => giggy.speech.stream({ text: 'Hello.', voiceId }),
    /Expected Giggy streaming PCM audio/,
  );
});

test('speech.stream accepts parameterized PCM content types', async () => {
  globalThis.fetch = async () =>
    new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'audio/pcm; rate=24000' },
    });

  const giggy = new Giggy({ apiKey });
  const stream = await giggy.speech.stream({ text: 'Hello.', voiceId });
  const result = await stream.getReader().read();

  assert.equal(result.done, false);
  assert.deepEqual(Array.from(result.value), [1, 2, 3, 4]);
});

test('speech.stream rejects a missing response body', async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });

  const giggy = new Giggy({ apiKey });
  await assert.rejects(
    () => giggy.speech.stream({ text: 'Hello.', voiceId }),
    /empty streaming response body/,
  );
});
