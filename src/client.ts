import { SpeechResource } from './resources/speech.js';
import type {
  GiggyClientConfig,
  GiggyClientOptions,
} from './types.js';

const DEFAULT_BASE_URL = 'https://giggy.ai/v1';

export class Giggy {
  readonly speech: SpeechResource;

  constructor(options: GiggyClientOptions) {
    if (!options?.apiKey?.trim()) {
      throw new TypeError('Giggy requires a non-empty apiKey.');
    }

    const config: GiggyClientConfig = {
      apiKey: options.apiKey,
      baseURL: (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    };

    this.speech = new SpeechResource(config);
  }
}
