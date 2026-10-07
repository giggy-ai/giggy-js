import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Giggy } from '../dist/index.js';

const apiKey = process.env.GIGGY_API_KEY;
const voiceId = process.env.GIGGY_VOICE_ID;

if (!apiKey) {
  throw new Error('Set GIGGY_API_KEY before running this example.');
}

if (!voiceId) {
  throw new Error('Set GIGGY_VOICE_ID before running this example.');
}

const giggy = new Giggy({ apiKey });
const stream = await giggy.speech.stream({
  text: 'This speech is streaming through the Giggy SDK.',
  voiceId,
});

await pipeline(
  Readable.fromWeb(stream),
  createWriteStream(new URL('./speech.pcm', import.meta.url)),
);

console.log('Wrote examples/speech.pcm (PCM16 little-endian, mono, 24000 Hz)');
