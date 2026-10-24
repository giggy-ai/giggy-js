import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
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
  readonly #live = new Map<string, { socket: WebSocket; attempt: number; sequence: number; bytes: number; ended: boolean; acknowledged: boolean; sending: boolean }>();

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
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 4_294_967_295) {
      throw new TypeError('pollIntervalMs must be a positive integer; timeoutMs must be an integer between 1 and 4294967295.');
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = params.signal === undefined ? timeoutSignal : AbortSignal.any([params.signal, timeoutSignal]);
    let id: string | undefined;
    const deadline = Date.now() + timeoutMs;
    try {
      const admission = await this.submit({ ...params, signal });
      id = admission.generation.generation_uuid;
      while (true) {
        signal.throwIfAborted();
        const generation = await this.get(id, signal);
        if (generation.status === 'completed') return await this.result(id, signal);
        if (['failed', 'cancelled', 'admission_failed'].includes(generation.status)) {
          throw new Error(`Transcription ${id} is ${generation.status}.`);
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`Transcription ${id} did not complete within ${timeoutMs} ms.`);
        await delay(Math.min(pollIntervalMs, remaining), undefined, { signal });
      }
    } catch (error) {
      if (timeoutSignal.aborted && !params.signal?.aborted) {
        throw new Error(`Transcription ${id ?? 'admission (generation UUID not received)'} did not complete within ${timeoutMs} ms; do not resubmit an ambiguous upload.`, { cause: error });
      }
      throw error;
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
    if (params.clientRequestId !== undefined) throw new TypeError('Live WebSocket identities are assigned by the server; omit clientRequestId.');
    const base = new URL(this.#config.baseURL);
    if (base.pathname.replace(/\/$/, '') !== '/v1' || base.username || base.password || base.search || base.hash || !['http:', 'https:'].includes(base.protocol)) throw new TypeError('baseURL must be an API origin ending with /v1.');
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new TypeError('Live STT requires HTTPS except for loopback fixtures.');
    if (params.timeoutMs !== undefined && (!Number.isSafeInteger(params.timeoutMs) || params.timeoutMs <= 0 || params.timeoutMs > 4_294_967_295)) throw new TypeError('timeoutMs must be a positive integer no greater than 4294967295.');
    params.signal?.throwIfAborted();
    const url = new URL('/v1/audio/transcriptions', base);
    url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { headers: { 'xi-api-key': this.#config.apiKey },
      followRedirects: false, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024, handshakeTimeout: 10000 });
    const signal = AbortSignal.any([AbortSignal.timeout(params.timeoutMs ?? 150000), ...(params.signal ? [params.signal] : [])]);
    const queue: Record<string, any>[] = [];
    let wake: (() => void) | undefined, failure: Error | undefined, id: string | undefined;
    let closed = false, terminal = false, queuedBytes = 0, lastSequence = -1, finalText: string | undefined;
    socket.on('message', (bytes, binary) => {
      try {
        if (binary) throw new Error('Unexpected binary STT response.');
        const data = Array.isArray(bytes) ? Buffer.concat(bytes) : Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        const value = JSON.parse(data.toString());
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid live STT event.');
        queuedBytes += Buffer.byteLength(JSON.stringify(value));
        if (queuedBytes > 16 * 1024 * 1024 || queue.length >= 1024) throw new Error('Live STT event queue exceeded its bound.');
        queue.push(value); wake?.();
      } catch { failure = new Error('Invalid live STT response; reconcile its generation.'); socket.terminate(); wake?.(); }
    });
    socket.on('error', () => { failure = new Error('Live STT transport failed; no audio was retried.'); wake?.(); });
    socket.on('close', () => { closed = true; wake?.(); });
    const abort = () => { failure = new Error('Live STT aborted or timed out; reconcile its generation.'); socket.terminate(); wake?.(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve); socket.once('error', () => reject(new Error('Cannot open live STT socket.')));
        socket.once('close', () => reject(new Error('Live STT socket closed before opening.')));
        if (signal.aborted) abort();
      });
      socket.send(JSON.stringify({ type: 'start', format: 'raw', encoding: 'LINEAR16', sampleRateHz: 16000,
        interimResults: true, options: { endpointing: 'external' }, ...(params.language ? { language: params.language } : {}) }));
      for (;;) {
        if (failure) throw failure;
        const payload = queue.shift();
        if (!payload) {
          if (closed) { if (!terminal) throw new Error('Live STT closed without verified completion.'); break; }
          await new Promise<void>(resolve => { wake = resolve; }); wake = undefined; continue;
        }
        queuedBytes -= Buffer.byteLength(JSON.stringify(payload));
        if (payload.type === 'generation_created') {
          const admitted = payload.generation_uuid ?? payload.generation?.generation_uuid;
          if (id || typeof admitted !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(admitted)) throw new Error('Invalid live admission identity.');
          id = admitted;
          yield { event: 'generation_created', data: { ...payload, generation: payload.generation ?? { generation_uuid: id, status: 'processing' } } };
        } else if (payload.type === 'ready') {
          if (!id || payload.generation_uuid !== id || this.#live.has(id) || !Number.isSafeInteger(payload.attempt) || payload.attempt < 1 || payload.sampleRateHz !== 16000) throw new Error('Invalid live STT readiness.');
          this.#live.set(id, { socket, attempt: payload.attempt, sequence: 0, bytes: 0, ended: false, acknowledged: false, sending: false });
          yield { event: 'microphone_ready', data: { generation_uuid: id, attempt: payload.attempt } };
        } else if (payload.type === 'input_complete') {
          const state = id ? this.#live.get(id) : undefined;
          if (!state || payload.generation_uuid !== id || !state.ended || state.acknowledged || payload.sequence !== state.sequence) throw new Error('Invalid live final input acknowledgement.');
          state.acknowledged = true;
          yield { event: 'input_complete', data: { generation_uuid: id!, sequence: payload.sequence } };
        } else if (payload.type === 'transcription') {
          const state = id ? this.#live.get(id) : undefined;
          const text = payload.alternatives?.[0]?.transcript;
          if (!state || payload.generation_uuid !== id || payload.attempt !== state.attempt || !Number.isSafeInteger(payload.sequence) || payload.sequence <= lastSequence || payload.replace !== true || typeof payload.is_final !== 'boolean' || typeof text !== 'string' || finalText !== undefined) throw new Error('Invalid live transcript fence.');
          lastSequence = payload.sequence;
          if (payload.is_final) {
            if (!state.ended || !state.acknowledged) throw new Error('Final transcript preceded acknowledged input completion.');
            finalText = text;
          }
          yield { event: 'transcript_chunk', data: { generation_uuid: id!, attempt: state.attempt, sequence: payload.sequence, replace: true, complete: payload.is_final, text } };
        } else if (payload.type === 'generation_updated') {
          if (!id || payload.generation_uuid !== id) throw new Error('Live generation identity changed.');
          const status = payload.status ?? payload.generation?.status;
          if (['failed', 'cancelled', 'admission_failed'].includes(status)) throw new Error('Live STT generation failed; no audio was replayed.');
          if (status === 'completed') {
            const state = this.#live.get(id);
            if (!state?.acknowledged || finalText === undefined) throw new Error('Live STT completed without a fenced final.');
            const result = await this.result(id, signal);
            if (result.text !== finalText || result.audio_duration_ms !== Math.ceil(state.bytes / 32)) throw new Error('Saved transcript or duration differs from live STT.');
            terminal = true;
          }
          yield { event: 'generation_updated', data: payload as any };
          if (terminal) break;
        } else throw new Error('Unexpected live STT event; reconcile its generation.');
      }
    } finally {
      signal.removeEventListener('abort', abort);
      if (id) this.#live.delete(id);
      socket.terminate();
    }
  }

  async sendLiveFrame(params: LiveTranscriptionFrame): Promise<void> {
    const state = this.#live.get(params.generationUuid);
    if (!state || state.ended || state.sending || params.sequence !== state.sequence) throw new TypeError('Live frame must match the ready session and next sequence.');
    if (!(params.pcm instanceof Uint8Array) || params.pcm.byteLength > 32000 || params.pcm.byteLength % 2 || (!params.pcm.byteLength && !params.complete) || (params.complete !== undefined && typeof params.complete !== 'boolean') || state.bytes + params.pcm.byteLength > 43200000 * 32) throw new TypeError('Invalid PCM16 frame or admitted duration.');
    params.signal?.throwIfAborted();
    if (state.socket.readyState !== WebSocket.OPEN || state.socket.bufferedAmount > 32000) throw new Error('Live audio socket is unavailable or backpressured.');
    state.sending = true;
    try {
      if (params.pcm.byteLength) {
        await new Promise<void>((resolve, reject) => state.socket.send(params.pcm, { binary: true }, error => error ? reject(new Error('Live audio send failed; no replay.')) : resolve()));
        state.bytes += params.pcm.byteLength; state.sequence++;
      }
      if (params.complete) {
        state.ended = true;
        await new Promise<void>((resolve, reject) => state.socket.send(JSON.stringify({ type: 'stop' }), error => error ? reject(new Error('Live stop failed; no replay.')) : resolve()));
      }
    } finally { state.sending = false; }
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
          if (!['generation_created', 'microphone_ready', 'transcript_chunk', 'generation_updated'].includes(event)) {
            throw new Error(`Unexpected transcript event: ${event || '(unnamed)'}. Reconcile the generation through get().`);
          }
          yield { event, data: payload } as TranscriptionEvent;
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
