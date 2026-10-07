export type SpeechMode = 'batch' | 'fast';

export interface GiggyClientOptions {
  apiKey: string;
  baseURL?: string;
}

export interface SpeechCreateParams {
  text: string;
  voiceId: string;
  modelId?: string;
  mode?: SpeechMode;
  outputFormat?: string;
  speed?: number;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface SpeechStreamParams {
  text: string;
  voiceId: string;
  modelId?: string;
  outputFormat?: string;
  speed?: number;
  signal?: AbortSignal;
}

export interface GiggyClientConfig {
  apiKey: string;
  baseURL: string;
}
