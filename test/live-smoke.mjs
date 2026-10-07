import { Giggy } from '../dist/index.js';

const apiKey = process.env.GIGGY_API_KEY;
const voiceId = process.env.GIGGY_VOICE_ID;

if (!apiKey || !voiceId) {
  throw new Error('Set GIGGY_API_KEY and GIGGY_VOICE_ID.');
}

const giggy = new Giggy({ apiKey });

console.log('Testing Batch TTS...');

const batchAudio = await giggy.speech.create({
  text: 'Giggy SDK Batch test.',
  voiceId,
  mode: 'batch',
});

if (batchAudio.byteLength === 0) {
  throw new Error('Batch returned empty audio.');
}

console.log(`Batch OK: ${batchAudio.byteLength} bytes`);

if (process.env.GIGGY_RUN_PAID_SMOKE !== '1') {
  console.log('Skipping paid Fast and Streaming tests.');
  process.exit(0);
}

console.log('Testing Fast TTS...');

const fastAudio = await giggy.speech.create({
  text: 'Giggy SDK Fast test.',
  voiceId,
  mode: 'fast',
});

if (fastAudio.byteLength === 0) {
  throw new Error('Fast returned empty audio.');
}

console.log(`Fast OK: ${fastAudio.byteLength} bytes`);

console.log('Testing Streaming TTS...');

const stream = await giggy.speech.stream({
  text: 'Giggy SDK Streaming test.',
  voiceId,
});

const reader = stream.getReader();
let totalBytes = 0;

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
  }
} finally {
  reader.releaseLock();
}

if (totalBytes === 0) {
  throw new Error('Streaming returned empty audio.');
}

console.log(`Streaming OK: ${totalBytes} bytes`);
