# Changelog

## 0.1.0

Initial public Giggy JavaScript/TypeScript SDK release.

### Features

- Native Giggy text-to-speech client
- Batch speech generation
- Fast speech generation
- Progressive PCM streaming
- TypeScript declarations
- Automatic idempotency keys for non-streaming requests
- AbortSignal support
- Structured HTTP API errors

### Requirements

- Node.js 22 or newer
- Giggy API key
- Giggy voice UUID

### Notes

- Streaming requests do not use idempotency headers.
- The SDK does not automatically retry synthesis requests.
- The SDK is intended for server-side use.
