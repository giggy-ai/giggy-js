import { randomUUID } from 'node:crypto';

import { GiggyAPIError } from '../errors.js';
import type {
  GiggyClientConfig,
  SpeechCreateParams,
  SpeechStreamParams,
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
      throw new Error('Giggy returned an empty streaming response body.');
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
