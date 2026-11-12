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

  act('start');
  const votes = ['full', 'conditional', 'conditional', 'conditional', 'conditional'];
  for (let round = 1; round <= 5; round++) {
    await phase('pitch');
    assert.ok(players[0].state.me.role.name, 'player sees a role');
    assert.equal(leaks(screen.state) || leaks(mod.state) || leaks(players[0].state), false, 'the objective is not leaked before the reveal');
    act('openDebate');
    await phase('debate');
    players[1].send({ type: 'ask', text: 'What will you do with autonomy?' });
    await until(() => mod.state.questionsLeft === 4 && !mod.state.answering, 'question answered');
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

console.log('\nAll checks passed.');
process.exit(0);
