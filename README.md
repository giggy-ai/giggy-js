# Giggy JavaScript/TypeScript SDK

Official JavaScript and TypeScript SDK for the Giggy text-to-speech API.

Giggy is a text-to-speech API for developers building voice agents and voice-enabled products.

## Repository

```text
https://github.com/giggy-ai/giggy-js
```

Package identity: `@giggy-ai/sdk`. The package has not been published to npm; npm publication is a separate release step.

## Requirements

- Node.js 22+
- Giggy API key
- Giggy voice UUID

Giggy API keys must remain server-side. Do not embed a key into browser JavaScript.

## Build from source

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

const giggy = new Giggy({ apiKey: process.env.GIGGY_API_KEY });
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
await pipeline(Readable.fromWeb(stream), createWriteStream('speech.pcm'));
```

Streaming forces `mode=streaming` and defaults to `output_format=pcm_24000`. The SDK returns the response stream directly and does not buffer the complete audio.

The current progressive streaming endpoint rejects `Idempotency-Key` with HTTP 422. `speech.stream()` therefore omits that header and does not accept an `idempotencyKey` option. `speech.create()` generates a fresh key automatically, or accepts a caller-provided `idempotencyKey` for an intentional replay of the same request. The SDK does not automatically retry synthesis requests.

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
