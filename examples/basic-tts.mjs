import { writeFile } from 'node:fs/promises';

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
const audio = await giggy.speech.create({
  text: 'Hello from the Giggy SDK.',
  voiceId,
});

await writeFile(new URL('./speech.mp3', import.meta.url), audio);
console.log('Wrote examples/speech.mp3');
