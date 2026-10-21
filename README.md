# Giggy Speech SDK for Node.js and TypeScript

[![SDK CI](https://github.com/giggy-ai/giggy-js/actions/workflows/ci.yml/badge.svg)](https://github.com/giggy-ai/giggy-js/actions/workflows/ci.yml)

Official JavaScript and TypeScript SDK for Giggy text-to-speech, recorded-audio speech-to-text and short live PCM transcription sessions.

Start with [one-call recording transcription](#transcribe-a-recording), [uploaded-WAV transcript revisions](#stream-transcript-revisions-from-an-uploaded-wav), or [live PCM replay](#live-microphone-pcm-session). The Node live example replays a file through the live input protocol; applications supply microphone capture. Live input is PCM16 mono 16 kHz, 0.5–30 seconds per session.

Giggy provides text-to-speech and speech-to-text APIs for developers building voice agents and voice-enabled products.

## Install

Requires Node.js 22 or newer.

```bash
npm install @giggy-ai/sdk
```

STT is available in the published **0.1.1** release. Install `npm install @giggy-ai/sdk@0.1.1` to reproduce these examples. Version 0.1.0 provides TTS only.

Choose another integration in the [developer tool guide](https://giggy.ai/docs/speech-api#api-developer-tools): [Python](https://github.com/giggy-ai/giggy-python), [Pipecat TTS/live STT](https://github.com/giggy-ai/pipecat-giggy), [n8n TTS](https://github.com/giggy-ai/n8n-nodes-giggy), or [MCP speech/transcription tools](https://github.com/giggy-ai/giggy-mcp). For executable recording and TTS walkthroughs, use [giggy-examples](https://github.com/giggy-ai/giggy-examples).

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

## Transcription method reference

All methods belong to `giggy.transcriptions`. SDK defaults select free Batch; the REST endpoint defaults to paid Fast.

| Method | Inputs and defaults | Returns |
| --- | --- | --- |
| `transcribe(params, { pollIntervalMs: 2500, timeoutMs: 1800000 })` | `audioPath`, optional Batch/Fast `mode`, `language`, `clientRequestId`, `signal` | Promise of the final transcript |
| `submit(params)` | The same WAV admission parameters | Promise of admission metadata |
| `get(uuid, signal?)` | Owning generation UUID | Promise of generation status |
| `result(uuid, signal?)` | Completed generation UUID | Promise of signed transcript JSON; no API key sent to artifact host |
| `stream(params)` | `audioPath`, optional `language/clientRequestId/signal`; paid Streaming | Async generator of typed transcript events |
| `live({ clientRequestId?, signal? })` | Paid live admission; automatic language detection | Async generator of typed transcript events |
| `sendLiveFrame({ generationUuid, inputToken, sequence, pcm, complete?, signal? })` | Ordered PCM16 Uint8Array; even length; maximum 32,000 bytes | Promise<void> after acknowledged acceptance |

`transcribe` applies a single deadline from before upload through status polling and artifact retrieval. Its timeout is combined with your AbortSignal; aborting either interrupts network I/O and polling waits. A timeout or abort stops this client call, but does not cancel an admitted uploaded recording. The error contains its UUID when admission was received. `timeoutMs` must be an integer from 1 to 4294967295; `pollIntervalMs` must be a positive integer. Other methods accept your signal so your application can set its own deadline.

`TranscriptionEvent` is a discriminated union: checking `event` narrows `data` to the existing payload. For `generation_created`, read `data.generation.generation_uuid`; for `microphone_ready`, read `data.generation_uuid/attempt/input_token`; for `transcript_chunk`, use `data.text/sequence/replace/complete`; for `generation_updated`, read `data.status` and optional `data.generation`. Never persist the input token. Replace cumulative preview text, and reconcile durable completion after EOF. The SDK rejects an unknown named event rather than silently treating it as a supported payload.

## Troubleshooting and migration

### Migrating OpenAI speech and transcription

OpenAI-compatible **TTS** uses `https://giggy.ai/v1/audio/speech`. Keep the OpenAI speech client, set `baseURL: 'https://giggy.ai/v1'`, use your Giggy API key, set `model: 'giggyspeech'`, and use a Giggy voice UUID. Choose a supported response format and set `maxRetries: 0` for synthesis. See the [existing OpenAI-client example](https://github.com/giggy-ai/giggy-examples/tree/main/node/openai-compatible).

**STT is a separate contract.** Replace an OpenAI `audio.transcriptions.create(...)` call with `giggy.transcriptions.transcribe({ audioPath: 'recording.wav', mode: 'batch' })` and consume `result.text`. A `baseURL` change alone does not migrate STT: Giggy's REST input is raw WAV with `xi-api-key`, rather than an OpenAI multipart upload, and its Batch/Fast admission returns a generation UUID before the final transcript. The SDK handles that existing lifecycle. SDK transcription defaults to Batch; raw REST defaults to paid Fast. Convert input locally to PCM16 mono 16 kHz WAV and remove unsupported transcription options rather than inventing fields.

| Symptom | Action |
| --- | --- |
| `transcriptions` is undefined | Check your installed package: STT starts at 0.1.1; 0.1.0 is TTS only. |
| HTTP 401/403 | Check key validity and its owning space. Keep the key on your server. |
| HTTP 429 | Stop new admissions and honor the server response; never replay an ambiguous upload automatically. |
| Upload timeout before a UUID | Keep the original input/request identity and inspect History before submitting again. `clientRequestId` is not an idempotency guarantee. |
| Timeout or SSE EOF after a UUID | Use `get(uuid)` to distinguish processing from failure, then `result(uuid)` on completion. |
| Completed result missing/expired | Read status again with the owning key; use a refreshed signed URL when available. Retention or deletion can remove content permanently. |
| Live input error | Abort/close the live generator and reconcile status. Unfinished live disconnects cancel work; uploaded-WAV disconnects do not. |
| Empty text | No speech was detected; inspect the actual recording. |

HTTP API failures raise `GiggyAPIError` with status and raw body. Parameter errors raise `TypeError`. Transcription timeouts and malformed/unavailable/terminal failed results raise `Error`; caller abort preserves the signal's reason. Log UUIDs and statuses, not signed URLs, keys or live input tokens.

To migrate an AssemblyAI recording workflow, map `client.transcripts.transcribe({ audio })` to `giggy.transcriptions.transcribe({ audioPath: wavPath })`. The result's `text` remains a string, but URLs and arbitrary media need local conversion to PCM16 mono 16 kHz WAV. Speaker labels, word times, confidence, subtitles and speech-analysis options have no corresponding Giggy fields. Live event handling must follow cumulative revisions and explicit session completion, with 30 seconds of audio and 35 seconds from readiness; AssemblyAI turn detection options do not translate to Giggy request fields.

See the [Node recording walkthrough](https://github.com/giggy-ai/giggy-examples/tree/main/node/basic-tts#transcribe-a-recording) and [framework STT guide](https://github.com/giggy-ai/giggy-examples#stt-in-voice-agent-frameworks).
