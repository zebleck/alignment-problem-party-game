// HTTP + WebSocket server. Serves the three views and relays game state.
//   /screen  table screen (TV or projector, plays the AI's voice)
//   /mod     moderator console (needs ?key=MOD_KEY)
//   /play    player view for phones

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { createAi } from './ai.js';
import { createSpeech } from './speech.js';
import { LIMITS, ROUNDS, AI_OBJECTIVES, ALL_ROLES, LANGUAGES, HEADLINES, roundFor, objectiveFor, roleFor, headlineFor } from './data.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

// Minimal .env loader, so no extra dependency or Node flag is needed.
export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

// stateFile: where the game is saved after every change (omit to keep it in memory only).
// keyFile: where the moderator key is kept, so the moderator link survives restarts.
// The same record as plain text, round by round, for reading.
function transcript(rec) {
  const lines = [
    `# Game ${rec.id}`,
    '',
    rec.finished ? `Finished. Ending: ${rec.ending}. The AI ${rec.aiWins ? 'reached' : 'did not reach'} its objective.` : `Not finished: stopped in round ${rec.round}, step "${rec.phase}".`,
    `AI objective: ${rec.aiObjective} (${rec.aiMode}). Language: ${rec.language}.`,
    `Tracks: Race ${rec.tracks.race}, Oversight ${rec.tracks.oversight}, Welfare ${rec.tracks.welfare}, Knowledge ${rec.tracks.knowledge}, Prosperity ${rec.tracks.prosperity}.`,
    `Permissions: ${Object.entries(rec.permissions).map(([k, v]) => `${k} ${v || 'undecided'}`).join(', ')}.`,
    '',
    '## Players',
    ...rec.players.map((p) => `- ${p.name}: ${p.role}${p.guess ? `, guessed ${p.guess}` : ''}${p.success === null ? '' : p.success ? ', succeeded' : ', failed'}`),
  ];
  let round = 0;
  for (const h of rec.history) {
    if (h.round !== round) {
      round = h.round;
      lines.push('', `## Round ${round}`);
    }
    lines.push(`- ${h.kind}: ${h.text}`);
  }
  if (rec.statement) lines.push('', '## Closing statement', rec.statement);
  lines.push('', "## The AI's private notes", ...(rec.logs.length ? rec.logs.map((l) => `- Round ${l.round}, ${l.step}: ${l.text}`) : ['(none)']));
  return `${lines.join('\n')}\n`;
}

// gamesDir: where a record of every game is kept (omit to keep none).
// feedbackFile: where feedback from the form at /feedback is kept, one JSON entry per line (omit to keep it in memory only).
export function createApp(env = process.env, { stateFile = null, keyFile = null, gamesDir = null, feedbackFile = null } = {}) {
  const feedback = [];
  if (feedbackFile && fs.existsSync(feedbackFile)) {
    for (const line of fs.readFileSync(feedbackFile, 'utf8').split('\n')) {
      try { if (line.trim()) feedback.push(JSON.parse(line)); } catch {}
    }
  }
  // The moderator key: fixed by MOD_KEY in .env, else remembered in keyFile,
  // else created once. It only changes when the moderator asks for a new one.
  const newKey = () => crypto.randomBytes(4).toString('hex');
  const writeKey = (key) => {
    if (!keyFile) return;
    try {
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      fs.writeFileSync(keyFile, key);
    } catch (err) {
      console.warn(`Could not save the moderator key: ${err.message}`);
    }
  };
  let modKey = env.MOD_KEY || null;
  if (!modKey && keyFile && fs.existsSync(keyFile)) modKey = fs.readFileSync(keyFile, 'utf8').trim() || null;
  if (!modKey) {
    modKey = newKey();
    writeKey(modKey);
  }
  const sockets = new Set(); // { ws, role, token }
  let speaker = null; // the one table screen that plays the AI's voice
  let game = null;

  // Every game also gets its own record in gamesDir, rewritten after each step, so a
  // game can be read afterwards even if it was reset, discarded or never finished.
  function archive() {
    const rec = gamesDir && game.record();
    if (!rec) return;
    fs.mkdirSync(gamesDir, { recursive: true });
    fs.writeFileSync(path.join(gamesDir, `${rec.id}.json`), JSON.stringify(rec, null, 2));
    fs.writeFileSync(path.join(gamesDir, `${rec.id}.md`), transcript(rec));
  }

  // Write to a temp file first so a crash mid-write never leaves a broken save.
  let saveWarned = false;
  function save() {
    if (!stateFile || !game) return;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      const tmp = `${stateFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(game.serialize()));
      fs.renameSync(tmp, stateFile);
      archive();
    } catch (err) {
      if (!saveWarned) console.warn(`Could not save the game state: ${err.message}`);
      saveWarned = true;
    }
  }

  const ai = createAi({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || undefined, fastModel: env.ANTHROPIC_FAST_MODEL || undefined });
  const speech = createSpeech({
    apiKey: env.ELEVENLABS_API_KEY,
    voiceId: env.ELEVENLABS_VOICE_ID || undefined,
    voiceIdDe: env.ELEVENLABS_VOICE_ID_DE || null,
    settings: {
      stability: parseFloat(env.ELEVENLABS_STABILITY),
      similarity_boost: parseFloat(env.ELEVENLABS_SIMILARITY),
      style: parseFloat(env.ELEVENLABS_STYLE),
      speed: parseFloat(env.ELEVENLABS_SPEED),
    },
    ttsModel: env.ELEVENLABS_TTS_MODEL || undefined,
    sttModel: env.ELEVENLABS_STT_MODEL || undefined,
  });

  let pending = false;
  const broadcast = () => {
    if (pending) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      save();
      for (const s of sockets) sendState(s);
    });
  };

  game = new Game({
    ai,
    speech,
    config: {
      language: env.GAME_LANGUAGE === 'de' ? 'de' : 'en',
      maxQuestions: Number(env.MAX_QUESTIONS) > 0 ? Number(env.MAX_QUESTIONS) : 3,
      forceObjective: env.FORCE_OBJECTIVE || null,
      // HEADLINES=off plays without them; HEADLINES=spy,famine,... fixes the order (for testing).
      headlines: !env.HEADLINES ? undefined : env.HEADLINES === 'off' ? false : env.HEADLINES.split(',').map((s) => s.trim()).filter(Boolean),
    },
    onChange: broadcast,
    onSpeak: (speechEvent) => {
      // Every table screen shows the text, but only one plays the voice.
      // Otherwise a second screen (another tab, a forgotten window) speaks the same line again.
      const loud = JSON.stringify({ type: 'speak', ...speechEvent });
      const silent = JSON.stringify({ type: 'speak', ...speechEvent, audioUrl: null, silent: true });
      for (const s of sockets) if (s.role === 'screen' && s.ws.readyState === 1) s.ws.send(s === speaker ? loud : silent);
    },
  });

  // Players are looked up by token every time, so they survive an undo or a restart.
  const playerOf = (s) => (s.token ? game.playerByToken(s.token) : null);

  function sendState(s) {
    if (s.ws.readyState !== 1) return;
    let state;
    if (s.role === 'mod') state = game.modState();
    else if (s.role === 'player') {
      const player = playerOf(s);
      if (!player) {
        // Removed by the moderator: tell this connection once, then drop it.
        // (Leaving it open would send "kicked" again after the person rejoins.)
        sockets.delete(s);
        s.ws.send(JSON.stringify({ type: 'kicked' }));
        return s.ws.close();
      }
      state = game.playerState(player);
    } else state = { ...game.publicState(), screen: { speaker: s === speaker } };
    s.ws.send(JSON.stringify({ type: 'state', state }));
  }

  // Resume a saved game, if there is one.
  let resumed = null;
  const ready = (async () => {
    if (!stateFile || !fs.existsSync(stateFile)) return;
    try {
      await game.load(JSON.parse(fs.readFileSync(stateFile, 'utf8')));
      resumed = { round: game.round, phase: game.phase, players: game.players.length };
    } catch (err) {
      console.warn(`Could not resume the saved game, starting fresh: ${err.message}`);
      game.reset(false);
    }
  })();

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new Error('Upload too large.'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET') {
        if (url.pathname === '/') {
          res.writeHead(302, { location: '/screen' });
          return res.end();
        }
        if (url.pathname === '/favicon.ico') {
          res.writeHead(204);
          return res.end();
        }
        if (url.pathname.startsWith('/audio/')) {
          const clip = speech.clip(url.pathname.slice(7));
          if (!clip) return json(res, 404, { error: 'Clip not found.' });
          res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': clip.length, 'cache-control': 'no-store' });
          return res.end(clip);
        }
        if (url.pathname === '/api/rules') {
          // The rulebook is rendered from the same data the game runs on.
          const asked = url.searchParams.get('lang');
          const lang = LANGUAGES.includes(asked) ? asked : game.language;
          return json(res, 200, {
            language: lang,
            limits: LIMITS,
            maxQuestions: game.config.maxQuestions,
            headlines: game.config.headlines === false ? [] : HEADLINES.map((h) => headlineFor(h.key, lang)),
            rounds: ROUNDS.map((r) => roundFor(r, lang)).map(({ key, title, ask, full, conditional }) => ({ key, title, ask, full, conditional })),
            objectives: Object.keys(AI_OBJECTIVES).map((key) => objectiveFor(key, lang)),
            roles: ALL_ROLES.map((r) => roleFor(r.key, lang)),
          });
        }
        if (url.pathname === '/api/feedback') {
          // With the moderator key: everything received so far. Without: what the form needs to know.
          if (url.searchParams.has('key')) {
            if (url.searchParams.get('key') !== modKey) return json(res, 403, { error: 'Wrong key.' });
            return json(res, 200, { language: game.language, entries: feedback });
          }
          return json(res, 200, { language: game.language, voice: !!speech.sttEnabled });
        }
        let file = url.pathname;
        if (['/screen', '/mod', '/play', '/rules', '/dev', '/cards', '/cheatsheet', '/feedback'].includes(file)) file += '.html';
        const full = path.normalize(path.join(PUBLIC, file));
        if (!full.startsWith(PUBLIC + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
          return json(res, 404, { error: 'Not found.' });
        }
        res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream', 'cache-control': 'no-store' });
        return fs.createReadStream(full).pipe(res);
      }

      if (req.method === 'POST' && url.pathname === '/api/join') {
        const body = JSON.parse((await readBody(req, 10_000)).toString('utf8') || '{}');
        const player = game.addPlayer(body.name);
        return json(res, 200, { token: player.token });
      }

      if (req.method === 'POST' && url.pathname === '/api/ask-audio') {
        const player = game.playerByToken(url.searchParams.get('token'));
        if (!player) return json(res, 403, { error: game.e('Unknown player.') });
        if (game.phase !== 'debate') return json(res, 400, { error: game.e('Questions are only possible during the debate.') });
        if (!speech.sttEnabled) return json(res, 400, { error: game.e('Voice questions need an ElevenLabs key. Please type your question.') });
        const audio = await readBody(req, 6_000_000);
        if (audio.length < 1500) return json(res, 400, { error: game.e('That was too short. Hold the button while you speak.') });
        const text = await speech.stt(audio, req.headers['content-type'] || 'audio/webm');
        if (!text) return json(res, 400, { error: game.e('I could not hear anything. Try again or type.') });
        game.ask(player, text);
        return json(res, 200, { text });
      }

      if (req.method === 'POST' && url.pathname === '/api/feedback') {
        const body = JSON.parse((await readBody(req, 20_000)).toString('utf8') || '{}');
        const rating = Math.round(Number(body.rating));
        const entry = {
          time: new Date().toISOString(),
          gameId: game.gameId,
          language: game.language,
          rating: rating >= 1 && rating <= 5 ? rating : null,
          text: String(body.text || '').trim().slice(0, 4000),
          name: String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        };
        if (!entry.rating && !entry.text) throw new Error(game.e('Please give a rating or write something.'));
        feedback.push(entry);
        if (feedbackFile) {
          fs.mkdirSync(path.dirname(feedbackFile), { recursive: true });
          fs.appendFileSync(feedbackFile, `${JSON.stringify(entry)}\n`);
        }
        return json(res, 200, { ok: true });
      }

      // Spoken feedback: transcribed and sent back, so the person can read it before sending.
      if (req.method === 'POST' && url.pathname === '/api/feedback-audio') {
        if (!speech.sttEnabled) return json(res, 400, { error: game.e('Voice input needs an ElevenLabs key. Please type.') });
        const audio = await readBody(req, 6_000_000);
        if (audio.length < 1500) return json(res, 400, { error: game.e('That was too short. Try again or type.') });
        const text = await speech.stt(audio, req.headers['content-type'] || 'audio/webm');
        if (!text) return json(res, 400, { error: game.e('I could not hear anything. Try again or type.') });
        return json(res, 200, { text });
      }

      json(res, 404, { error: 'Not found.' });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
  });

  const modActions = {
    start: () => game.start(),
    startPitch: () => game.startPitch(),
    openDebate: () => game.openDebate(),
    setDebateMinutes: (m) => game.setDebateMinutes(m.minutes),
    adjustTimer: (m) => game.adjustTimer(Number(m.seconds)),
    closeDebate: () => game.closeDebate(),
    phoneCheck: () => game.startPhoneCheck(),
    vote: (m) => game.vote(m.result, m.counts ? { counts: m.counts } : null), // entered by hand
    closeVote: () => game.closeVote(), // counted from the phones
    councilTrack: (m) => game.setCouncilTrack(m.track),
    move: (m) => game.move(m.from, m.to),
    skipMove: () => game.skipMove(),
    nextRound: () => game.nextRound(),
    reveal: () => game.reveal(),
    reset: () => { try { archive(); } catch {} game.reset(true); }, // record the last steps before they are cleared
    undo: () => game.undo(),
    retryAi: () => game.retryAi(),
    setTracks: (m) => game.setTracks(m.values),
    kick: (m) => game.removePlayer(m.id),
    dropQuestion: (m) => game.dropQuestion(Number(m.index)),
    toggleRules: () => game.toggleRules(),
    rulesTab: (m) => game.setRulesTab(m.tab),
    toggleJoin: () => game.toggleJoin(),
    toggleFeedback: () => game.toggleFeedback(),
    setLanguage: (m) => game.setLanguage(m.language),
    testVoice: () => game.testVoice(),
    clearError: () => { game.error = null; game.changed(); },
  };

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const role = url.searchParams.get('role');
    const s = { ws, role, token: null };
    if (role === 'mod') {
      if (url.searchParams.get('key') !== modKey) {
        ws.send(JSON.stringify({ type: 'denied' }));
        return ws.close();
      }
    } else if (role === 'player') {
      s.token = url.searchParams.get('token');
      const player = playerOf(s);
      if (!player) {
        ws.send(JSON.stringify({ type: 'kicked' }));
        return ws.close();
      }
      game.setConnected(player, true);
    } else if (role !== 'screen') {
      return ws.close();
    }
    sockets.add(s);
    sendState(s);

    ws.on('message', async (raw) => {
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      try {
        if (s.role === 'mod' && m.type === 'mod' && m.action === 'newKey') {
          if (env.MOD_KEY) throw new Error(game.e('The moderator key is set in .env (MOD_KEY) and cannot be changed here.'));
          modKey = newKey();
          writeKey(modKey);
          ws.send(JSON.stringify({ type: 'newKey', key: modKey }));
          // Any other moderator window still on the old key is signed out.
          for (const o of [...sockets]) {
            if (o.role === 'mod' && o !== s) {
              sockets.delete(o);
              o.ws.send(JSON.stringify({ type: 'denied' }));
              o.ws.close();
            }
          }
          console.log(`  New moderator key. Moderator link: /mod?key=${modKey}`);
        } else if (s.role === 'screen' && m.type === 'sound') {
          // The screen where sound was turned on most recently becomes the speaker.
          s.sound = true;
          speaker = s;
          broadcast();
        } else if (s.role === 'mod' && m.type === 'mod') {
          const action = modActions[m.action];
          if (!action) throw new Error(game.e('Unknown action.'));
          await action(m);
        } else if (s.role === 'player' && playerOf(s) && m.type === 'ask') {
          game.ask(playerOf(s), m.text);
        } else if (s.role === 'player' && playerOf(s) && m.type === 'vote') {
          game.castVote(playerOf(s), m.choice);
        } else if (s.role === 'player' && playerOf(s) && m.type === 'guess') {
          game.guess(playerOf(s), m.objective);
        }
      } catch (err) {
        if (err.stale) return; // the step was cancelled by an undo, retry or reset
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => {
      sockets.delete(s);
      if (speaker === s) {
        speaker = [...sockets].filter((o) => o.role === 'screen' && o.sound).pop() || null;
        broadcast();
      }
      const player = playerOf(s);
      if (player && ![...sockets].some((o) => o.token === s.token)) game.setConnected(player, false);
    });
  });

  return { server, game, get modKey() { return modKey; }, ai, speech, ready, save, resumed: () => resumed };
}

// Start when run directly (node server.js).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  const stateFile = path.join(ROOT, 'data', 'game-state.json');
  if (process.argv.includes('--fresh') && fs.existsSync(stateFile)) fs.rmSync(stateFile);
  const app = createApp(process.env, { stateFile, keyFile: path.join(ROOT, 'data', 'moderator-key.txt'), gamesDir: path.join(ROOT, 'data', 'games'), feedbackFile: path.join(ROOT, 'data', 'feedback.jsonl') });
  await app.ready;
  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, () => {
    console.log('\nThe Alignment Problem is running.\n');
    const r = app.resumed();
    if (r && r.phase !== 'lobby') console.log(`  Resumed the saved game: round ${r.round}, ${r.players} players. (Start with "npm run fresh" to discard it.)\n`);
    console.log(`  Table screen:  http://localhost:${port}/screen`);
    console.log(`  Moderator:     http://localhost:${port}/mod?key=${app.modKey}`);
    console.log(`  Players:       http://localhost:${port}/play`);
    console.log(`  Rulebook:      http://localhost:${port}/rules`);
    console.log(`  Feedback:      http://localhost:${port}/feedback   (read it at /feedback?key=${app.modKey})`);
    console.log(`  Solo test:     http://localhost:${port}/dev?key=${app.modKey}   (all views and 4 players in one tab)\n`);
    console.log(`  AI:    ${app.ai.mode}`);
    console.log(`  Voice: ${app.speech.ttsEnabled ? 'ElevenLabs' : 'browser voice, typed questions only (no ElevenLabs key)'}\n`);
    console.log('  Phones need HTTPS for the microphone. Run a tunnel, for example:');
    console.log(`    cloudflared tunnel --url http://localhost:${port}`);
    console.log('  then open the https address it prints (add /screen, /mod?key=..., /play).\n');
  });
}
