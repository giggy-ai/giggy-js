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

export interface TranscriptionSubmitParams {
  audioPath: string;
  mode?: 'batch' | 'fast';
  language?: string;
  clientRequestId?: string;
  signal?: AbortSignal;
}

export interface TranscriptionStreamParams {
  audioPath: string;
  language?: string;
  clientRequestId?: string;
  signal?: AbortSignal;
}

export interface LiveTranscriptionParams {
  clientRequestId?: string;
  signal?: AbortSignal;
}

export interface LiveTranscriptionFrame {
  generationUuid: string;
  inputToken: string;
  sequence: number;
  pcm: Uint8Array;
  complete?: boolean;
  signal?: AbortSignal;
}

export interface TranscriptionEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface TranscriptionAdmission {
  generation: TranscriptionGeneration;
  [key: string]: unknown;
}

export interface TranscriptionGeneration {
  generation_uuid: string;
  status: string;
  result?: { url?: string | null; [key: string]: unknown } | null;
  [key: string]: unknown;
}

export interface TranscriptionResult {
  text: string;
  languages?: string[];
  audio_duration_ms?: number;
  model?: string;
  model_revision?: string;
  source_commit?: string;
  [key: string]: unknown;
}
