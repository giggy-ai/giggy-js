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

test('transcriptions.submit streams a WAV body and preserves admission options', async () => {
  let requestUrl;
  let requestInit;
  let uploaded = '';
  const id = '00000000-0000-4000-8000-000000000001';
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    requestInit = init;
    for await (const chunk of init.body) uploaded += new TextDecoder().decode(chunk);
    return new Response(JSON.stringify({ generation: { generation_uuid: id, status: 'queued' } }), { status: 202 });
  };
  const admission = await new Giggy({ apiKey }).transcriptions.submit({ audioPath: 'package.json', mode: 'fast', language: 'en', clientRequestId: id });
  assert.equal(admission.generation.generation_uuid, id);
  assert.match(requestUrl, /\/audio\/transcriptions\?mode=fast&language=en&client_request_id=/);
  assert.equal(new Headers(requestInit.headers).get('xi-api-key'), apiKey);
  assert.equal(uploaded, await (await import('node:fs/promises')).readFile('package.json', 'utf8'));
});

test('transcriptions.result verifies completion and fetches the signed artifact without the key', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return requests.length === 1
      ? new Response(JSON.stringify({ generation: { generation_uuid: id, status: 'completed', result: { url: 'https://example.test/transcript.json' } } }))
      : new Response(JSON.stringify({ text: 'hello', languages: ['English'] }));
  };
  const result = await new Giggy({ apiKey }).transcriptions.result(id);
  assert.equal(result.text, 'hello');
  assert.equal(new Headers(requests[0].init.headers).get('xi-api-key'), apiKey);
  assert.equal(new Headers(requests[1].init.headers).get('xi-api-key'), null);
});

test('transcriptions.transcribe submits once and returns the durable transcript', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (requests.length === 1) return new Response(JSON.stringify({ generation: { generation_uuid: id, status: 'queued' } }), { status: 202 });
    if (requests.length === 2) return new Response(JSON.stringify({ generation: { generation_uuid: id, status: 'processing' } }));
    if (requests.length === 3) return new Response(JSON.stringify({ generation: { generation_uuid: id, status: 'completed' } }));
    if (requests.length === 4) return new Response(JSON.stringify({ generation: { generation_uuid: id, status: 'completed', result: { url: 'https://example.test/transcript.json' } } }));
    return new Response(JSON.stringify({ text: 'ready' }));
  };
  const transcript = await new Giggy({ apiKey }).transcriptions.transcribe({ audioPath: 'package.json' }, { pollIntervalMs: 1 });
  assert.equal(transcript.text, 'ready');
  assert.equal(requests.length, 5);
  assert.equal(requests.filter(url => url.includes('/audio/transcriptions')).length, 1);
});

test('transcriptions.stream parses SSE across UTF-8 and CRLF boundaries', async () => {
  const chunks = [
    'event: transcript_chunk\r',
    '\ndata: {"text":"one","replace":true}\r\n\r',
    '\nevent: transcript_chunk\ndata: {"text":"one two","replace":true}\n\n',
  ];
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const events = [];
  for await (const event of new Giggy({ apiKey }).transcriptions.stream({ audioPath: 'package.json' })) events.push(event);
  assert.deepEqual(events.map(event => event.data.text), ['one', 'one two']);
});

test('transcriptions.live admits the existing microphone protocol and sends an ordered PCM frame', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const token = 'a'.repeat(64);
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return requests.length === 1
      ? new Response(`event: microphone_ready\ndata: {"generation_uuid":"${id}","attempt":1,"input_token":"${token}"}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      : new Response('{"ok":true}', { status: 200 });
  };
  const giggy = new Giggy({ apiKey });
  for await (const { event, data } of giggy.transcriptions.live({ clientRequestId: id })) {
    if (event === 'microphone_ready') {
      await giggy.transcriptions.sendLiveFrame({ generationUuid: data.generation_uuid, inputToken: data.input_token, sequence: 0, pcm: new Uint8Array(16000), complete: true });
    }
  }
  assert.equal(requests[0].url, 'https://giggy.ai/v1/audio/transcriptions');
  assert.deepEqual(JSON.parse(requests[0].init.body), { mode: 'streaming', microphone: true, client_request_id: id });
  assert.equal(requests[1].url, `https://giggy.ai/api/generations/${id}/stt-input`);
  assert.equal(new Headers(requests[1].init.headers).get('xi-api-key'), null);
  assert.equal(JSON.parse(requests[1].init.body).sequence, 0);
});
