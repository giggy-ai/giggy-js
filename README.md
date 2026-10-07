# Giggy TTS SDK for Node.js and TypeScript

[![SDK CI](https://github.com/giggy-ai/giggy-js/actions/workflows/ci.yml/badge.svg)](https://github.com/giggy-ai/giggy-js/actions/workflows/ci.yml)

Official JavaScript and TypeScript SDK for the Giggy text-to-speech API.

Giggy is a text-to-speech (TTS) API for developers building voice agents and voice-enabled products. Generate speech with Giggy's Batch, Fast, and Streaming speech modes.

## Install

Requires Node.js 22 or newer.

```bash
npm install @giggy-ai/sdk
```

## Get a Giggy API key

Create an API key through your Giggy account. Keep it on the server; never embed it in browser JavaScript.

```bash
export GIGGY_API_KEY="giggy_sk_..."
```

## Find a Giggy voice

The public voice catalog is available at `GET https://giggy.ai/v1/voices`. This endpoint requires a Giggy API key. Each catalog entry's `voice_id` is the UUID to pass as `voiceId` to the SDK.

```bash
curl --fail --show-error \
  --header "xi-api-key: ${GIGGY_API_KEY}" \
  "https://giggy.ai/v1/voices"
```

The response contains a `voices` array; use `voices[].voice_id`:

```bash
export GIGGY_VOICE_ID="your-giggy-voice-uuid"
```

## Generate your first MP3

Create `speech.mjs`:

```js
import { writeFile } from 'node:fs/promises';
import { Giggy } from '@giggy-ai/sdk';

const apiKey = process.env.GIGGY_API_KEY;
const voiceId = process.env.GIGGY_VOICE_ID;

if (!apiKey || !voiceId) {
  throw new Error('Set GIGGY_API_KEY and GIGGY_VOICE_ID.');
}

const giggy = new Giggy({ apiKey });
const audio = await giggy.speech.create({
  text: 'Hello from Giggy.',
  voiceId,
});

await writeFile('speech.mp3', audio);
console.log('Wrote speech.mp3');
```

Run it with:

```bash
node speech.mjs
```

## Build from source

The SDK has zero runtime dependencies. Clone the public repository and build the JavaScript and TypeScript declarations in `dist/`:

```bash
git clone https://github.com/giggy-ai/giggy-js.git
cd giggy-js
npm ci
npm run build
```

## Basic text-to-speech

```js
import { writeFile } from 'node:fs/promises';
import { Giggy } from '@giggy-ai/sdk';

const giggy = new Giggy({
  apiKey: process.env.GIGGY_API_KEY,
});

const audio = await giggy.speech.create({
  text: 'Hello from Giggy.',
  voiceId: process.env.GIGGY_VOICE_ID,
});

await writeFile('speech.mp3', audio);
```

The default request is `POST https://giggy.ai/v1/text-to-speech` with `model_id=giggyspeech`, `mode=batch`, and `output_format=mp3_24000_160`.

## Fast speech

```js
const audio = await giggy.speech.create({
  text: 'Hello from Giggy.',
  voiceId: process.env.GIGGY_VOICE_ID,
  mode: 'fast',
});
```

## Streaming text-to-speech

```js
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const stream = await giggy.speech.stream({
  text: 'This speech is streaming.',
  voiceId: process.env.GIGGY_VOICE_ID,
});

await pipeline(
  Readable.fromWeb(stream),
  createWriteStream('speech.pcm'),
);
```

Streaming forces `mode=streaming` and defaults to `output_format=pcm_24000`. The SDK returns the response stream directly and does not buffer the complete audio.

The progressive streaming endpoint rejects `Idempotency-Key` with HTTP 422. `speech.stream()` therefore omits that header and does not accept an `idempotencyKey` option. `speech.create()` generates a fresh key automatically, or accepts a caller-provided `idempotencyKey` for an intentional replay of the same request. The SDK does not automatically retry synthesis requests.

## Custom speed

```js
const audio = await giggy.speech.create({
  text: 'Hello.',
  voiceId: process.env.GIGGY_VOICE_ID,
  speed: 1,
});
```

This is sent as `voice_settings.speed`; the API validates the supported range.

## Errors

Unsuccessful API responses throw `GiggyAPIError`, which exposes `status`, the raw response `body`, `method`, and `url`.

## Public API

- `Giggy`
- `GiggyAPIError`
- `SpeechCreateParams`
- `SpeechStreamParams`
- `SpeechMode` (`batch` or `fast`)
- `giggy.speech.create(params)` → `Promise<Uint8Array>`
- `giggy.speech.stream(params)` → `Promise<ReadableStream<Uint8Array>>`

## Developer resources

- Documentation: https://giggy.ai/docs/speech-api
- OpenAPI: https://giggy.ai/v1/openapi.json
- Runnable integrations: https://github.com/GRQDigitalCapital/giggy-examples
- MCP: https://github.com/GRQDigitalCapital/giggy-mcp
- Pricing: https://giggy.ai/pricing

## Framework integration examples

- [LiveKit TTS](https://github.com/GRQDigitalCapital/giggy-examples/tree/main/livekit/python)
- [Pipecat TTS](https://github.com/GRQDigitalCapital/giggy-examples/tree/main/pipecat/python)
- [Vapi custom TTS](https://github.com/GRQDigitalCapital/giggy-examples/tree/main/vapi)
- [OpenAI-compatible TTS](https://github.com/GRQDigitalCapital/giggy-examples/tree/main/node/openai-compatible)
- [Giggy MCP](https://github.com/GRQDigitalCapital/giggy-mcp)

These examples demonstrate Giggy compatibility. The LiveKit, Pipecat, and Vapi integrations do not use this SDK internally.
