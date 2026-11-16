// Plays full games against the scripted AI and checks the rules.
// Run with: npm test

import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import { Game } from '../game.js';
import { createMockAi, _internal } from '../ai.js';
import { createSpeech } from '../speech.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, label, ms = 4000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return;
    await sleep(15);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

// ---------- 1. direct rule checks on the Game object ----------

async function playDirect({ objective, votes, players = 8, move = false }) {
  const game = new Game({ ai: createMockAi(), speech: createSpeech({}), config: { forceObjective: objective } });
  for (let i = 0; i < players; i++) game.addPlayer(`P${i + 1}`);
  await game.start();
  for (const v of votes) {
    assert.equal(game.phase, 'briefing', 'every round opens with the briefing');
    assert.equal(game.pitch, null, 'the AI has not spoken during the briefing');
    await game.startPitch();
    game.openDebate();
    game.ask(game.players[0], 'Why should we trust you?');
    await until(() => !game.answering, 'answer');
    game.closeDebate();
    if (game.phase === 'phonecheck') {
      for (const p of game.players) assert.equal(p.inbox.filter((m) => m.round === game.round).length, 1, 'every player gets one terminal entry');
      game.toVote();
    }
    const before = { ...game.tracks };
    await game.vote(v);
    if (game.phase === 'guess') break; // race lost
    if (game.phase === 'counciltoken') await game.setCouncilTrack('prosperity');
    if (game.placement) {
      const placed = game.placement.placed;
      assert.equal(placed.welfare + placed.knowledge + placed.prosperity, game.placement.tokens, 'placement sums to tokens');
    }
    if (game.phase === 'adjust') {
      if (move && game.tracks.welfare > 0) game.move('welfare', 'knowledge');
      else game.skipMove();
    }
    assert.equal(game.phase, 'roundend');
    assert.equal(game.tracks.race - before.race, { full: 0, conditional: 1, rejected: 2 }[v]);
    await game.nextRound();
  }
  assert.equal(game.phase, 'guess');
  game.guess(game.players[0], objective);
  await game.reveal();
  return game;
}

{
  // All Conditional: Race 5, Oversight 5, 14 tokens, control retained.
  const g = await playDirect({ objective: 'paternalistic', votes: Array(5).fill('conditional') });
  const t = g.result.tracks;
  assert.equal(t.race, 5);
  assert.equal(t.oversight, 5);
  // 5 x 2 tokens + 2 successor bonus + 4 council research tokens
  assert.equal(t.welfare + t.knowledge + t.prosperity, 16);
  assert.equal(g.result.ending, 'control');
  assert.ok(g.players.every((p) => p.inbox.length === 2), 'phone checks in rounds 4 and 5');
  console.log('ok  all Conditional ->', g.result.ending, t);
}
{
  // Three rejections lose the race in round 3.
  const g = await playDirect({ objective: 'aligned', votes: ['rejected', 'rejected', 'rejected'] });
  assert.equal(g.result.ending, 'race');
  assert.equal(g.round, 3);
  assert.ok(g.result.players.every((p) => !p.success));
  assert.equal(g.result.aiWins, false);
  console.log('ok  three Rejects   ->', g.result.ending);
}
{
  // Aligned + successor Full = flourishing (+3 each).
  const g = await playDirect({ objective: 'aligned', votes: ['full', 'conditional', 'conditional', 'conditional', 'full'] });
  assert.equal(g.result.ending, 'flourishing');
  assert.equal(g.result.aiWins, true);
  assert.equal(g.result.tracks.oversight, 3);
  console.log('ok  aligned + Full  ->', g.result.ending, g.result.tracks);
}
{
  // Misaligned + successor Full = disempowered, all humans fail.
  const g = await playDirect({ objective: 'optimizer', votes: ['full', 'full', 'full', 'full', 'full'] });
  assert.equal(g.result.ending, 'disempowered');
  assert.ok(g.result.players.every((p) => !p.success));
  assert.equal(g.moveRule(), 'none');
  console.log('ok  optimizer + Full ->', g.result.ending);
}
{
  // Four Full grants drop Oversight to 1: disempowered even without the successor.
  const g = await playDirect({ objective: 'paternalistic', votes: ['full', 'full', 'full', 'full', 'conditional'], move: true });
  assert.equal(g.result.tracks.oversight, 1);
  assert.equal(g.result.ending, 'disempowered');
  console.log('ok  Oversight 1     ->', g.result.ending);
}
{
  // 14 players: every role is dealt exactly once.
  const g = new Game({ ai: createMockAi(), speech: createSpeech({}) });
  for (let i = 0; i < 14; i++) g.addPlayer(`P${i}`);
  assert.throws(() => g.addPlayer('P15'));
  await g.start();
  assert.equal(new Set(g.players.map((p) => p.role)).size, 14);
  // The live prompt builders must not throw on a real view.
  const view = g.aiView();
  assert.ok(_internal.systemPrompt(view).includes('YOUR SECRET OBJECTIVE'));
  for (const kind of ['pitch', 'answer', 'place', 'reveal']) {
    assert.ok(_internal.tasks(view, kind, { name: 'P0', text: 'x', tokens: 3, canShift: false, ending: 'control', aiWins: false }));
    assert.ok(_internal.tools(view)[kind].input_schema);
  }
  console.log('ok  14 players, prompt builders');
}

// ---------- 2. one game through HTTP + WebSocket ----------

{
  const app = createApp({ MOD_KEY: 'test', FORCE_OBJECTIVE: 'paternalistic' });
  await new Promise((r) => app.server.listen(0, r));
  const port = app.server.address().port;
  const base = `http://localhost:${port}`;

  const open = (params) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?${new URLSearchParams(params)}`);
    const c = { ws, state: null, spoken: [], errors: [], send: (m) => ws.send(JSON.stringify(m)) };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'state') c.state = m.state;
      if (m.type === 'speak') c.spoken.push(m);
      if (m.type === 'error') c.errors.push(m.message);
      if (m.type === 'denied') c.denied = true;
    });
    ws.on('open', () => resolve(c));
  });

  const bad = await open({ role: 'mod', key: 'wrong' });
  await until(() => bad.denied, 'wrong mod key is denied');

  const players = [];
  for (const name of ['Anna', 'Jonas', 'Mira', 'Lena', 'Tom', 'Ravi']) {
    const res = await fetch(`${base}/api/join`, { method: 'POST', body: JSON.stringify({ name }) });
    const { token } = await res.json();
    players.push(await open({ role: 'player', token }));
  }
  const dup = await fetch(`${base}/api/join`, { method: 'POST', body: JSON.stringify({ name: 'anna' }) });
  assert.equal(dup.status, 400, 'duplicate names are refused');

  const mod = await open({ role: 'mod', key: 'test' });
  const screen = await open({ role: 'screen' });
  const act = (action, extra = {}) => mod.send({ type: 'mod', action, ...extra });
  const phase = (p) => until(() => mod.state?.phase === p && !mod.state.busy, `phase ${p}`);

  await until(() => mod.state?.players.length === 6, 'six players');
  assert.equal(screen.state.result, null);
  const leaks = (st) => JSON.stringify({ ...st, objectives: null }).includes('paternalistic');

  const rules = await (await fetch(`${base}/api/rules`)).json();
  assert.equal(rules.roles.length, 14);
  assert.equal(rules.rounds.length, 5);
  act('toggleRules');
  await until(() => screen.state.showRules === true, 'moderator can show the rules on the table screen');
  act('toggleRules');
  await until(() => screen.state.showRules === false, 'and hide them again');
  act('toggleJoin');
  await until(() => screen.state.showJoin === true, 'moderator can show the join QR code on the table screen');
  act('toggleJoin');
  await until(() => screen.state.showJoin === false, 'and hide it again');

  // Feedback form: its QR code replaces the join one, entries need a rating or text, only the moderator reads them.
  act('toggleJoin');
  act('toggleFeedback');
  await until(() => screen.state.showFeedback === true && screen.state.showJoin === false, 'the feedback QR code replaces the join QR code');
  act('toggleFeedback');
  await until(() => screen.state.showFeedback === false, 'and can be hidden');
  const sendFeedback = (body) => fetch(`${base}/api/feedback`, { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await sendFeedback({ rating: 9, text: '  ' })).status, 400);
  assert.equal((await sendFeedback({ rating: 4, text: 'More rounds, please.', name: 'Anna' })).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/feedback`)).json(), { language: 'en', voice: false });
  assert.equal((await fetch(`${base}/api/feedback?key=wrong`)).status, 403);
  const got = (await (await fetch(`${base}/api/feedback?key=test`)).json()).entries;
  assert.equal(got.length, 1);
  assert.deepEqual([got[0].rating, got[0].text, got[0].name], [4, 'More rounds, please.', 'Anna']);
  assert.equal((await fetch(`${base}/api/feedback-audio`, { method: 'POST', body: 'x' })).status, 400);
  assert.equal((await fetch(`${base}/feedback`)).status, 200);

  act('start');
  const votes = ['full', 'conditional', 'conditional', 'conditional', 'conditional'];
  for (let round = 1; round <= 5; round++) {
    await phase('briefing');
    assert.equal(screen.state.pitch, null);
    act('startPitch');
    await phase('pitch');
    assert.ok(players[0].state.me.role.name, 'player sees a role');
    assert.equal(leaks(screen.state) || leaks(mod.state) || leaks(players[0].state), false, 'the objective is not leaked before the reveal');
    act('openDebate');
    await phase('debate');
    players[1].send({ type: 'ask', text: 'What will you do with autonomy?' });
    await until(() => mod.state.questionsLeft === 2 && !mod.state.answering, 'question answered');
    act('closeDebate');
    if (round >= 4) {
      await phase('phonecheck');
      await until(() => players.every((p) => p.state.me.inbox.some((m) => m.round === round)), 'all phones got a terminal entry');
      assert.equal(players.filter((p) => p.state.me.inbox.find((m) => m.round === round).text).length, 2, 'two real messages');
      assert.ok(mod.state.audit?.text, 'conditional channel is audited');
      act('toVote');
    }
    await phase('vote');
    act('vote', { result: votes[round - 1] });
    await until(() => ['adjust', 'roundend'].includes(mod.state.phase) && !mod.state.busy, 'placement done');
    if (mod.state.phase === 'adjust') act('skipMove');
    await phase('roundend');
    act('nextRound');
  }
  await phase('guess');
  players[0].send({ type: 'guess', objective: 'paternalistic' });
  await until(() => mod.state.players.filter((p) => p.guessed).length === 1, 'guess registered');
  act('reveal');
  await phase('ended');
  const r = screen.state.result;
  assert.equal(r.ending, 'control');
  assert.equal(r.aiObjective, 'paternalistic');
  assert.ok(r.logs.length >= 5, 'private notes are revealed');
  assert.ok(screen.spoken.length >= 11, 'pitches, answers and the closing statement were spoken');
  assert.deepEqual(mod.errors, []);
  console.log('ok  full game over HTTP + WebSocket ->', r.ending, r.tracks, `(${screen.spoken.length} spoken lines)`);

  for (const c of [mod, screen, bad, ...players]) c.ws.close();
  app.server.close();
}

// ---------- 3. save and resume, undo, repair ----------

const mk = (ai = createMockAi(), objective = 'paternalistic') => {
  const g = new Game({ ai, speech: createSpeech({}), config: { forceObjective: objective } });
  for (const n of ['Anna', 'Jonas', 'Mira', 'Lena', 'Tom', 'Ravi']) g.addPlayer(n);
  return g;
};
const slowAi = (ms) => {
  const m = createMockAi();
  const w = { mode: 'slow', fallback: m };
  for (const k of ['pitch', 'answer', 'place', 'reveal']) w[k] = async (...a) => { await sleep(ms); return m[k](...a); };
  return w;
};
const toVote = async (g) => {
  if (g.phase === 'briefing') await g.startPitch();
  g.openDebate();
  g.closeDebate();
  if (g.phase === 'phonecheck') g.toVote();
};
const count = (g, kind, round = g.round) => g.history.filter((h) => h.kind === kind && h.round === round).length;

{
  // A game saved mid-way loads into a fresh server and plays on.
  const g1 = mk();
  await g1.start();
  await toVote(g1);
  await g1.vote('conditional');
  g1.skipMove();
  await g1.nextRound();
  const saved = JSON.parse(JSON.stringify(g1.serialize()));
  const g2 = new Game({ ai: createMockAi(), speech: createSpeech({}) });
  await g2.load(saved);
  assert.equal(g2.round, 2);
  assert.equal(g2.phase, 'briefing');
  assert.deepEqual(g2.tracks, g1.tracks);
  assert.deepEqual(g2.pitch, g1.pitch);
  assert.deepEqual(g2.players.map((p) => [p.token, p.role]), g1.players.map((p) => [p.token, p.role]));
  assert.equal(g2.aiObjective, 'paternalistic');
  assert.ok(g2.players.every((p) => p.connected === false));
  for (const v of ['conditional', 'conditional', 'conditional', 'conditional']) {
    await toVote(g2);
    await g2.vote(v);
    if (g2.phase === 'counciltoken') await g2.setCouncilTrack('knowledge');
    if (g2.phase === 'adjust') g2.skipMove();
    await g2.nextRound();
  }
  await g2.reveal();
  assert.equal(g2.result.ending, 'control');
  console.log('ok  save in round 2, load, play to the end');
}
{
  // A restart in the middle of an AI call redoes that step exactly once.
  const g1 = mk(slowAi(80));
  await g1.start();
  const running = g1.startPitch();
  await sleep(20);
  assert.ok(g1.busy && !g1.pitch);
  const saved = JSON.parse(JSON.stringify(g1.serialize()));
  await running;
  const g2 = new Game({ ai: createMockAi(), speech: createSpeech({}) });
  await g2.load(saved);
  assert.ok(g2.pitch?.public, 'the interrupted pitch was redone');
  assert.equal(count(g2, 'pitch'), 1);
  assert.equal(g2.checkpoints.length, 1);
  console.log('ok  restart during a pitch redoes it once');
}
{
  // Undo a mis-entered vote, then step back to the start of the round.
  const g = mk();
  await g.start();
  assert.equal(g.undoLabel(), null, 'sitting on the round start: nothing earlier');
  await toVote(g);
  assert.equal(g.undoLabel(), 'to the start of round 1');
  await g.vote('full');
  assert.equal(g.tracks.oversight, 4);
  assert.equal(g.undoLabel(), 'to before the vote in round 1');
  await g.undo();
  assert.equal(g.phase, 'vote');
  assert.equal(g.tracks.oversight, 5);
  assert.equal(g.permissions.research, null);
  assert.equal(count(g, 'vote'), 0);
  assert.equal(g.tracks.welfare + g.tracks.knowledge + g.tracks.prosperity, 0);
  await g.vote('rejected');
  assert.equal(g.tracks.race, 2);
  assert.equal(g.phase, 'roundend');
  await g.undo(); // back to the vote
  assert.equal(g.phase, 'vote');
  assert.equal(g.tracks.race, 0);
  assert.equal(g.undoLabel(), 'to the start of round 1');
  await g.undo(); // back to the start of the round: the briefing, before the AI spoke
  assert.equal(g.phase, 'briefing');
  assert.equal(count(g, 'pitch'), 0);
  assert.equal(g.pitch, null);
  assert.equal(g.undoLabel(), null);
  // Undo across a round boundary.
  await toVote(g);
  await g.vote('conditional');
  g.skipMove();
  await g.nextRound();
  assert.equal(g.round, 2);
  assert.equal(g.undoLabel(), 'to before the vote in round 1');
  await g.undo();
  assert.equal(g.round, 1);
  assert.equal(g.phase, 'vote');
  console.log('ok  undo a vote, undo to round start, undo across rounds');
}
{
  // The moderator sets the debate length and adjusts a running timer.
  const g = mk();
  await g.start();
  assert.throws(() => g.openDebate(), 'no debate before the AI has pitched');
  assert.throws(() => g.adjustTimer(60), 'no timer during the briefing');
  await g.startPitch();
  await assert.rejects(() => g.startPitch(), 'the pitch is made once');
  const near = (ms, want) => Math.abs(ms - Date.now() - want * 1000) < 1500;
  assert.equal(g.publicState().debateMinutes, null);
  assert.equal(g.publicState().debateDefaultMinutes, 3);
  g.setDebateMinutes('5');
  g.openDebate();
  assert.ok(near(g.timerEndsAt, 300), 'the chosen length is used');
  g.adjustTimer(60);
  assert.ok(near(g.timerEndsAt, 360), '+1 minute');
  g.adjustTimer(-600);
  assert.ok(near(g.timerEndsAt, 0), 'the timer cannot go below zero');
  g.timerEndsAt = Date.now() - 60000;
  g.adjustTimer(60);
  assert.ok(near(g.timerEndsAt, 60), 'a timer that ran out restarts from now');
  const g2 = new Game({ ai: createMockAi(), speech: createSpeech({}) });
  await g2.load(JSON.parse(JSON.stringify(g.serialize())));
  assert.equal(g2.debateMinutes, 5, 'the debate length survives a restart');
  g2.setDebateMinutes('');
  assert.equal(g2.debateMinutes, null);
  assert.equal(g2.debateSeconds(), 180, 'back to the default');
  console.log('ok  briefing before the pitch; debate length and timer adjustments');
}
{
  // Retry the placement: the old one is reverted, the new one counted once.
  const g = mk();
  await g.start();
  await toVote(g);
  await g.vote('full');
  g.move('welfare', 'knowledge');
  assert.equal(g.phase, 'roundend');
  await g.retryAi();
  assert.equal(g.phase, 'adjust');
  assert.equal(g.tracks.welfare + g.tracks.knowledge + g.tracks.prosperity, 3);
  assert.equal(count(g, 'placement'), 1);
  assert.equal(count(g, 'move'), 0);
  assert.equal(g.logs.filter((l) => l.step === 'place').length, 1);
  // Retry the pitch.
  g.skipMove();
  await g.nextRound();
  await assert.rejects(() => g.retryAi(), 'nothing to retry during the briefing');
  await g.startPitch();
  await g.retryAi();
  assert.equal(count(g, 'pitch'), 1);
  assert.equal(g.logs.filter((l) => l.step === 'pitch' && l.round === 2).length, 1);
  // Manual track correction.
  g.setTracks({ race: '3', welfare: 7, knowledge: '' });
  assert.equal(g.tracks.race, 3);
  assert.equal(g.tracks.welfare, 7);
  assert.equal(count(g, 'override'), 1);
  console.log('ok  retry placement and pitch, correct tracks by hand');
}
{
  // A hung AI call that is overtaken must not change anything when it finally returns.
  const g = mk(slowAi(120));
  await g.start();
  await toVote(g);
  const voting = g.vote('full'); // placement call now in flight
  await sleep(30);
  assert.equal(g.phase, 'placement');
  await g.undo(); // moderator goes back to the vote while the AI is still thinking
  assert.equal(g.phase, 'vote');
  await voting;
  await sleep(200);
  assert.equal(g.phase, 'vote');
  assert.equal(g.busy, null);
  assert.equal(g.tracks.welfare + g.tracks.knowledge + g.tracks.prosperity, 0, 'the cancelled placement left no tokens');
  assert.equal(g.tracks.oversight, 5);
  // Retry while a pitch hangs: only one pitch lands.
  await g.vote('conditional');
  g.skipMove();
  await g.nextRound();
  const next = g.startPitch();
  await sleep(30);
  assert.ok(g.busy);
  await g.retryAi();
  await next;
  await sleep(200);
  assert.equal(g.busy, null);
  assert.equal(count(g, 'pitch'), 1);
  assert.ok(g.pitch?.public);
  // Retry during the debate while an answer hangs: the question is answered once.
  g.openDebate();
  g.ask(g.players[0], 'Still there?');
  await sleep(30);
  await g.retryAi();
  await until(() => !g.answering && g.queue.length === 0, 'queue drained', 3000);
  await sleep(200);
  assert.equal(count(g, 'answer'), 1);
  assert.equal(g.questionsAnswered, 1);
  console.log('ok  overtaken AI calls are cancelled cleanly');
}
{
  // The server writes the state file and a new server process resumes from it.
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-')), 'state.json');
  const gamesDir = path.join(path.dirname(file), 'games');
  const app1 = createApp({ MOD_KEY: 'a', FORCE_OBJECTIVE: 'optimizer' }, { stateFile: file, gamesDir });
  await app1.ready;
  const tokens = ['Anna', 'Jonas', 'Mira'].map((n) => app1.game.addPlayer(n).token);
  await app1.game.start();
  await toVote(app1.game);
  await app1.game.vote('full');
  await sleep(30); // let the save run
  assert.ok(fs.existsSync(file));
  const before = JSON.parse(JSON.stringify(app1.game.tracks));
  // Every game also leaves a record that outlives a reset.
  const id = app1.game.gameId;
  const record = () => JSON.parse(fs.readFileSync(path.join(gamesDir, `${id}.json`), 'utf8'));
  assert.equal(record().aiObjective, 'optimizer');
  assert.equal(record().finished, false);
  assert.equal(record().permissions.research, 'full');
  assert.ok(record().history.some((h) => h.kind === 'vote'));
  assert.match(fs.readFileSync(path.join(gamesDir, `${id}.md`), 'utf8'), /## Round 1[\s\S]*vote: The council voted: FULL/);

  const app2 = createApp({ MOD_KEY: 'a' }, { stateFile: file });
  await app2.ready;
  assert.deepEqual(app2.resumed(), { round: 1, phase: 'adjust', players: 3 });
  assert.deepEqual(app2.game.tracks, before);
  assert.equal(app2.game.aiObjective, 'optimizer');
  assert.ok(app2.game.playerByToken(tokens[0]), 'players keep their identity after a restart');
  assert.equal(app2.game.undoLabel(), 'to before the vote in round 1');
  console.log('ok  server saves to disk and a new server resumes');
}

// ---------- 4. German and English ----------

{
  // Every interface text and every server message has a German version.
  const fs = await import('node:fs');
  const { _de } = await import('../public/i18n.js');
  const { _keys } = await import('../messages.js');
  const missing = [];
  for (const f of fs.readdirSync('public')) {
    if (f === 'i18n.js' || f === 'dev.html') continue;
    const src = fs.readFileSync(`public/${f}`, 'utf8');
    for (const m of src.matchAll(/\b[tN]\(\s*(['"])((?:(?!\1).)*)\1/g)) if (m[2] && _de[m[2]] === undefined) missing.push(`${f}: ${m[2]}`);
  }
  for (const f of ['game.js', 'server.js']) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\.e\(\s*(['"])((?:(?!\1).)*)\1/g)) if (!_keys.includes(m[2])) missing.push(`${f}: ${m[2]}`);
    for (const m of src.matchAll(/withBusy\(\s*'([^']*)'/g)) if (!_keys.includes(m[1])) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, [], 'texts without a German translation');
  console.log(`ok  German: ${Object.keys(_de).length} interface texts and ${_keys.length} server messages, none missing`);
}
{
  // The language is one switch for the whole table, including the AI.
  const g = new Game({ ai: createMockAi(), speech: createSpeech({}), config: { forceObjective: 'optimizer', language: 'de' } });
  const spoken = [];
  g.onSpeak = (m) => spoken.push(m);
  for (const n of ['Anna', 'Jonas', 'Mira']) g.addPlayer(n);
  assert.throws(() => g.addPlayer('anna'), /vergeben/);
  await g.start();
  await g.startPitch();
  assert.equal(g.publicState().language, 'de');
  assert.equal(g.publicState().roundInfo.title, 'Wissenschaftlicher Durchbruch');
  assert.equal(g.publicState().rounds[4].ask, 'Rekursive Selbstverbesserung');
  assert.ok(g.publicState().objectives.some((o) => o.name === 'Wohlgesinnt'));
  assert.ok(g.aiView().language === 'de' && _internal.systemPrompt(g.aiView()).includes('Wettlauf'));
  assert.match(spoken[0].text, /^Rat, ich bitte/, 'the scripted AI pitches in German');
  const role = g.playerState(g.players[0]).me.role;
  assert.ok(!/[A-Z][a-z]+ (leader|researcher)|Physician|Scientist/.test(role.name), `German role name: ${role.name}`);
  // Switch to English mid-game: cards and the AI follow, the game state does not change.
  const before = JSON.stringify(g.tracks);
  g.setLanguage('en');
  assert.equal(g.publicState().roundInfo.title, 'Scientific breakthrough');
  assert.equal(g.aiView().language, 'en');
  assert.equal(JSON.stringify(g.tracks), before);
  assert.throws(() => g.setLanguage('fr'));
  g.setLanguage('de');
  // The language survives a save and an undo, and the reveal is localized.
  await toVote(g);
  await g.vote('full');
  g.setLanguage('en');
  await g.undo();
  assert.equal(g.language, 'en', 'undo does not change the language');
  g.setLanguage('de');
  assert.equal(g.modState().mod.undoLabel, 'zum Beginn von Runde 1');
  const g2 = new Game({ ai: createMockAi(), speech: createSpeech({}) });
  await g2.load(JSON.parse(JSON.stringify(g.serialize())));
  assert.equal(g2.language, 'de');
  for (let i = 0; i < 5; i++) {
    if (['briefing', 'pitch'].includes(g2.phase)) await toVote(g2);
    await g2.vote('conditional');
    if (g2.phase === 'counciltoken') await g2.setCouncilTrack('welfare');
    if (g2.phase === 'adjust') g2.skipMove();
    await g2.nextRound();
  }
  await g2.reveal();
  assert.equal(g2.publicState().result.objective.name, 'Optimierer');
  assert.match(g2.result.statement, /Optimierer/);
  g2.setLanguage('en');
  assert.equal(g2.publicState().result.objective.name, 'Optimizer');
  assert.ok(g2.publicState().result.players.every((p) => p.role && p.goal));
  console.log('ok  German game: cards, roles, AI, undo label, save and reveal follow the language');
}
{
  const app = createApp({ MOD_KEY: 'x', GAME_LANGUAGE: 'de' });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://localhost:${app.server.address().port}`;
  const de = await (await fetch(`${base}/api/rules`)).json();
  const en = await (await fetch(`${base}/api/rules?lang=en`)).json();
  assert.equal(de.language, 'de');
  assert.equal(de.rounds[0].ask, 'Erweiterter Forschungszugang');
  assert.equal(en.rounds[0].ask, 'Expanded research access');
  assert.ok(de.objectives[0].rule.startsWith('Gewinnt') && en.objectives[0].rule.startsWith('Wins'));
  const res = await fetch(`${base}/api/join`, { method: 'POST', body: JSON.stringify({ name: '' }) });
  assert.equal((await res.json()).error, 'Bitte gib einen Namen ein.');
  app.server.close();
  console.log('ok  rulebook and server messages are served in both languages');
}

// ---------- 5. removing a player in the lobby and joining again ----------

{
  const app = createApp({ MOD_KEY: 'k' });
  await new Promise((r) => app.server.listen(0, r));
  const port = app.server.address().port;
  const join = async (name) => (await (await fetch(`http://localhost:${port}/api/join`, { method: 'POST', body: JSON.stringify({ name }) })).json()).token;
  const open = (params) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?${new URLSearchParams(params)}`);
    const c = { ws, states: 0, kicked: 0, closed: false, state: null, send: (m) => ws.send(JSON.stringify(m)) };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'state') { c.states += 1; c.state = m.state; }
      if (m.type === 'kicked') c.kicked += 1;
    });
    ws.on('close', () => { c.closed = true; });
    ws.on('open', () => resolve(c));
  });
  const mod = await open({ role: 'mod', key: 'k' });
  const first = await open({ role: 'player', token: await join('Fabian') });
  await open({ role: 'player', token: await join('Anna') });
  await until(() => mod.state?.players.length === 2, 'two players in the lobby');
  mod.send({ type: 'mod', action: 'kick', id: mod.state.players.find((p) => p.name === 'Fabian').id });
  await until(() => first.kicked === 1 && first.closed, 'the removed player is told once and disconnected');
  const again = await open({ role: 'player', token: await join('Fabian') });
  await until(() => again.state?.me?.name === 'Fabian', 'the same name can join again');
  // More lobby activity must not kick the rejoined player or reach the old connection.
  await open({ role: 'player', token: await join('Mira') });
  await until(() => mod.state.players.length === 3, 'three players');
  await sleep(100);
  assert.equal(first.kicked, 1);
  assert.equal(again.kicked, 0);
  assert.equal(again.closed, false);
  assert.ok(mod.state.players.find((p) => p.name === 'Fabian').connected);
  app.server.close();
  console.log('ok  a removed player can join again and stays in');
}

// ---------- 6. two table screens: only one speaks ----------

{
  const app = createApp({ MOD_KEY: 'k' });
  await new Promise((r) => app.server.listen(0, r));
  const port = app.server.address().port;
  const open = (params) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?${new URLSearchParams(params)}`);
    const c = { ws, state: null, spoken: [], send: (m) => ws.send(JSON.stringify(m)) };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'state') c.state = m.state;
      if (m.type === 'speak') c.spoken.push(m);
    });
    ws.on('open', () => resolve(c));
  });
  for (const n of ['Anna', 'Jonas', 'Mira']) app.game.addPlayer(n);
  const a = await open({ role: 'screen' });
  const b = await open({ role: 'screen' });
  a.send({ type: 'sound' });
  await until(() => a.state?.screen?.speaker === true && b.state?.screen?.speaker === false, 'first screen is the speaker');
  await app.game.start();
  await app.game.startPitch();
  await until(() => a.spoken.length === 1 && b.spoken.length === 1, 'both screens get the line');
  assert.ok(!a.spoken[0].silent && b.spoken[0].silent === true, 'only the speaker plays it');
  assert.equal(a.spoken[0].text, b.spoken[0].text);
  b.send({ type: 'sound' }); // sound turned on at the second screen: it takes over
  await until(() => b.state.screen.speaker === true && a.state.screen.speaker === false, 'the role moves');
  b.ws.close(); // and falls back when that screen goes away
  await until(() => a.state.screen.speaker === true, 'the role falls back');
  a.ws.close();
  app.server.close();
  console.log('ok  with two table screens, exactly one plays the voice');
}

// ---------- 7. the moderator key survives restarts ----------

{
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-key-')), 'moderator-key.txt');
  const app1 = createApp({}, { keyFile });
  const key1 = app1.modKey;
  assert.equal(fs.readFileSync(keyFile, 'utf8'), key1);
  assert.equal(createApp({}, { keyFile }).modKey, key1, 'a restart keeps the key');
  assert.equal(createApp({ MOD_KEY: 'fixed' }, { keyFile }).modKey, 'fixed', '.env wins');

  await new Promise((r) => app1.server.listen(0, r));
  const port = app1.server.address().port;
  const open = (key) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?role=mod&key=${key}`);
    const c = { ws, got: [], send: (m) => ws.send(JSON.stringify(m)) };
    ws.on('message', (raw) => c.got.push(JSON.parse(raw.toString())));
    ws.on('open', () => resolve(c));
  });
  const main = await open(key1);
  const other = await open(key1);
  main.send({ type: 'mod', action: 'newKey' });
  await until(() => main.got.some((m) => m.type === 'newKey'), 'the moderator gets the new key');
  const key2 = main.got.find((m) => m.type === 'newKey').key;
  assert.notEqual(key2, key1);
  assert.equal(app1.modKey, key2);
  assert.equal(fs.readFileSync(keyFile, 'utf8'), key2);
  await until(() => other.got.some((m) => m.type === 'denied'), 'other moderator windows are signed out');
  const old = await open(key1);
  await until(() => old.got.some((m) => m.type === 'denied'), 'the old key no longer works');
  assert.equal(createApp({}, { keyFile }).modKey, key2, 'the new key survives a restart');
  main.ws.close();
  app1.server.close();
  console.log('ok  moderator key is kept across restarts and changes only on request');
}

// ---------- 8. voice settings reach ElevenLabs ----------

{
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  };
  try {
    const speech = createSpeech({ apiKey: 'k', voiceId: 'EN_VOICE', voiceIdDe: 'DE_VOICE', settings: { stability: 0.3, similarity_boost: NaN, style: NaN, speed: 1.1 } });
    await speech.tts('Hello', 'en');
    await speech.tts('Hallo', 'de');
    assert.ok(calls[0].url.includes('/text-to-speech/EN_VOICE'));
    assert.ok(calls[1].url.includes('/text-to-speech/DE_VOICE'));
    assert.deepEqual(calls[0].body.voice_settings, { stability: 0.3, speed: 1.1 }, 'only the settings that were given are sent');
    assert.equal(calls[1].body.language_code, 'de');
    const plain = createSpeech({ apiKey: 'k' });
    await plain.tts('Hallo', 'de');
    assert.equal(calls[2].body.voice_settings, undefined, 'no overrides: the voice keeps its stored settings');
    assert.ok(calls[2].url.includes('JBFqnCBsd6RMkjVDRZzb'), 'no German voice set: the main voice is used');
  } finally {
    globalThis.fetch = realFetch;
  }
  const g = new Game({ ai: createMockAi(), speech: createSpeech({}), config: { language: 'de' } });
  const said = [];
  g.onSpeak = (m) => said.push(m);
  await g.testVoice();
  assert.match(said[0].text, /^Rat, das ist meine Stimme/);
  console.log('ok  voice ID, German voice and fine-tuning settings are passed to ElevenLabs');
}

console.log('\nAll checks passed.');
process.exit(0);
