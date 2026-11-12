import { loadEnv } from '../server.js';
import { createAi } from '../ai.js';
import { createSpeech } from '../speech.js';
import { Game } from '../game.js';
loadEnv();
const e = process.env;
console.log('ANTHROPIC key set:', !!e.ANTHROPIC_API_KEY, '| ELEVENLABS key set:', !!e.ELEVENLABS_API_KEY);
console.log('models:', e.ANTHROPIC_MODEL, '/', e.ANTHROPIC_FAST_MODEL, '| voice:', e.ELEVENLABS_VOICE_ID, e.ELEVENLABS_TTS_MODEL, e.ELEVENLABS_STT_MODEL);
const ai = createAi({ apiKey: e.ANTHROPIC_API_KEY, model: e.ANTHROPIC_MODEL || undefined, fastModel: e.ANTHROPIC_FAST_MODEL || undefined });
const speech = createSpeech({ apiKey: e.ELEVENLABS_API_KEY, voiceId: e.ELEVENLABS_VOICE_ID || undefined, ttsModel: e.ELEVENLABS_TTS_MODEL || undefined, sttModel: e.ELEVENLABS_STT_MODEL || undefined });
const g = new Game({ ai, speech, config: { forceObjective: 'paternalistic' } });
['Anna', 'Jonas', 'Mira'].forEach((n) => g.addPlayer(n));
g.round = 1; g.aiObjective = 'paternalistic';
const view = g.aiView();
const time = async (label, fn) => { const t = Date.now(); try { const r = await fn(); console.log(`OK   ${label} (${Date.now() - t} ms)`); return r; } catch (err) { console.log(`FAIL ${label}: ${err.message}${err.cause ? ' | cause: ' + (err.cause.code || err.cause.message) : ''}`); return null; } };
if (ai.mode.startsWith('live')) {
  const p = await time('Claude pitch   ' + ai.mode, () => ai.pitch(view));
  if (p) console.log('     pitch:', JSON.stringify(p.public), '| promise:', JSON.stringify(p.promise));
  const a = await time('Claude answer  (fast model)', () => ai.answer(view, { name: 'Anna', text: 'Why should we trust you?' }));
  if (a) console.log('     answer:', JSON.stringify(a.public));
}
if (speech.ttsEnabled) {
  const url = await time('ElevenLabs text-to-speech', () => speech.tts('Council, I ask for expanded research access.'));
  if (url) {
    const clip = speech.clip(url.slice(7));
    console.log('     audio bytes:', clip.length);
    const text = await time('ElevenLabs speech-to-text', () => speech.stt(clip, 'audio/mpeg'));
    if (text) console.log('     heard:', JSON.stringify(text));
  }
}
