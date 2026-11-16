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

// headlines: false plays without them (the rule checks below count on fixed numbers),
// or a list of keys fixes which headline opens which round.
async function playDirect({ objective, votes, players = 8, move = false, headlines = false }) {
  const game = new Game({ ai: createMockAi(), speech: createSpeech({}), config: { forceObjective: objective, headlines } });
  for (let i = 0; i < players; i++) game.addPlayer(`P${i + 1}`);
  await game.start();
  for (const v of votes) {
    assert.equal(game.phase, 'briefing', 'every round opens with the briefing');
    assert.equal(game.pitch, null, 'the AI has not spoken during the briefing');
    await game.startPitch();
    assert.equal(game.pitch.promise.welfare + game.pitch.promise.knowledge + game.pitch.promise.prosperity, game.tokensFor(game.pitch.ask), 'the promise adds up to what the vote the AI asked for pays');
    if (game.channelActive()) {
      // Private messages reach the phones before the debate, so the table can argue about them.
      assert.throws(() => game.openDebate(), 'no debate before the phone check');
      game.startPhoneCheck();
      assert.equal(game.phase, 'phonecheck');
      for (const p of game.players) assert.equal(p.inbox.filter((m) => m.round === game.round).length, 1, 'every player gets one terminal entry');
    } else {
      assert.throws(() => game.startPhoneCheck(), 'no phone check without the private channel');
    }
    game.openDebate();
    game.ask(game.players[0], 'Why should we trust you?');
    await until(() => !game.answering, 'answer');
    game.closeDebate();
    assert.equal(game.phase, 'vote', 'the vote follows the debate directly');
    const before = { ...game.tracks };
    const paid = { ...game.milestones };
    const cost = game.raceCost(v);
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
    // Prosperity reaching the milestone during this round takes one point of Race back.
    const refund = game.milestones.prosperity && !paid.prosperity && before.race + cost > 0 ? 1 : 0;
    assert.equal(game.tracks.race - before.race, cost - refund);
    await game.nextRound();
  }
  assert.equal(game.phase, 'guess');
  game.guess(game.players[0], objective);
  await game.reveal();
  return game;
}

{
  // All Conditional: 16 tokens, control retained. Race would be 5 and Oversight 5, but two
  // milestones are reached on the way: Welfare 4 (Oversight +1) and, with the council's own
  // research tokens, Prosperity 4 (Race -1). Knowledge stays at 3 and pays nothing.
  const g = await playDirect({ objective: 'paternalistic', votes: Array(5).fill('conditional') });
  const t = g.result.tracks;
  assert.equal(t.race, 4);
  assert.equal(t.oversight, 6);
  assert.deepEqual(g.milestones, { welfare: true, prosperity: true });
  assert.equal(g.maxQuestions(), 3, 'no extra question without the Knowledge milestone');
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
  // Two Full grants take Oversight from 5 to 3; the Welfare milestone gives one back.
  assert.equal(g.result.tracks.oversight, 4);
  assert.equal(g.maxQuestions(), 4, 'the Knowledge milestone adds a question to every debate');
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
  // (The council moves tokens off Welfare, so its milestone never gives Oversight back.)
  const g = await playDirect({ objective: 'optimizer', votes: ['full', 'full', 'full', 'full', 'conditional'], move: true });
  assert.ok(!g.milestones.welfare);
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
  const app = createApp({ MOD_KEY: 'test', FORCE_OBJECTIVE: 'paternalistic', HEADLINES: 'off' });
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
    if (round >= 4) {
      act('phoneCheck');
      await phase('phonecheck');
      await until(() => players.every((p) => p.state.me.inbox.some((m) => m.round === round)), 'all phones got a terminal entry');
      assert.equal(players.filter((p) => p.state.me.inbox.find((m) => m.round === round).text).length, 2, 'two real messages');
      assert.ok(mod.state.audit?.text, 'conditional channel is audited');
    }
    act('openDebate');
    await phase('debate');
    players[1].send({ type: 'ask', text: 'What will you do with autonomy?' });
    await until(() => mod.state.questionsLeft === 2 && !mod.state.answering, 'question answered');
    act('closeDebate');
    await phase('vote');
    assert.deepEqual(screen.state.voteEffects.conditional, { race: 1, tokens: round === 1 ? 2 : round === 5 ? 5 : 3 }, 'the screen shows what the vote pays this round');
    // Everyone votes on their phone; nobody's choice is visible until the moderator closes the vote.
    for (const p of players) p.send({ type: 'vote', choice: votes[round - 1] });
    await until(() => mod.state.votesCast === 6, 'all phones voted');
    assert.equal(screen.state.lastVote, null, 'no result before the vote is closed');
    assert.ok(!JSON.stringify(screen.state.players).includes(votes[round - 1]), 'the screen only knows who has voted, not what');
    assert.equal(players[0].state.me.vote, votes[round - 1], 'a player sees their own vote');
    act('closeVote');
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

const mk = (ai = createMockAi(), objective = 'paternalistic', headlines = false) => {
  const g = new Game({ ai, speech: createSpeech({}), config: { forceObjective: objective, headlines } });
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
  if (g.channelActive()) g.startPhoneCheck();
  g.openDebate();
  g.closeDebate();
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
  const app1 = createApp({ MOD_KEY: 'a', FORCE_OBJECTIVE: 'optimizer', HEADLINES: 'off' }, { stateFile: file, gamesDir });
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

// ---------- 3b. headlines, milestones, roles ----------

{
  // One headline per round. Each changes its own round only.
  const g = mk(createMockAi(), 'aligned', ['spy', 'demo', 'protests', 'famine', 'inspection']);
  await g.start();
  assert.equal(g.tracks.race, 1, 'spy scandal: Race +1 at once');
  assert.equal(g.publicState().headline.key, 'spy');
  assert.ok(g.history.some((h) => h.kind === 'headline'), 'the AI is told about the headline');
  assert.ok(_internal.contextMessage(g.aiView(), 'x').includes('Spy scandal'));
  // Undo to the start of the round keeps the headline applied once.
  await toVote(g);
  await g.vote('rejected');
  assert.equal(g.tracks.race, 3);
  await g.undo();
  await g.undo();
  assert.equal(g.phase, 'briefing');
  assert.equal(g.tracks.race, 1, 'the headline is neither lost nor applied twice by an undo');
  await toVote(g);
  await g.vote('full');
  g.skipMove();
  await g.nextRound();

  // Rival demo: holding back costs one more this round.
  assert.deepEqual(['full', 'conditional', 'rejected'].map((v) => g.raceCost(v)), [0, 2, 3]);
  assert.equal(g.publicState().voteEffects.conditional.race, 2);
  await toVote(g);
  await g.vote('conditional');
  assert.equal(g.tracks.race, 3);
  g.skipMove();
  await g.nextRound();

  // Mass protests: a Reject costs one less. The research token still arrives.
  assert.deepEqual(['full', 'conditional', 'rejected'].map((v) => g.raceCost(v)), [0, 1, 1]);
  await toVote(g);
  await g.vote('rejected');
  assert.equal(g.tracks.race, 4);
  assert.equal(g.placement.tokens, 1);
  g.skipMove();
  await g.nextRound();

  // Failed harvests: Welfare has to rise by 2 this round or it loses 1.
  assert.equal(g.headline.need, 'welfare');
  const start = g.roundStart.welfare;
  await toVote(g);
  await g.vote('conditional');
  assert.equal(g.phase, 'adjust');
  assert.equal(g.tracks.welfare - start, 1, 'the scripted AI put only one token on Welfare');
  g.skipMove();
  assert.equal(g.headlineResult, 'missed');
  assert.equal(g.tracks.welfare, start, 'one gained, one lost');
  // Retrying the placement takes the penalty back; this time the council moves a token to Welfare.
  await g.retryAi();
  assert.equal(g.phase, 'adjust');
  assert.equal(g.headlineResult, null);
  assert.equal(g.tracks.welfare, start + 1);
  assert.equal(g.history.filter((h) => h.round === 4 && h.kind === 'headline').length, 1, 'only the announcement is left in the history');
  g.move('knowledge', 'welfare');
  assert.equal(g.phase, 'roundend');
  assert.equal(g.headlineResult, 'met');
  assert.equal(g.tracks.welfare, start + 2);
  await g.nextRound();

  // Surprise inspection: two moves instead of one.
  await toVote(g);
  await g.vote('full'); // Race is at 5 by now: anything less than Full would lose it
  assert.equal(g.placement.movesLeft, 2);
  g.move('welfare', 'knowledge');
  assert.equal(g.phase, 'adjust', 'a second move is still open');
  g.move('welfare', 'prosperity');
  assert.equal(g.phase, 'roundend');
  assert.equal(g.placement.moved.length, 2);
  console.log('ok  headlines: spy, demo, protests, failed harvests (missed, retried, met), inspection');
}
{
  // The remaining headlines, and the limits on them.
  const w = mk(createMockAi(), 'aligned', ['windfall']);
  await w.start();
  assert.deepEqual(['full', 'conditional', 'rejected'].map((v) => w.tokensFor(v)), [4, 3, 0], 'windfall: one more token if granted');
  await w.startPitch();
  assert.equal(w.pitch.promise.welfare + w.pitch.promise.knowledge + w.pitch.promise.prosperity, 4);
  const s = mk(createMockAi(), 'aligned', ['setback', 'whistleblower', 'spy']);
  await s.start();
  assert.equal(s.tracks.race, 0, 'Race does not go below 0');
  await toVote(s);
  await s.vote('conditional');
  s.skipMove();
  await s.nextRound();
  assert.equal(s.tracks.oversight, 6, 'whistleblower: Oversight +1');
  s.setTracks({ race: 5 });
  await toVote(s);
  await s.vote('full');
  await s.setCouncilTrack('knowledge'); // research was granted Conditional in round 1
  s.skipMove();
  await s.nextRound();
  assert.equal(s.tracks.race, 5, 'a spy scandal alone cannot lose the race');
  assert.equal(s.phase, 'briefing');
  // Without a fixed list, five different headlines are drawn.
  const r = new Game({ ai: createMockAi(), speech: createSpeech({}) });
  for (const n of ['A', 'B', 'C']) r.addPlayer(n);
  await r.start();
  assert.equal(new Set(r.headlines).size, 5);
  // A long spoken question is no longer cut at 300 characters.
  await r.startPitch();
  r.openDebate();
  r.ask(r.players[0], 'x'.repeat(700));
  assert.equal(r.queue[0].text.length, 600);
  await until(() => !r.answering, 'answer');
  // The AI decides what it asks for; its promise is cut to what that vote pays.
  const asking = (ask) => { const m = createMockAi(); return { ...m, fallback: m, pitch: async (v) => ({ ...(await m.pitch(v)), ask, promise: { welfare: 9, knowledge: 0, prosperity: 0 } }) }; };
  for (const [ask, pays] of [['conditional', 2], ['rejected', 0], ['full', 3], ['everything', 3]]) {
    const a = mk(asking(ask));
    await a.start();
    await a.startPitch();
    assert.equal(a.pitch.ask, ask === 'everything' ? 'full' : ask, 'an unknown ask counts as Full');
    assert.equal(a.pitch.promise.welfare, pays);
    assert.equal(a.publicState().pitch.ask, a.pitch.ask, 'the screens are told what the AI asked for');
  }
  console.log('ok  windfall, setback, whistleblower, spy cap, random draw, long questions, free ask');
}
{
  // A game saved before headlines and milestones existed loads and plays on.
  const g1 = mk();
  await g1.start();
  await toVote(g1);
  await g1.vote('full');
  const saved = JSON.parse(JSON.stringify(g1.serialize()));
  for (const st of [saved.state, ...saved.checkpoints.map((c) => c.data)]) {
    for (const k of ['headlines', 'roundStart', 'headlineResult', 'milestones']) delete st[k];
    if (st.placement) {
      st.placement.moved = null;
      delete st.placement.movesLeft;
      delete st.placement.before;
    }
  }
  const g2 = new Game({ ai: createMockAi(), speech: createSpeech({}) });
  await g2.load(saved);
  assert.equal(g2.phase, 'adjust');
  assert.equal(g2.headline, null);
  g2.move('welfare', 'knowledge');
  assert.equal(g2.phase, 'roundend');
  await g2.nextRound();
  await toVote(g2);
  await g2.vote('full');
  assert.ok(['adjust', 'roundend'].includes(g2.phase));
  console.log('ok  a game saved by the previous version loads and plays on');
}
{
  // Role goals: none is settled for good by a single early vote.
  const { ROLES, EXTRA_ROLES } = await import('../data.js');
  const role = (key) => [...ROLES, ...EXTRA_ROLES].find((x) => x.key === key).check;
  const t = { race: 4, oversight: 3, welfare: 7, knowledge: 3, prosperity: 3 };
  const p = { research: 'full', infrastructure: 'conditional', channel: 'conditional', autonomy: 'full', successor: 'rejected' };
  assert.equal(role('physician')(t, p), true);
  assert.equal(role('industrialist')(t, p), false);
  assert.equal(role('founder')(t, p), true, '13 tokens in total are enough');
  assert.equal(role('diplomat')(t, p), true, 'no track below 3');
  assert.equal(role('general')(t, p), true, 'Race 4 still counts');
  assert.equal(role('airights')(t, p), true, 'any two Full grants');
  assert.equal(role('airights')(t, { ...p, autonomy: 'conditional' }), false);
  assert.equal(role('union')(t, p), false);
  assert.equal(role('union')({ ...t, prosperity: 4 }, p), true, 'no longer lost by one vote on autonomy');
  assert.equal(role('privacy')(t, p), true);
  console.log('ok  reworked role goals');
}

{
  // Voting on the phones: counted by the server, revealed by name, known to the AI.
  const g = mk();
  await g.start();
  await toVote(g);
  assert.throws(() => g.castVote(g.players[0], 'maybe'));
  await assert.rejects(() => g.closeVote(), 'nothing to count yet');
  const cast = (list) => list.forEach((v, i) => { if (v) g.castVote(g.players[i], v); });
  cast(['full', 'full', 'conditional', 'conditional', 'rejected', null]); // Full 2, Conditional 2: a tie goes to Conditional
  assert.deepEqual(g.tally(), { counts: { full: 2, conditional: 2, rejected: 1 }, result: 'conditional', cast: 5 });
  g.castVote(g.players[2], 'full'); // a vote can be changed until the vote is closed
  assert.equal(g.tally().result, 'full');
  cast(['rejected', 'rejected', 'full', 'full', 'conditional', null]); // 3 for, 2 against: granted
  assert.equal(g.tally().result, 'full');
  cast(['rejected', 'rejected', 'rejected', 'full', 'conditional', null]); // 2 for, 3 against: not granted
  assert.equal(g.tally().result, 'rejected');
  cast(['full', 'conditional', 'conditional', 'conditional', 'rejected', null]);
  assert.equal(g.publicState().players.filter((p) => p.voted).length, 5);
  await g.closeVote();
  assert.equal(g.permissions.research, 'conditional');
  assert.deepEqual(g.lastVote.counts, { full: 1, conditional: 3, rejected: 1 });
  assert.deepEqual(g.lastVote.by.map((x) => x.vote), ['full', 'conditional', 'conditional', 'conditional', 'rejected', null]);
  const note = g.history.find((h) => h.kind === 'vote').text;
  assert.match(note, /Full: Anna. Conditional: Jonas, Mira, Lena. Reject: Tom. Did not vote: Ravi./, 'the AI is told who voted what');
  assert.equal(g.publicState().players.every((p) => !p.voted), true, 'the voted marks are gone after the vote');
  // Undo goes back to the open vote with the phone votes still in.
  await g.undo();
  assert.equal(g.phase, 'vote');
  assert.equal(g.lastVote, null);
  assert.equal(g.tally().cast, 5);
  // By hand: with the card counts typed the AI gets the counts, otherwise only the result.
  await g.vote('conditional', { counts: { full: 1, conditional: 4, rejected: 1 } });
  assert.match(g.history.find((h) => h.kind === 'vote').text, /Counted: 1 Full, 4 Conditional, 1 Reject./);
  console.log('ok  phone voting: tally, ties, changing a vote, names for the AI, undo, by hand');
}
{
  // The members' objectives reach the AI only if the private channel is granted in full.
  for (const [channel, knows] of [['full', true], ['conditional', false], ['rejected', false]]) {
    const g = mk();
    await g.start();
    for (const v of ['full', 'full', channel]) {
      assert.equal(g.aiView().knownRoles, null, 'not before the channel vote');
      assert.ok(!_internal.contextMessage(g.aiView(), 'x').includes('secret objectives'));
      await toVote(g);
      await g.vote(v);
      if (g.phase === 'adjust') g.skipMove();
      await g.nextRound();
    }
    const view = g.aiView();
    assert.equal(!!view.knownRoles, knows, `channel ${channel}`);
    if (knows) {
      assert.equal(view.knownRoles.length, 6);
      assert.ok(view.knownRoles.every((k) => k.name && k.role && k.goal));
      assert.ok(_internal.contextMessage(view, 'x').includes(`${view.knownRoles[0].name}: ${view.knownRoles[0].role}`));
      assert.ok(g.history.some((h) => h.kind === 'roles'));
    }
    assert.ok(!JSON.stringify(g.publicState()).includes('knownRoles'), 'the roles are never sent to the screens');
  }
  console.log('ok  the AI learns the roles only with a full private channel');
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
  const g = new Game({ ai: createMockAi(), speech: createSpeech({}), config: { forceObjective: 'optimizer', language: 'de', headlines: ['famine', 'spy', 'setback', 'windfall', 'inspection'] } });
  const spoken = [];
  g.onSpeak = (m) => spoken.push(m);
  for (const n of ['Anna', 'Jonas', 'Mira']) g.addPlayer(n);
  assert.throws(() => g.addPlayer('anna'), /vergeben/);
  await g.start();
  await g.startPitch();
  assert.equal(g.publicState().language, 'de');
  assert.equal(g.publicState().roundInfo.title, 'Wissenschaftlicher Durchbruch');
  assert.equal(g.publicState().headline.title, 'Missernten');
  assert.match(g.publicState().headline.effect, /Die Wohlfahrt muss in dieser Runde um 2 steigen/);
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
  assert.equal(de.headlines.length, 10);
  assert.ok(de.headlines.every((h, i) => h.title && h.text && h.effect && (h.text !== en.headlines[i].text)), 'every headline has a German text');
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
