import { Giggy } from '../dist/index.js';

const apiKey = process.env.GIGGY_API_KEY;
const voiceId = process.env.GIGGY_VOICE_ID;

if (!apiKey || (!voiceId && !process.env.GIGGY_STT_WAV)) {
  throw new Error('Set GIGGY_API_KEY and either GIGGY_VOICE_ID or GIGGY_STT_WAV.');
}

const giggy = new Giggy({ apiKey });

if (process.env.GIGGY_STT_WAV) {
  if (process.env.GIGGY_RUN_PAID_SMOKE !== '1') throw new Error('Recorded Fast/Streaming STT smoke requires GIGGY_RUN_PAID_SMOKE=1.');
  const transcript = await giggy.transcriptions.transcribe({ audioPath: process.env.GIGGY_STT_WAV, mode: 'fast', language: 'en' }, { timeoutMs: 120000 });
  if (!transcript.text.trim()) throw new Error('Fast STT returned no lexical transcript.');
  if (process.env.GIGGY_STT_REFERENCE && transcript.text !== process.env.GIGGY_STT_REFERENCE) throw new Error('Fast STT differs from the reference.');
  console.log('Fast STT completed:', transcript.text);
  let id;
  let previews = 0;
  for await (const { event, data } of giggy.transcriptions.stream({ audioPath: process.env.GIGGY_STT_WAV, language: 'en', signal: AbortSignal.timeout(120000) })) {
    if (event === 'generation_created') { id = data.generation.generation_uuid; console.log('Uploaded Streaming STT generation:', id); }
    if (event === 'transcript_chunk') previews++;
  }
  if (!id) throw new Error('Uploaded Streaming STT did not return an admission UUID.');
  const final = await giggy.transcriptions.result(id, AbortSignal.timeout(30000));
  if (final.text !== transcript.text || !previews) throw new Error('Uploaded Streaming STT preview or final transcript differs.');
  console.log('Uploaded Streaming STT completed:', final.text);
  process.exit(0);
}

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
