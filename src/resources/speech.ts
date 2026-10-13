import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { GiggyAPIError } from '../errors.js';
import type {
  GiggyClientConfig,
  SpeechCreateParams,
  SpeechStreamParams,
  TranscriptionSubmitParams,
  TranscriptionStreamParams,
  TranscriptionEvent,
  TranscriptionAdmission,
  TranscriptionGeneration,
  TranscriptionResult,
  LiveTranscriptionParams,
  LiveTranscriptionFrame,
} from '../types.js';

const DEFAULT_MODEL_ID = 'giggyspeech';
const DEFAULT_BATCH_OUTPUT_FORMAT = 'mp3_24000_160';
const DEFAULT_STREAM_OUTPUT_FORMAT = 'pcm_24000';

interface SpeechRequestParams {
  text: string;
  voiceId: string;
  modelId: string;
  mode: 'batch' | 'fast' | 'streaming';
  outputFormat: string;
  speed?: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export class SpeechResource {
  readonly #config: GiggyClientConfig;

  constructor(config: GiggyClientConfig) {
    this.#config = config;
  }

  async create(params: SpeechCreateParams): Promise<Uint8Array> {
    this.#validateTextAndVoice(params.text, params.voiceId);

    const response = await this.#request({
      text: params.text,
      voiceId: params.voiceId,
      modelId: params.modelId ?? DEFAULT_MODEL_ID,
      mode: params.mode ?? 'batch',
      outputFormat: params.outputFormat ?? DEFAULT_BATCH_OUTPUT_FORMAT,
      ...(params.speed === undefined ? {} : { speed: params.speed }),
      idempotencyKey: params.idempotencyKey ?? randomUUID(),
      ...(params.signal === undefined ? {} : { signal: params.signal }),
    });

    return new Uint8Array(await response.arrayBuffer());
  }

  async stream(params: SpeechStreamParams): Promise<ReadableStream<Uint8Array>> {
    this.#validateTextAndVoice(params.text, params.voiceId);

    const response = await this.#request({
      text: params.text,
      voiceId: params.voiceId,
      modelId: params.modelId ?? DEFAULT_MODEL_ID,
      mode: 'streaming',
      outputFormat: params.outputFormat ?? DEFAULT_STREAM_OUTPUT_FORMAT,
      ...(params.speed === undefined ? {} : { speed: params.speed }),
      ...(params.signal === undefined ? {} : { signal: params.signal }),
    });

    if (!response.body) {
      throw new Error(
        'Giggy returned an empty streaming response body.',
      );
    }

    const requestedFormat =
      params.outputFormat ?? DEFAULT_STREAM_OUTPUT_FORMAT;

    if (requestedFormat.startsWith('pcm_')) {
      const contentType = (
        response.headers.get('content-type') ?? ''
      ).toLowerCase();

      if (!contentType.startsWith('audio/pcm')) {
        await response.body.cancel();

        throw new Error(
          'Expected Giggy streaming PCM audio but received ' +
            `"${contentType || 'unknown'}".`,
        );
      }
    }

    return response.body;
  }

  async #request(params: SpeechRequestParams): Promise<Response> {
    const url = `${this.#config.baseURL}/text-to-speech`;
    const payload = {
      text: params.text,
      voice_id: params.voiceId,
      model_id: params.modelId,
      mode: params.mode,
      output_format: params.outputFormat,
      ...(params.speed === undefined
        ? {}
        : { voice_settings: { speed: params.speed } }),
    };
    const headers: Record<string, string> = {
      'xi-api-key': this.#config.apiKey,
      'content-type': 'application/json',
    };

    if (params.idempotencyKey !== undefined) {
      headers['idempotency-key'] = params.idempotencyKey;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      ...(params.signal === undefined ? {} : { signal: params.signal }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new GiggyAPIError({
        status: response.status,
        body,
        method: 'POST',
        url,
      });
    }

    return response;
  }

  #validateTextAndVoice(text: string, voiceId: string): void {
    if (!text.trim()) {
      throw new TypeError('text must be a non-empty string.');
    }

    if (!voiceId.trim()) {
      throw new TypeError('voiceId must be a non-empty string.');
    }
  }
}

export class TranscriptionsResource {
  readonly #config: GiggyClientConfig;

  constructor(config: GiggyClientConfig) {
    this.#config = config;
  }

  async #upload(params: TranscriptionStreamParams, mode: 'batch' | 'fast' | 'streaming'): Promise<Response> {
    if (!params.audioPath?.trim()) throw new TypeError('audioPath must be a non-empty WAV path.');
    if (params.language !== undefined && !params.language.trim()) throw new TypeError('language must not be blank.');
    if (params.clientRequestId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.clientRequestId)) {
      throw new TypeError('clientRequestId must be a UUID.');
    }
    const size = (await stat(params.audioPath)).size;
    const url = new URL(`${this.#config.baseURL}/audio/transcriptions`);
    url.searchParams.set('mode', mode);
    if (params.language !== undefined) url.searchParams.set('language', params.language);
    if (params.clientRequestId !== undefined) url.searchParams.set('client_request_id', params.clientRequestId);
    const input = createReadStream(params.audioPath);
    let response: Response;
    try {
      const uploadInit: RequestInit & { duplex: 'half' } = {
        method: 'POST',
        headers: { 'xi-api-key': this.#config.apiKey, 'content-type': 'audio/wav', 'content-length': String(size) },
        body: Readable.toWeb(input) as ReadableStream<Uint8Array>,
        duplex: 'half',
        ...(params.signal === undefined ? {} : { signal: params.signal }),
      };
      response = await fetch(url, uploadInit);
    } finally {
      input.destroy();
    }
    if (!response.ok) {
      throw new GiggyAPIError({ status: response.status, body: await response.text(), method: 'POST', url: url.toString() });
    }
    return response;
  }

  async submit(params: TranscriptionSubmitParams): Promise<TranscriptionAdmission> {
    if (params.mode !== undefined && params.mode !== 'batch' && params.mode !== 'fast') throw new TypeError('mode must be batch or fast.');
    const response = await this.#upload(params, params.mode ?? 'batch');
    if (response.status !== 202) throw new Error(`Expected HTTP 202 admission, got ${response.status}.`);
    const admission: unknown = await response.json();
    const generation = admission && typeof admission === 'object' ? (admission as Record<string, unknown>).generation : null;
    if (!generation || typeof generation !== 'object' || typeof (generation as Record<string, unknown>).generation_uuid !== 'string' || typeof (generation as Record<string, unknown>).status !== 'string') {
      throw new Error('Giggy returned an invalid transcription admission.');
    }
    return admission as TranscriptionAdmission;
  }

  async transcribe(params: TranscriptionSubmitParams, options: { pollIntervalMs?: number; timeoutMs?: number } = {}): Promise<TranscriptionResult> {
    const pollIntervalMs = options.pollIntervalMs ?? 2500;
    const timeoutMs = options.timeoutMs ?? 1_800_000;
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('pollIntervalMs and timeoutMs must be positive integers.');
    }
    const admission = await this.submit(params);
    const id = admission.generation.generation_uuid;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const generation = await this.get(id, params.signal);
      if (generation.status === 'completed') return this.result(id, params.signal);
      if (['failed', 'cancelled', 'admission_failed'].includes(generation.status)) {
        throw new Error(`Transcription ${id} is ${generation.status}.`);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Transcription ${id} did not complete within ${timeoutMs} ms.`);
      await delay(Math.min(pollIntervalMs, remaining), undefined, params.signal === undefined ? {} : { signal: params.signal });
    }
  }

  async get(generationUuid: string, signal?: AbortSignal): Promise<TranscriptionGeneration> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generationUuid)) {
      throw new TypeError('generationUuid must be a UUID.');
    }
    generationUuid = generationUuid.toLowerCase();
    const url = `${this.#config.baseURL}/generations/${generationUuid}`;
    const response = await fetch(url, { headers: { 'xi-api-key': this.#config.apiKey }, ...(signal === undefined ? {} : { signal }) });
    if (!response.ok) throw new GiggyAPIError({ status: response.status, body: await response.text(), method: 'GET', url });
    const body: unknown = await response.json();
    const generation = body && typeof body === 'object' ? (body as Record<string, unknown>).generation : null;
    if (!generation || typeof generation !== 'object' || (generation as Record<string, unknown>).generation_uuid !== generationUuid) {
      throw new Error('Giggy returned an invalid generation.');
    }
    if (typeof (generation as Record<string, unknown>).status !== 'string') throw new Error('Giggy returned an invalid generation status.');
    return generation as TranscriptionGeneration;
  }

  async result(generationUuid: string, signal?: AbortSignal): Promise<TranscriptionResult> {
    const generation = await this.get(generationUuid, signal);
    if (generation.status !== 'completed') throw new Error(`Transcription is ${String(generation.status)}.`);
    const url = generation.result?.url;
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Transcript is no longer available.');
    const response = await fetch(url, signal === undefined ? {} : { signal });
    if (!response.ok) throw new Error(`Transcript artifact returned HTTP ${response.status}.`);
    const transcript: unknown = await response.json();
    if (!transcript || typeof transcript !== 'object' || typeof (transcript as Record<string, unknown>).text !== 'string') {
      throw new Error('Giggy returned an invalid transcript.');
    }
    return transcript as TranscriptionResult;
  }

  async *stream(params: TranscriptionStreamParams): AsyncGenerator<TranscriptionEvent> {
    const response = await this.#upload(params, 'streaming');
    if (response.status !== 200 || !(response.headers.get('content-type') ?? '').includes('text/event-stream') || !response.body) {
      await response.body?.cancel();
      throw new Error('Giggy did not return a transcript event stream.');
    }
    yield* this.#events(response);
  }

  async *live(params: LiveTranscriptionParams = {}): AsyncGenerator<TranscriptionEvent> {
    if (params.clientRequestId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.clientRequestId)) {
      throw new TypeError('clientRequestId must be a UUID.');
    }
    const url = `${this.#config.baseURL}/audio/transcriptions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': this.#config.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'streaming', microphone: true,
        ...(params.clientRequestId === undefined ? {} : { client_request_id: params.clientRequestId }) }),
      ...(params.signal === undefined ? {} : { signal: params.signal }),
    });
    if (!response.ok) throw new GiggyAPIError({ status: response.status, body: await response.text(), method: 'POST', url });
    if (response.status !== 200 || !(response.headers.get('content-type') ?? '').includes('text/event-stream') || !response.body) {
      await response.body?.cancel();
      throw new Error('Giggy did not return a live transcript event stream.');
    }
    yield* this.#events(response);
  }

  async sendLiveFrame(params: LiveTranscriptionFrame): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.generationUuid)) {
      throw new TypeError('generationUuid must be a UUID.');
    }
    if (!/^[0-9a-f]{64}$/.test(params.inputToken)) throw new TypeError('inputToken must be the microphone_ready capability.');
    if (!Number.isSafeInteger(params.sequence) || params.sequence < 0) throw new TypeError('sequence must be a nonnegative integer.');
    if (!(params.pcm instanceof Uint8Array) || params.pcm.byteLength > 32000 || params.pcm.byteLength % 2 || (!params.pcm.byteLength && !params.complete)) {
      throw new TypeError('pcm must be an even PCM16 byte frame of at most one second.');
    }
    const base = new URL(this.#config.baseURL);
    if (base.pathname.replace(/\/$/, '') !== '/v1') throw new TypeError('baseURL must end with /v1 for live input.');
    const url = new URL(`/api/generations/${params.generationUuid.toLowerCase()}/stt-input`, base).toString();
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input_token: params.inputToken, sequence: params.sequence,
        pcm_base64: Buffer.from(params.pcm).toString('base64'), complete: params.complete === true }),
      ...(params.signal === undefined ? {} : { signal: params.signal }),
    });
    if (!response.ok) throw new GiggyAPIError({ status: response.status, body: await response.text(), method: 'POST', url });
    const accepted: unknown = await response.json();
    if (!accepted || typeof accepted !== 'object' || (accepted as Record<string, unknown>).ok !== true) {
      throw new Error('Giggy did not accept the PCM frame.');
    }
  }

  async *#events(response: Response): AsyncGenerator<TranscriptionEvent> {
    if (!response.body) throw new Error('Giggy returned an empty event stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        pending = pending.replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = pending.indexOf('\n\n')) !== -1) {
          const frame = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const lines = frame.split('\n');
          const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() ?? '';
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          const payload: unknown = JSON.parse(data);
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Giggy returned an invalid transcript event.');
          yield { event, data: payload as Record<string, unknown> };
        }
        if (done) {
          if (pending.trim()) throw new Error('Transcript event stream ended mid-event.');
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
