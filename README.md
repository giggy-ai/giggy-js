# Giggy Speech SDK for Node.js and TypeScript

[![SDK CI](https://github.com/giggy-ai/giggy-js/actions/workflows/ci.yml/badge.svg)](https://github.com/giggy-ai/giggy-js/actions/workflows/ci.yml)

Official JavaScript and TypeScript SDK for Giggy text-to-speech and recorded-audio transcription.

Giggy provides text-to-speech and speech-to-text APIs for developers building voice agents and voice-enabled products.

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

Available voices for your Giggy account are returned by `GET https://giggy.ai/v1/voices`. This endpoint requires a Giggy API key as a bearer token. Each entry's `voice_id` is the UUID to pass as `voiceId` to the SDK.

```bash
curl --fail --show-error \
  --header "Authorization: Bearer ${GIGGY_API_KEY}" \
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

## Transcribe a recording

Prepare a WAV file with signed PCM16, mono, 16 kHz audio. Batch is free for 0.5–60 seconds; Fast accepts 0.5 seconds–12 hours and uses credits. The Node.js SDK streams the file body instead of buffering the whole recording. These STT methods are in version 0.1.1 of this checkout; npm currently serves an older version until this package is published.

```js
import { Giggy } from '@giggy-ai/sdk';

const giggy = new Giggy({ apiKey: process.env.GIGGY_API_KEY });
console.log((await giggy.transcriptions.transcribe({ audioPath: 'recording.wav', mode: 'batch' })).text);
```

`transcribe()` submits once, polls the durable generation, then fetches the signed transcript URL without your API key. It stops on failure or after a configurable timeout: pass `{ pollIntervalMs: 2500, timeoutMs: 1800000 }` as its second argument to change the defaults. Its error includes the generation UUID for inspection. Use `submit()`, `get()`, and `result()` separately for submit-now/fetch-later workflows. A completed generation may have no downloadable result after retention cleanup. Use `mode: 'fast'` for a paid recording, `language: 'en'` for a known language, or omit `language` for automatic detection. `clientRequestId` accepts a UUID; it does not authorize automatic retries of an ambiguous upload. The SDK never retries automatically.

### Prepare a compatible WAV

The API accepts signed 16-bit PCM, mono, 16 kHz WAV for this path. Convert MP3, M4A, stereo, or another sample rate locally before calling the SDK:

```bash
ffmpeg -i input.mp3 -ac 1 -ar 16000 -c:a pcm_s16le recording.wav
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels -of default=noprint_wrappers=1 recording.wav
```

`ffprobe` should report `pcm_s16le`, `16000`, and `1`. Use 0.5–60 seconds for Batch. Renaming a file `.wav` does not convert it. Keep the recording and returned generation UUID until the final transcript is verified.

## Stream transcript revisions from an uploaded WAV

Uploaded-recording Streaming is paid. Events are parsed across network chunk boundaries. A `transcript_chunk` contains cumulative provisional text: replace the displayed value instead of appending it.

```js
let id;
for await (const { event, data } of giggy.transcriptions.stream({ audioPath: 'recording.wav' })) {
  if (event === 'generation_created') id = data.generation.generation_uuid;
  if (event === 'transcript_chunk') console.log('Replace preview:', data.text);
}
if (typeof id !== 'string') throw new Error('No admitted generation');
console.log('Final:', (await giggy.transcriptions.result(id)).text);
```

EOF alone does not prove success: `result()` checks the durable generation. If the stream fails, reconcile with `get()`.

## Live microphone PCM session

`giggy.transcriptions.live()` opens the existing paid Streaming SSE session. This runnable example replays a short recording in real time through the live input contract, so it needs no microphone device. Convert a 0.5–10 second recording to headerless PCM16 mono 16 kHz first:

```bash
ffmpeg -i input.mp3 -ac 1 -ar 16000 -f s16le live.pcm
```

Then run the following as a Node.js module with `GIGGY_API_KEY` set. The sender and SSE reader run concurrently. For a real microphone, replace the file chunks with captured PCM16 frames, keeping the same ordering, pacing, final frame, and error handling.

```js
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Giggy } from '@giggy-ai/sdk';

const pcm = await readFile('live.pcm');
if (pcm.length < 16000 || pcm.length > 320000 || pcm.length % 2) throw new Error('Use 0.5–10 seconds of PCM16 mono 16 kHz');
const giggy = new Giggy({ apiKey: process.env.GIGGY_API_KEY });
const stop = new AbortController();
let generationId;
let sender;
let senderError;
try {
  for await (const { event, data } of giggy.transcriptions.live({ signal: stop.signal })) {
    if (event === 'generation_created') generationId = data.generation.generation_uuid;
    if (event === 'microphone_ready') {
      const ready = data;
      sender = (async () => {
        let sequence = 0;
        for (let offset = 0; offset < pcm.length; offset += 3200) {
          const frame = pcm.subarray(offset, offset + 3200);
          await giggy.transcriptions.sendLiveFrame({ generationUuid: ready.generation_uuid,
            inputToken: ready.input_token, sequence: sequence++, pcm: frame, signal: stop.signal });
          await delay(frame.length / 32, undefined, { signal: stop.signal });
        }
        await giggy.transcriptions.sendLiveFrame({ generationUuid: ready.generation_uuid,
          inputToken: ready.input_token, sequence, pcm: new Uint8Array(), complete: true, signal: stop.signal });
      })().catch(error => { senderError = error; stop.abort(); });
    }
    if (event === 'transcript_chunk') console.log('Replace preview:', data.text);
  }
} catch (error) {
  if (!senderError) throw error;
}
if (sender) await sender;
if (senderError) throw senderError;
if (!generationId) throw new Error('No admitted generation');
console.log('Final:', (await giggy.transcriptions.result(generationId)).text);
```

Await each accepted frame before incrementing `sequence`; a frame is at most 32,000 bytes. Closing an unfinished live stream cancels its work. Never automatically reconnect or resend an ambiguously accepted frame. Follow the [full live input contract](https://giggy.ai/docs/speech-api#api-stt-streaming) for readiness, framing, duration, cancellation, and billing. The SDK does not provide microphone capture or turn detection.

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
- `TranscriptionSubmitParams`, `TranscriptionStreamParams`, `TranscriptionEvent`
- `TranscriptionAdmission`, `TranscriptionGeneration`, `TranscriptionResult`
- `LiveTranscriptionParams`, `LiveTranscriptionFrame`
- `giggy.speech.create(params)` → `Promise<Uint8Array>`
- `giggy.speech.stream(params)` → `Promise<ReadableStream<Uint8Array>>`
- `giggy.transcriptions.submit(params)` → admission metadata
- `giggy.transcriptions.transcribe(params, options?)` → completed transcript
- `giggy.transcriptions.get(generationUuid)` → generation status
- `giggy.transcriptions.result(generationUuid)` → completed transcript
- `giggy.transcriptions.stream(params)` → parsed SSE events
- `giggy.transcriptions.live(params)` → live SSE events
- `giggy.transcriptions.sendLiveFrame(params)` → accepted PCM frame

## Developer resources

- Documentation: https://giggy.ai/docs/speech-api
- OpenAPI: https://giggy.ai/v1/openapi.json
- Runnable integrations: https://github.com/giggy-ai/giggy-examples
- MCP: https://github.com/giggy-ai/giggy-mcp
- Python SDK: https://github.com/giggy-ai/giggy-python
- Pricing: https://giggy.ai/pricing

## Framework integration examples

- [LiveKit TTS](https://github.com/giggy-ai/giggy-examples/tree/main/livekit/python)
- [Pipecat TTS](https://github.com/giggy-ai/giggy-examples/tree/main/pipecat/python)
- [Vapi custom TTS](https://github.com/giggy-ai/giggy-examples/tree/main/vapi)
- [OpenAI-compatible TTS](https://github.com/giggy-ai/giggy-examples/tree/main/node/openai-compatible)
- [Giggy MCP](https://github.com/giggy-ai/giggy-mcp)

These examples demonstrate Giggy compatibility. LiveKit, Pipecat and Vapi integrations do not currently use this SDK internally.
