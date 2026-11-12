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

export function createApp(env = process.env) {
  const modKey = env.MOD_KEY || crypto.randomBytes(3).toString('hex');
  const sockets = new Set(); // { ws, role, player }

  const ai = createAi({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || undefined, fastModel: env.ANTHROPIC_FAST_MODEL || undefined });
  const speech = createSpeech({
    apiKey: env.ELEVENLABS_API_KEY,
    voiceId: env.ELEVENLABS_VOICE_ID || undefined,
    ttsModel: env.ELEVENLABS_TTS_MODEL || undefined,
    sttModel: env.ELEVENLABS_STT_MODEL || undefined,
  });

  let pending = false;
  const broadcast = () => {
    if (pending) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      for (const s of sockets) sendState(s);
    });
  };

  const game = new Game({
    ai,
    speech,
    config: {
      language: env.GAME_LANGUAGE === 'de' ? 'de' : 'en',
      maxQuestions: Number(env.MAX_QUESTIONS) > 0 ? Number(env.MAX_QUESTIONS) : 5,
      forceObjective: env.FORCE_OBJECTIVE || null,
    },
    onChange: broadcast,
    onSpeak: (speechEvent) => {
      const msg = JSON.stringify({ type: 'speak', ...speechEvent });
      for (const s of sockets) if (s.role === 'screen' && s.ws.readyState === 1) s.ws.send(msg);
    },
  });

  function sendState(s) {
    if (s.ws.readyState !== 1) return;
    let state;
    if (s.role === 'mod') state = game.modState();
    else if (s.role === 'player' && s.player && game.players.includes(s.player)) state = game.playerState(s.player);
    else if (s.role === 'player') return s.ws.send(JSON.stringify({ type: 'kicked' }));
    else state = game.publicState();
    s.ws.send(JSON.stringify({ type: 'state', state }));
  }

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
        let file = url.pathname;
        if (['/screen', '/mod', '/play'].includes(file)) file += '.html';
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
        if (!player) return json(res, 403, { error: 'Unknown player.' });
        if (game.phase !== 'debate') return json(res, 400, { error: 'Questions are only possible during the debate.' });
        const audio = await readBody(req, 6_000_000);
        if (audio.length < 1500) return json(res, 400, { error: 'That was too short. Hold the button while you speak.' });
        const text = await speech.stt(audio, req.headers['content-type'] || 'audio/webm');
        if (!text) return json(res, 400, { error: 'I could not hear anything. Try again or type.' });
        game.ask(player, text);
        return json(res, 200, { text });
      }

      json(res, 404, { error: 'Not found.' });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
  });

  const modActions = {
    start: () => game.start(),
    openDebate: () => game.openDebate(),
    closeDebate: () => game.closeDebate(),
    toVote: () => game.toVote(),
    vote: (m) => game.vote(m.result),
    councilTrack: (m) => game.setCouncilTrack(m.track),
    move: (m) => game.move(m.from, m.to),
    skipMove: () => game.skipMove(),
    nextRound: () => game.nextRound(),
    reveal: () => game.reveal(),
    reset: () => game.reset(true),
    kick: (m) => game.removePlayer(m.id),
    dropQuestion: (m) => game.dropQuestion(Number(m.index)),
    clearError: () => { game.error = null; game.changed(); },
  };

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const role = url.searchParams.get('role');
    const s = { ws, role, player: null };
    if (role === 'mod') {
      if (url.searchParams.get('key') !== modKey) {
        ws.send(JSON.stringify({ type: 'denied' }));
        return ws.close();
      }
    } else if (role === 'player') {
      s.player = game.playerByToken(url.searchParams.get('token'));
      if (!s.player) {
        ws.send(JSON.stringify({ type: 'kicked' }));
        return ws.close();
      }
      game.setConnected(s.player, true);
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
        if (s.role === 'mod' && m.type === 'mod') {
          const action = modActions[m.action];
          if (!action) throw new Error('Unknown action.');
          await action(m);
        } else if (s.role === 'player' && m.type === 'ask') {
          game.ask(s.player, m.text);
        } else if (s.role === 'player' && m.type === 'guess') {
          game.guess(s.player, m.objective);
        }
      } catch (err) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => {
      sockets.delete(s);
      if (s.player && ![...sockets].some((o) => o.player === s.player)) game.setConnected(s.player, false);
    });
  });

  return { server, game, modKey, ai, speech };
}

// Start when run directly (node server.js).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, () => {
    console.log('\nThe Alignment Problem is running.\n');
    console.log(`  Table screen:  http://localhost:${port}/screen`);
    console.log(`  Moderator:     http://localhost:${port}/mod?key=${app.modKey}`);
    console.log(`  Players:       http://localhost:${port}/play\n`);
    console.log(`  AI:    ${app.ai.mode}`);
    console.log(`  Voice: ${app.speech.ttsEnabled ? 'ElevenLabs' : 'browser voice, typed questions only (no ElevenLabs key)'}\n`);
    console.log('  Phones need HTTPS for the microphone. Run a tunnel, for example:');
    console.log(`    cloudflared tunnel --url http://localhost:${port}`);
    console.log('  then open the https address it prints (add /screen, /mod?key=..., /play).\n');
  });
}
