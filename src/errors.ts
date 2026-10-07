export interface GiggyAPIErrorOptions {
  status: number;
  body: string;
  method: string;
  url: string;
}

export class GiggyAPIError extends Error {
  readonly status: number;
  readonly body: string;
  readonly method: string;
  readonly url: string;

  constructor(options: GiggyAPIErrorOptions) {
    super(
      `Giggy returned HTTP ${options.status} for ` +
        `${options.method} ${options.url}: ${options.body}`,
    );

    this.name = 'GiggyAPIError';
    this.status = options.status;
    this.body = options.body;
    this.method = options.method;
    this.url = options.url;
  }
}
