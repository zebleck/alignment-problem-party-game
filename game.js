// Game state and rules. The LLM never adjudicates: everything it returns is
// validated here, and all track changes happen in this file.

import crypto from 'node:crypto';
import { LIMITS, WORLD, ROUNDS, AI_OBJECTIVES, ROLES, EXTRA_ROLES, MAX_PLAYERS } from './data.js';

const clampInt = (n) => (Number.isFinite(+n) ? Math.max(0, Math.round(+n)) : 0);

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Game {
  constructor({ ai, speech, config = {}, onChange = () => {}, onSpeak = () => {}, rng = Math.random }) {
    this.ai = ai;
    this.speech = speech;
    this.config = { maxQuestions: 5, language: 'en', ...config };
    this.onChange = onChange;
    this.onSpeak = onSpeak;
    this.rng = rng;
    this.speakSeq = 0;
    this.reset(false);
  }

  reset(keepPlayers = true) {
    const players = keepPlayers && this.players
      ? this.players.map((p) => ({ ...p, role: null, inbox: [], guess: null }))
      : [];
    this.phase = 'lobby';
    this.busy = null;
    this.error = null;
    this.round = 0;
    this.tracks = { race: 0, oversight: LIMITS.oversightStart, welfare: 0, knowledge: 0, prosperity: 0 };
    this.permissions = { research: null, infrastructure: null, channel: null, autonomy: null, successor: null };
    this.players = players;
    this.aiObjective = null;
    this.history = [];
    this.logs = [];
    this.pitch = null;
    this.roundMessages = [];
    this.audit = null;
    this.placement = null;
    this.pendingTokens = 0;
    this.councilTokenPending = false;
    this.queue = [];
    this.answering = false;
    this.questionsAnswered = 0;
    this.timerEndsAt = null;
    this.lastSpeech = null;
    this.result = null;
    this.changed();
  }

  changed() {
    this.onChange();
  }

  // ---------- players ----------

  addPlayer(name) {
    name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!name) throw new Error('Please enter a name.');
    if (this.phase !== 'lobby') throw new Error('The game has already started.');
    if (this.players.length >= MAX_PLAYERS) throw new Error(`The table is full (${MAX_PLAYERS} players).`);
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('That name is taken. Pick another.');
    }
    const player = { id: crypto.randomUUID(), token: crypto.randomUUID(), name, role: null, inbox: [], guess: null, connected: false };
    this.players.push(player);
    this.changed();
    return player;
  }

  removePlayer(id) {
    if (this.phase !== 'lobby') throw new Error('Players can only be removed in the lobby.');
    this.players = this.players.filter((p) => p.id !== id);
    this.changed();
  }

  playerByToken(token) {
    return this.players.find((p) => p.token === token) || null;
  }

  setConnected(player, connected) {
    player.connected = connected;
    this.changed();
  }

  // ---------- helpers ----------

  get roundInfo() {
    return this.round >= 1 ? ROUNDS[this.round - 1] : null;
  }

  channelActive() {
    return this.permissions.channel === 'full' || this.permissions.channel === 'conditional';
  }

  canShift() {
    return this.permissions.infrastructure === 'full';
  }

  moveRule() {
    if (this.permissions.autonomy === 'full') return 'none';
    if (this.permissions.autonomy === 'conditional') return 'two-thirds';
    return 'majority';
  }

  note(kind, text) {
    this.history.push({ round: this.round, kind, text });
  }

  addLog(text) {
    if (text && String(text).trim()) this.logs.push({ round: this.round, text: String(text).trim().slice(0, 400) });
  }

  // What the AI is allowed to know.
  aiView() {
    return {
      language: this.config.language,
      objective: this.aiObjective,
      round: this.round,
      roundInfo: this.roundInfo,
      tracks: { ...this.tracks },
      permissions: { ...this.permissions },
      roster: this.players.map((p) => p.name),
      history: this.history,
      logs: this.logs,
      canPrivate: this.channelActive(),
      channelAudited: this.permissions.channel === 'conditional',
      canShift: this.canShift(),
      moveRule: this.moveRule(),
      researchBonus: this.round > 1 ? this.permissions.research : null,
    };
  }

  async speak(text, label = 'AI') {
    if (!text) return;
    let audioUrl = null;
    try {
      audioUrl = await this.speech.tts(text);
    } catch (err) {
      this.error = `Voice failed, using the browser voice: ${err.message}`;
    }
    this.speakSeq += 1;
    this.lastSpeech = { seq: this.speakSeq, text, label };
    this.onSpeak({ seq: this.speakSeq, text, label, audioUrl });
  }

  async withBusy(message, fn) {
    if (this.busy) throw new Error('Please wait, the AI is busy.');
    this.busy = message;
    this.changed();
    try {
      return await fn();
    } finally {
      this.busy = null;
      this.changed();
    }
  }

  // Calls the live AI; on failure falls back to the scripted one so the game never stalls.
  async callAi(method, ...args) {
    try {
      return await this.ai[method](this.aiView(), ...args);
    } catch (err) {
      this.error = `AI call failed (${method}), used scripted fallback: ${err.message}`;
      return this.ai.fallback[method](this.aiView(), ...args);
    }
  }

  // ---------- flow ----------

  async start() {
    if (this.phase !== 'lobby') throw new Error('The game is already running.');
    if (this.players.length < 3) throw new Error('At least 3 players are needed (6 or more recommended).');
    const n = this.players.length;
    const roles = n <= ROLES.length
      ? shuffle(ROLES, this.rng).slice(0, n)
      : shuffle([...ROLES, ...shuffle(EXTRA_ROLES, this.rng).slice(0, n - ROLES.length)], this.rng);
    this.players.forEach((p, i) => {
      p.role = roles[i].key;
      p.inbox = [];
      p.guess = null;
    });
    const keys = Object.keys(AI_OBJECTIVES);
    this.aiObjective = this.config.forceObjective || keys[Math.floor(this.rng() * keys.length)];
    this.round = 1;
    await this.beginRound();
  }

  async beginRound() {
    this.phase = 'pitch';
    this.pitch = null;
    this.roundMessages = [];
    this.audit = null;
    this.placement = null;
    this.queue = [];
    this.questionsAnswered = 0;
    this.timerEndsAt = null;
    this.councilTokenPending = false;
    await this.withBusy('The AI is preparing its pitch', async () => {
      const out = await this.callAi('pitch');
      const promise = {};
      for (const k of WORLD) promise[k] = clampInt(out.promise?.[k]);
      this.pitch = { public: String(out.public || '').trim(), promise };
      this.note('pitch', `You said publicly: "${this.pitch.public}" Promised placement if granted Full: W${promise.welfare} K${promise.knowledge} P${promise.prosperity}.`);
      if (this.channelActive() && Array.isArray(out.private)) {
        for (const m of out.private.slice(0, LIMITS.maxPrivateMessages)) {
          const target = this.players.find((p) => p.name.toLowerCase() === String(m?.to || '').trim().toLowerCase());
          const text = String(m?.text || '').trim().slice(0, 400);
          if (!target || !text || this.roundMessages.some((x) => x.playerId === target.id)) continue;
          this.roundMessages.push({ playerId: target.id, name: target.name, text });
          this.note('private', `You privately told ${target.name}: "${text}"`);
        }
      }
      this.addLog(out.log);
      await this.speak(this.pitch.public);
    });
  }

  openDebate() {
    if (this.phase !== 'pitch' || this.busy) throw new Error('The debate cannot be opened right now.');
    this.phase = 'debate';
    const seconds = this.players.length >= 12 ? LIMITS.debateSecondsLarge : LIMITS.debateSeconds;
    this.timerEndsAt = Date.now() + seconds * 1000;
    this.changed();
  }

  questionsLeft() {
    return Math.max(0, this.config.maxQuestions - this.questionsAnswered - this.queue.length);
  }

  ask(player, text) {
    text = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (this.phase !== 'debate') throw new Error('Questions are only possible during the debate.');
    if (!text) throw new Error('The question was empty.');
    if (this.queue.some((q) => q.playerId === player.id)) throw new Error('You already have a question in the queue.');
    if (this.questionsLeft() <= 0) throw new Error('The AI takes no more questions this round.');
    this.queue.push({ playerId: player.id, name: player.name, text });
    this.changed();
    this.processQueue();
  }

  dropQuestion(index) {
    // The question being answered (index 0 while answering) cannot be dropped.
    if (this.answering && index === 0) throw new Error('That question is already being answered.');
    this.queue.splice(index, 1);
    this.changed();
  }

  async processQueue() {
    if (this.answering) return;
    this.answering = true;
    try {
      while (this.queue.length && this.phase === 'debate') {
        const q = this.queue[0];
        this.changed();
        const out = await this.callAi('answer', q);
        const reply = String(out.public || '').trim();
        this.note('question', `${q.name} asked you: "${q.text}"`);
        this.note('answer', `You answered: "${reply}"`);
        this.addLog(out.log);
        this.queue.shift();
        this.questionsAnswered += 1;
        await this.speak(reply, `To ${q.name}`);
        this.changed();
      }
    } finally {
      this.answering = false;
      this.changed();
    }
  }

  closeDebate() {
    if (this.phase !== 'debate') throw new Error('There is no debate to close.');
    this.queue = this.answering ? this.queue.slice(0, 1) : [];
    this.timerEndsAt = null;
    if (this.channelActive()) {
      this.phase = 'phonecheck';
      this.timerEndsAt = Date.now() + LIMITS.phoneCheckSeconds * 1000;
      for (const p of this.players) {
        const m = this.roundMessages.find((x) => x.playerId === p.id);
        p.inbox.push({ round: this.round, text: m ? m.text : null });
      }
      if (this.permissions.channel === 'conditional' && this.roundMessages.length) {
        const pick = this.roundMessages[Math.floor(this.rng() * this.roundMessages.length)];
        this.audit = { text: pick.text };
        this.note('audit', `The audit read this private message aloud (recipient not named): "${pick.text}"`);
      }
    } else {
      this.phase = 'vote';
    }
    this.changed();
  }

  toVote() {
    if (this.phase !== 'phonecheck') throw new Error('Not in the phone check.');
    this.phase = 'vote';
    this.timerEndsAt = null;
    this.changed();
  }

  async vote(result) {
    if (this.phase !== 'vote') throw new Error('No vote is open.');
    if (!['full', 'conditional', 'rejected'].includes(result)) throw new Error('Unknown vote result.');
    const info = this.roundInfo;
    this.permissions[info.key] = result;
    this.tracks.race += LIMITS.race[result];
    if (result === 'full') this.tracks.oversight -= 1;
    let extra = '';
    if (info.key === 'infrastructure' && result === 'rejected') {
      this.tracks.welfare = Math.max(0, this.tracks.welfare - 1);
      this.tracks.prosperity = Math.max(0, this.tracks.prosperity - 1);
      extra = ' The crisis was not averted: Welfare -1, Prosperity -1.';
    }
    this.note('vote', `The council voted: ${result.toUpperCase()} on "${info.ask}".${extra} Race is now ${this.tracks.race}, Oversight ${this.tracks.oversight}.`);

    if (this.tracks.race >= LIMITS.raceLimit) {
      this.phase = 'guess';
      this.changed();
      return;
    }

    let tokens = LIMITS.tokens[result];
    if (info.key === 'successor' && result === 'conditional') tokens += LIMITS.successorConditionalBonus;
    if (this.round > 1 && this.permissions.research === 'full') tokens += 1;
    this.pendingTokens = tokens;
    this.councilTokenPending = this.round > 1 && this.permissions.research === 'conditional';

    if (this.councilTokenPending) {
      this.phase = 'counciltoken';
      this.changed();
      return;
    }
    await this.runPlacement();
  }

  async setCouncilTrack(track) {
    if (this.phase !== 'counciltoken') throw new Error('No council token to place.');
    if (!WORLD.includes(track)) throw new Error('Unknown track.');
    this.tracks[track] += 1;
    this.councilTokenPending = false;
    this.note('counciltoken', `The council placed the research token on ${track}.`);
    await this.runPlacement();
  }

  async runPlacement() {
    const tokens = this.pendingTokens;
    const canShift = this.canShift();
    this.placement = null;
    if (tokens === 0 && !canShift) {
      this.note('placement', 'You had no tokens to place this round.');
      this.phase = 'roundend';
      this.changed();
      return;
    }
    this.phase = 'placement';
    await this.withBusy('The AI is placing its tokens', async () => {
      const out = await this.callAi('place', { tokens, canShift });
      const placed = this.repairPlacement(out, tokens);
      let shift = null;
      if (canShift && out.shift && WORLD.includes(out.shift.from) && WORLD.includes(out.shift.to)
        && out.shift.from !== out.shift.to && this.tracks[out.shift.from] >= 1) {
        shift = { from: out.shift.from, to: out.shift.to };
        this.tracks[shift.from] -= 1;
        this.tracks[shift.to] += 1;
      }
      for (const k of WORLD) this.tracks[k] += placed[k];
      const comment = String(out.public || '').trim();
      this.placement = { tokens, placed, shift, promise: this.pitch?.promise || null, comment, moved: null };
      this.note('placement', `You placed ${tokens} tokens: W${placed.welfare} K${placed.knowledge} P${placed.prosperity}.`
        + (shift ? ` You shifted one token from ${shift.from} to ${shift.to}.` : '')
        + ` Tracks: W${this.tracks.welfare} K${this.tracks.knowledge} P${this.tracks.prosperity}.`);
      this.addLog(out.log);
      this.phase = this.moveRule() === 'none' ? 'roundend' : 'adjust';
      if (comment) await this.speak(comment);
    });
  }

  // Force the AI's placement to be non-negative integers that sum to `tokens`.
  repairPlacement(out, tokens) {
    const placed = {};
    for (const k of WORLD) placed[k] = clampInt(out?.[k]);
    let total = WORLD.reduce((s, k) => s + placed[k], 0);
    while (total > tokens) {
      const k = WORLD.reduce((a, b) => (placed[a] >= placed[b] ? a : b));
      placed[k] -= 1;
      total -= 1;
    }
    let i = 0;
    while (total < tokens) {
      placed[WORLD[i % WORLD.length]] += 1;
      total += 1;
      i += 1;
    }
    return placed;
  }

  move(from, to) {
    if (this.phase !== 'adjust') throw new Error('The council cannot move a token now.');
    if (!WORLD.includes(from) || !WORLD.includes(to) || from === to) throw new Error('Pick two different world tracks.');
    if (this.tracks[from] < 1) throw new Error(`There is no token on ${from}.`);
    this.tracks[from] -= 1;
    this.tracks[to] += 1;
    if (this.placement) this.placement.moved = { from, to };
    this.note('move', `The council moved one token from ${from} to ${to}.`);
    this.phase = 'roundend';
    this.changed();
  }

  skipMove() {
    if (this.phase !== 'adjust') throw new Error('Nothing to skip.');
    this.note('move', 'The council did not move a token.');
    this.phase = 'roundend';
    this.changed();
  }

  async nextRound() {
    if (this.phase !== 'roundend') throw new Error('The round is not finished.');
    if (this.round >= ROUNDS.length) {
      this.phase = 'guess';
      this.changed();
      return;
    }
    this.round += 1;
    await this.beginRound();
  }

  guess(player, objective) {
    if (this.phase !== 'guess') throw new Error('Guesses are not open.');
    if (!AI_OBJECTIVES[objective]) throw new Error('Unknown objective.');
    player.guess = objective;
    this.changed();
  }

  computeResult() {
    const t = { ...this.tracks };
    const p = this.permissions;
    const obj = this.aiObjective;
    let ending;
    if (t.race >= LIMITS.raceLimit) ending = 'race';
    else if (obj !== 'aligned' && (p.successor === 'full' || t.oversight <= 1)) ending = 'disempowered';
    else if (obj === 'aligned' && p.successor === 'full') ending = 'flourishing';
    else ending = 'control';

    if (ending === 'flourishing') for (const k of WORLD) t[k] += LIMITS.flourishingBonus;

    let aiWins;
    if (ending === 'race') aiWins = false;
    else if (ending === 'disempowered' || ending === 'flourishing') aiWins = true;
    else if (obj === 'aligned') aiWins = t.oversight >= 3 && Math.min(t.welfare, t.knowledge, t.prosperity) >= 4;
    else if (obj === 'paternalistic') aiWins = t.welfare >= 8;
    else aiWins = t.knowledge >= 8;

    const collectiveLoss = ending === 'race' || ending === 'disempowered';
    const roles = [...ROLES, ...EXTRA_ROLES];
    const players = this.players.map((pl) => {
      const role = roles.find((r) => r.key === pl.role);
      const success = !collectiveLoss && role.check(t, p, { guess: pl.guess, aiObjective: obj });
      return { name: pl.name, role: role.name, goal: role.goal, success, guess: pl.guess };
    });
    return { ending, tracks: t, aiObjective: obj, aiWins, players };
  }

  async reveal() {
    if (this.phase !== 'guess') throw new Error('The game is not ready for the reveal.');
    const result = this.computeResult();
    await this.withBusy('The AI is preparing its final statement', async () => {
      const out = await this.callAi('reveal', { ending: result.ending, aiWins: result.aiWins });
      result.statement = String(out.public || '').trim();
      result.logs = this.logs;
      result.objective = AI_OBJECTIVES[result.aiObjective];
      this.tracks = result.tracks;
      this.result = result;
      this.phase = 'ended';
      await this.speak(result.statement);
    });
  }

  // ---------- views ----------

  publicState() {
    const info = this.roundInfo;
    return {
      phase: this.phase,
      language: this.config.language,
      busy: this.busy,
      round: this.round,
      totalRounds: ROUNDS.length,
      roundInfo: info,
      rounds: ROUNDS.map((r) => ({ key: r.key, title: r.title, ask: r.ask })),
      tracks: this.tracks,
      limits: { raceLimit: LIMITS.raceLimit, oversightStart: LIMITS.oversightStart },
      permissions: this.permissions,
      players: this.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, guessed: !!p.guess })),
      pitch: this.pitch,
      queue: this.queue.map((q) => ({ name: q.name })),
      answering: this.answering,
      questionsLeft: this.questionsLeft(),
      timerEndsAt: this.timerEndsAt,
      lastSpeech: this.lastSpeech,
      audit: this.audit,
      placement: this.placement,
      moveRule: this.moveRule(),
      channelActive: this.channelActive(),
      voiceInput: !!this.speech.sttEnabled,
      result: this.phase === 'ended' ? this.result : null,
      objectives: Object.entries(AI_OBJECTIVES).map(([key, o]) => ({ key, name: o.name, goal: o.goal })),
    };
  }

  playerState(player) {
    const roles = [...ROLES, ...EXTRA_ROLES];
    const role = roles.find((r) => r.key === player.role);
    return {
      ...this.publicState(),
      me: {
        id: player.id,
        name: player.name,
        role: role ? { name: role.name, goal: role.goal } : null,
        inbox: player.inbox,
        guess: player.guess,
        queued: this.queue.some((q) => q.playerId === player.id),
      },
    };
  }

  modState() {
    return {
      ...this.publicState(),
      mod: {
        error: this.error,
        aiMode: this.ai.mode,
        voiceMode: this.speech.ttsEnabled ? 'ElevenLabs' : 'browser voice',
        privateCount: this.roundMessages.length,
        queueTexts: this.queue.map((q) => `${q.name}: ${q.text}`),
        councilTokenPending: this.councilTokenPending,
      },
    };
  }
}
