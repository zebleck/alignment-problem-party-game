// ElevenLabs speech. Without a key, tts() returns null (the table screen then
// uses the browser's built-in voice) and voice questions are switched off.

import crypto from 'node:crypto';

export function createSpeech({ apiKey, voiceId = 'JBFqnCBsd6RMkjVDRZzb', ttsModel = 'eleven_flash_v2_5', sttModel = 'scribe_v2' } = {}) {
  const clips = new Map(); // id -> Buffer (mp3)
  const enabled = !!apiKey;

  async function tts(text) {
    if (!enabled) return null;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: ttsModel }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const id = crypto.randomUUID();
    clips.set(id, Buffer.from(await res.arrayBuffer()));
    if (clips.size > 40) clips.delete(clips.keys().next().value);
    return `/audio/${id}`;
  }

  async function stt(buffer, mime = 'audio/webm') {
    if (!enabled) throw new Error('Voice questions need an ElevenLabs key. Please type your question.');
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
    const form = new FormData();
    form.append('model_id', sttModel);
    form.append('file', new Blob([buffer], { type: mime }), `question.${ext}`);
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = await res.json();
    return String(data.text || '').trim();
  }

  return { ttsEnabled: enabled, sttEnabled: enabled, tts, stt, clip: (id) => clips.get(id) || null };
}
