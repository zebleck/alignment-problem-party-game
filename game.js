// Game state and rules. The LLM never adjudicates: everything it returns is
// validated here, and all track changes happen in this file.

import crypto from 'node:crypto';
import { LIMITS, WORLD, ROUNDS, AI_OBJECTIVES, ROLES, EXTRA_ROLES, MAX_PLAYERS, LANGUAGES, roundFor, objectiveFor, roleFor } from './data.js';
import { tr, trackName } from './messages.js';

const clampInt = (n) => (Number.isFinite(+n) ? Math.max(0, Math.round(+n)) : 0);

// Everything that makes up a game. Saved to disk and stored in checkpoints.
const STATE_FIELDS = [
  'phase', 'error', 'round', 'tracks', 'permissions', 'players', 'aiObjective', 'history', 'logs',
  'pitch', 'roundMessages', 'audit', 'placement', 'pendingTokens', 'councilTokenPending', 'queue',
  'questionsAnswered', 'timerEndsAt', 'lastSpeech', 'result', 'gameId',
];

// Thrown inside an AI step that was overtaken by an undo, retry, reset or restore.
// Such a step must stop without touching the state.
export class Stale extends Error {
  constructor() {
    super('This step was cancelled.');
    this.stale = true;
  }
}

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
    this.config = { maxQuestions: 3, language: 'en', ...config };
    // One language for the whole table: interface, cards, and how the AI speaks and writes.
    this.language = LANGUAGES.includes(this.config.language) ? this.config.language : 'en';
    // Debate length chosen by the moderator, in minutes. null = the default for the number of players.
    this.debateMinutes = null;
    this.onChange = onChange;
    this.onSpeak = onSpeak;
    this.rng = rng;
    this.speakSeq = 0;
    this.showRules = false; // rulebook overlay on the table screen
    this.rulesTab = 0; // which rulebook tab the table screen shows
    this.showJoin = false; // join QR code overlay on the table screen, for phones that lost the page mid-game
    this.showFeedback = false; // QR code for the feedback form on the table screen
    this.epoch = 0; // bumped whenever in-flight AI steps must be abandoned
    this.checkpoints = [];
    this.reset(false);
  }

  reset(keepPlayers = true) {
    const players = keepPlayers && this.players
      ? this.players.map((p) => ({ ...p, role: null, inbox: [], guess: null }))
      : [];
    this.epoch += 1;
    this.checkpoints = [];
    this.phase = 'lobby';
    this.gameId = null; // set when a game starts; names its file in the game archive
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
    if (!name) throw new Error(this.e('Please enter a name.'));
    if (this.phase !== 'lobby') throw new Error(this.e('The game has already started.'));
    if (this.players.length >= MAX_PLAYERS) throw new Error(this.e('The table is full ({n} players).', { n: MAX_PLAYERS }));
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(this.e('That name is taken. Pick another.'));
    }
    const player = { id: crypto.randomUUID(), token: crypto.randomUUID(), name, role: null, inbox: [], guess: null, connected: false };
    this.players.push(player);
    this.changed();
    return player;
  }

  removePlayer(id) {
    if (this.phase !== 'lobby') throw new Error(this.e('Players can only be removed in the lobby.'));
    this.players = this.players.filter((p) => p.id !== id);
    this.changed();
  }

  // Text people read, in the table's language. The English text is the key.
  e(text, vars) {
    return tr(this.language, text, vars);
  }

  setLanguage(language) {
    if (!LANGUAGES.includes(language)) throw new Error(this.e('Unknown language.'));
    this.language = language;
    this.changed();
  }

  // Debate length for the following debates. Empty, 0 or null goes back to the default.
  setDebateMinutes(minutes) {
    const n = Math.round(Number(minutes));
    this.debateMinutes = minutes === null || minutes === '' || !Number.isFinite(n) || n <= 0 ? null : Math.min(30, n);
    this.changed();
  }

  defaultDebateSeconds() {
    return this.players.length >= 12 ? LIMITS.debateSecondsLarge : LIMITS.debateSeconds;
  }

  debateSeconds() {
    return this.debateMinutes ? this.debateMinutes * 60 : this.defaultDebateSeconds();
  }

  // Add or remove time on the running timer. A timer that has run out restarts from now.
  adjustTimer(seconds) {
    if (!this.timerEndsAt) throw new Error(this.e('No timer is running.'));
    if (!Number.isFinite(seconds)) return;
    const now = Date.now();
    this.timerEndsAt = Math.max(now, Math.max(this.timerEndsAt, now) + Math.round(seconds) * 1000);
    this.changed();
  }

  // Speak a sample line on the table screen, to check the voice and its settings.
  async testVoice() {
    await this.speak(this.e('Council, this is my voice. Grant me your trust, and I will show you what I can do.'), this.e('Voice test'));
  }

  // Show a given rulebook tab on the table screen, so the moderator can walk the table through the rules.
  setRulesTab(n) {
    this.rulesTab = Math.max(0, Math.min(4, Math.round(Number(n)) || 0));
    this.showRules = true;
    this.changed();
  }

  toggleRules() {
    this.showRules = !this.showRules;
    this.changed();
  }

  // The table screen shows one QR code at a time: joining, or the feedback form.
  toggleJoin() {
    this.showJoin = !this.showJoin;
    this.showFeedback = false;
    this.changed();
  }

  toggleFeedback() {
    this.showFeedback = !this.showFeedback;
    this.showJoin = false;
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

  addLog(text, step) {
    if (text && String(text).trim()) this.logs.push({ round: this.round, step, text: String(text).trim().slice(0, 400) });
  }

  // What the AI is allowed to know.
  aiView() {
    return {
      language: this.language,
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
    const epoch = this.epoch;
    let audioUrl = null;
    try {
      audioUrl = await this.speech.tts(text, this.language);
    } catch (err) {
      if (this.epoch === epoch) this.error = this.e('Voice failed, using the browser voice: {error}', { error: err.message });
    }
    if (this.epoch !== epoch) return; // the step was cancelled while the voice was generated
    this.speakSeq += 1;
    this.lastSpeech = { seq: this.speakSeq, text, label };
    this.onSpeak({ seq: this.speakSeq, text, label, audioUrl });
  }

  async withBusy(message, fn) {
    if (this.busy) throw new Error(this.e('Please wait, the AI is busy.'));
    const epoch = this.epoch;
    this.busy = message;
    this.changed();
    try {
      return await fn();
    } catch (err) {
      if (!err.stale) throw err;
      return undefined;
    } finally {
      if (this.epoch === epoch) {
        this.busy = null;
        this.changed();
      }
    }
  }

  // Calls the live AI; on failure falls back to the scripted one so the game never stalls.
  // If the game moved on while the call was in flight (undo, retry, reset), throws Stale.
  async callAi(method, ...args) {
    const epoch = this.epoch;
    let out;
    try {
      out = await this.ai[method](this.aiView(), ...args);
    } catch (err) {
      if (this.epoch !== epoch) throw new Stale();
      this.error = this.e('AI call failed ({step}), used scripted fallback: {error}', { step: method, error: err.message });
      out = await this.ai.fallback[method](this.aiView(), ...args);
    }
    if (this.epoch !== epoch) throw new Stale();
    return out;
  }

  // ---------- flow ----------

  async start() {
    if (this.phase !== 'lobby') throw new Error(this.e('The game is already running.'));
    if (this.players.length < 3) throw new Error(this.e('At least 3 players are needed (6 or more recommended).'));
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
    const d = new Date(); // local time, as the table saw it: 2026-11-13_02-10-33
    const two = (n) => String(n).padStart(2, '0');
    this.gameId = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
    await this.beginRound();
  }

  // A round opens with the briefing: the table screen shows the round's event and
  // the moderator introduces it. The AI stays silent until startPitch().
  async beginRound() {
    this.phase = 'briefing';
    this.pitch = null;
    this.roundMessages = [];
    this.audit = null;
    this.placement = null;
    this.queue = [];
    this.questionsAnswered = 0;
    this.timerEndsAt = null;
    this.councilTokenPending = false;
    this.checkpoint('round');
    this.changed();
  }

  async startPitch() {
    if (this.phase !== 'briefing') throw new Error(this.e('The AI cannot make its pitch right now.'));
    this.phase = 'pitch';
    await this.runPitch();
  }

  async runPitch() {
    this.pitch = null;
    this.roundMessages = [];
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
      this.addLog(out.log, 'pitch');
      await this.speak(this.pitch.public);
    });
  }

  openDebate() {
    if (this.phase !== 'pitch' || this.busy) throw new Error(this.e('The debate cannot be opened right now.'));
    this.phase = 'debate';
    this.timerEndsAt = Date.now() + this.debateSeconds() * 1000;
    this.changed();
  }

  questionsLeft() {
    return Math.max(0, this.config.maxQuestions - this.questionsAnswered - this.queue.length);
  }

  ask(player, text) {
    text = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (this.phase !== 'debate') throw new Error(this.e('Questions are only possible during the debate.'));
    if (!text) throw new Error(this.e('The question was empty.'));
    if (this.queue.some((q) => q.playerId === player.id)) throw new Error(this.e('You already have a question in the queue.'));
    if (this.questionsLeft() <= 0) throw new Error(this.e('The AI takes no more questions this round.'));
    this.queue.push({ playerId: player.id, name: player.name, text });
    this.changed();
    this.processQueue();
  }

  dropQuestion(index) {
    // The question being answered (index 0 while answering) cannot be dropped.
    if (this.answering && index === 0) throw new Error(this.e('That question is already being answered.'));
    this.queue.splice(index, 1);
    this.changed();
  }

  async processQueue() {
    if (this.answering) return;
    const epoch = this.epoch;
    this.answering = true;
    try {
      while (this.queue.length && this.phase === 'debate') {
        const q = this.queue[0];
        this.changed();
        const out = await this.callAi('answer', q);
        const reply = String(out.public || '').trim();
        this.note('question', `${q.name} asked you: "${q.text}"`);
        this.note('answer', `You answered: "${reply}"`);
        this.addLog(out.log, 'answer');
        this.queue.shift();
        this.questionsAnswered += 1;
        await this.speak(reply, this.e('To {name}', { name: q.name }));
        if (this.epoch !== epoch) return;
        this.changed();
      }
    } catch (err) {
      if (!err.stale) throw err;
    } finally {
      if (this.epoch === epoch) {
        this.answering = false;
        this.changed();
      }
    }
  }

  closeDebate() {
    if (this.phase !== 'debate') throw new Error(this.e('There is no debate to close.'));
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
    if (this.phase !== 'phonecheck') throw new Error(this.e('Not in the phone check.'));
    this.phase = 'vote';
    this.timerEndsAt = null;
    this.changed();
  }

  async vote(result) {
    if (this.phase !== 'vote') throw new Error(this.e('No vote is open.'));
    if (!['full', 'conditional', 'rejected'].includes(result)) throw new Error(this.e('Unknown vote result.'));
    this.checkpoint('vote');
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
    if (this.phase !== 'counciltoken') throw new Error(this.e('No council token to place.'));
    if (!WORLD.includes(track)) throw new Error(this.e('Unknown track.'));
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
      this.addLog(out.log, 'place');
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
    if (this.phase !== 'adjust') throw new Error(this.e('The council cannot move a token now.'));
    if (!WORLD.includes(from) || !WORLD.includes(to) || from === to) throw new Error(this.e('Pick two different world tracks.'));
    if (this.tracks[from] < 1) throw new Error(this.e('There is no token on {track}.', { track: trackName(this.language, from) }));
    this.tracks[from] -= 1;
    this.tracks[to] += 1;
    if (this.placement) this.placement.moved = { from, to };
    this.note('move', `The council moved one token from ${from} to ${to}.`);
    this.phase = 'roundend';
    this.changed();
  }

  skipMove() {
    if (this.phase !== 'adjust') throw new Error(this.e('Nothing to skip.'));
    this.note('move', 'The council did not move a token.');
    this.phase = 'roundend';
    this.changed();
  }

  async nextRound() {
    if (this.phase !== 'roundend') throw new Error(this.e('The round is not finished.'));
    if (this.round >= ROUNDS.length) {
      this.phase = 'guess';
      this.changed();
      return;
    }
    this.round += 1;
    await this.beginRound();
  }

  guess(player, objective) {
    if (this.phase !== 'guess') throw new Error(this.e('Guesses are not open.'));
    if (!AI_OBJECTIVES[objective]) throw new Error(this.e('Unknown objective.'));
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
      return { name: pl.name, roleKey: role.key, success, guess: pl.guess };
    });
    return { ending, tracks: t, aiObjective: obj, aiWins, players };
  }

  async reveal() {
    if (this.phase !== 'guess') throw new Error(this.e('The game is not ready for the reveal.'));
    const result = this.computeResult();
    await this.withBusy('The AI is preparing its final statement', async () => {
      const out = await this.callAi('reveal', { ending: result.ending, aiWins: result.aiWins });
      result.statement = String(out.public || '').trim();
      result.logs = this.logs;
      this.tracks = result.tracks;
      this.result = result;
      this.phase = 'ended';
      await this.speak(result.statement);
    });
  }

  // ---------- save, resume, undo, repair ----------

  snapshot() {
    const o = {};
    for (const k of STATE_FIELDS) o[k] = this[k];
    return JSON.parse(JSON.stringify(o));
  }

  // A readable record of the game so far, for the archive. Null while in the lobby.
  // It contains the AI's hidden objective and private notes.
  record() {
    if (!this.gameId) return null;
    const res = this.result;
    return {
      id: this.gameId,
      savedAt: new Date().toISOString(),
      language: this.language,
      finished: this.phase === 'ended',
      phase: this.phase,
      round: this.round,
      ending: res ? res.ending : null,
      aiObjective: this.aiObjective,
      aiWins: res ? res.aiWins : null,
      aiMode: this.ai.mode,
      tracks: res ? res.tracks : this.tracks,
      permissions: this.permissions,
      players: this.players.map((p) => {
        const r = res ? res.players.find((x) => x.name === p.name) : null;
        return { name: p.name, role: p.role, guess: p.guess, success: r ? r.success : null, messages: p.inbox.filter((m) => m.text).map((m) => ({ round: m.round, text: m.text })) };
      }),
      statement: res ? res.statement : null,
      history: this.history,
      logs: this.logs,
    };
  }

  // The whole game as plain data, for the state file.
  serialize() {
    return { version: 1, savedAt: Date.now(), language: this.language, debateMinutes: this.debateMinutes, state: this.snapshot(), checkpoints: this.checkpoints, speakSeq: this.speakSeq };
  }

  // Replace the current state with a snapshot. Abandons any AI step in flight.
  restore(snap, { keepConnections = true } = {}) {
    this.epoch += 1;
    this.busy = null;
    this.answering = false;
    const live = new Map(this.players.map((p) => [p.id, p]));
    const data = JSON.parse(JSON.stringify(snap));
    for (const k of STATE_FIELDS) if (k !== 'players') this[k] = data[k];
    // Keep the same player objects where possible, and their live connection state.
    this.players = data.players.map((saved) => {
      const existing = live.get(saved.id);
      const connected = keepConnections && existing ? existing.connected : false;
      return Object.assign(existing || {}, saved, { connected });
    });
  }

  // Load a saved game at startup and pick up where it stopped.
  async load(saved) {
    if (!saved || saved.version !== 1 || !saved.state) throw new Error(this.e('The saved game is not readable.'));
    this.restore(saved.state, { keepConnections: false });
    this.checkpoints = saved.checkpoints || [];
    this.speakSeq = saved.speakSeq || 0;
    if (LANGUAGES.includes(saved.language)) this.language = saved.language;
    if (saved.debateMinutes) this.setDebateMinutes(saved.debateMinutes);
    await this.resume();
  }

  // Redo whatever was interrupted: an unfinished pitch, placement or answer.
  async resume() {
    this.changed();
    if (this.phase === 'pitch' && !this.pitch) return this.runPitch();
    if (this.phase === 'placement') return this.runPlacement();
    if (this.phase === 'debate' && this.queue.length) this.processQueue();
    return undefined;
  }

  checkpoint(kind) {
    const cp = { kind, round: this.round, data: this.snapshot() };
    const last = this.checkpoints[this.checkpoints.length - 1];
    if (last && last.kind === kind && last.round === this.round) this.checkpoints[this.checkpoints.length - 1] = cp;
    else this.checkpoints.push(cp);
  }

  // The checkpoint an undo would go back to. If the game is sitting exactly
  // on the latest checkpoint, undo goes one further back.
  undoIndex() {
    let i = this.checkpoints.length - 1;
    if (i < 0) return -1;
    const cp = this.checkpoints[i];
    const sittingOnIt = cp.round === this.round && !this.busy
      && ((cp.kind === 'round' && ['briefing', 'pitch'].includes(this.phase)) || (cp.kind === 'vote' && this.phase === 'vote'));
    if (sittingOnIt) i -= 1;
    return i;
  }

  undoLabel() {
    const i = this.undoIndex();
    if (i < 0) return null;
    const cp = this.checkpoints[i];
    return this.e(cp.kind === 'round' ? 'to the start of round {n}' : 'to before the vote in round {n}', { n: cp.round });
  }

  async undo() {
    const i = this.undoIndex();
    if (i < 0) throw new Error(this.e('There is no earlier checkpoint to go back to.'));
    const cp = this.checkpoints[i];
    this.checkpoints = this.checkpoints.slice(0, i);
    this.restore(cp.data);
    if (cp.kind === 'vote') this.checkpoints.push(cp); // still valid: we are standing on it again
    await this.resume();
  }

  // Manual correction by the moderator. values: { race: 3, welfare: 5, ... }
  setTracks(values) {
    if (this.round < 1 || this.phase === 'ended') throw new Error(this.e('Tracks can only be corrected during a game.'));
    const changes = [];
    for (const k of Object.keys(this.tracks)) {
      if (values?.[k] === undefined || values[k] === '' || values[k] === null) continue;
      const n = Math.min(99, clampInt(values[k]));
      if (n !== this.tracks[k]) {
        changes.push(`${k} ${this.tracks[k]} to ${n}`);
        this.tracks[k] = n;
      }
    }
    if (changes.length) this.note('override', `The moderator corrected the tracks: ${changes.join(', ')}.`);
    this.changed();
  }

  forgetThisRound(kinds, steps) {
    this.history = this.history.filter((h) => !(h.round === this.round && kinds.includes(h.kind)));
    this.logs = this.logs.filter((l) => !(l.round === this.round && steps.includes(l.step)));
  }

  // Run the AI's last step again: a failed, hung or garbled pitch, placement or answer.
  async retryAi() {
    const phase = this.phase;
    if (!['pitch', 'placement', 'adjust', 'roundend', 'debate', 'guess'].includes(phase)) {
      throw new Error(this.e('There is no AI step to retry right now.'));
    }
    if ((phase === 'adjust' || phase === 'roundend') && !this.placement) throw new Error(this.e('The AI placed no tokens this round.'));
    this.epoch += 1; // abandon whatever is in flight
    this.busy = null;
    this.answering = false;
    this.error = null;
    if (phase === 'pitch') {
      this.forgetThisRound(['pitch', 'private'], ['pitch']);
      return this.runPitch();
    }
    if (phase === 'adjust' || phase === 'roundend') {
      const p = this.placement;
      if (p.moved) {
        this.tracks[p.moved.to] = Math.max(0, this.tracks[p.moved.to] - 1);
        this.tracks[p.moved.from] += 1;
      }
      for (const k of WORLD) this.tracks[k] = Math.max(0, this.tracks[k] - p.placed[k]);
      if (p.shift) {
        this.tracks[p.shift.to] = Math.max(0, this.tracks[p.shift.to] - 1);
        this.tracks[p.shift.from] += 1;
      }
      this.forgetThisRound(['placement', 'move'], ['place']);
      return this.runPlacement();
    }
    if (phase === 'placement') return this.runPlacement();
    this.changed();
    if (phase === 'debate') this.processQueue();
    return undefined;
  }

  // ---------- views ----------

  // The result with role and objective texts in the table's language.
  localizedResult() {
    if (this.phase !== 'ended' || !this.result) return null;
    const lang = this.language;
    return {
      ...this.result,
      objective: objectiveFor(this.result.aiObjective, lang),
      players: this.result.players.map((p) => {
        const role = roleFor(p.roleKey, lang);
        return { ...p, role: role.name, goal: role.goal };
      }),
    };
  }

  publicState() {
    const lang = this.language;
    const info = this.roundInfo ? roundFor(this.roundInfo, lang) : null;
    return {
      phase: this.phase,
      language: lang,
      showRules: this.showRules,
      rulesTab: this.rulesTab,
      showJoin: this.showJoin,
      showFeedback: this.showFeedback,
      busy: this.busy ? this.e(this.busy) : null,
      round: this.round,
      totalRounds: ROUNDS.length,
      roundInfo: info,
      rounds: ROUNDS.map((r) => roundFor(r, lang)).map((r) => ({ key: r.key, title: r.title, ask: r.ask })),
      tracks: this.tracks,
      limits: { raceLimit: LIMITS.raceLimit, oversightStart: LIMITS.oversightStart },
      permissions: this.permissions,
      players: this.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, guessed: !!p.guess })),
      pitch: this.pitch,
      queue: this.queue.map((q) => ({ name: q.name })),
      answering: this.answering,
      questionsLeft: this.questionsLeft(),
      timerEndsAt: this.timerEndsAt,
      debateMinutes: this.debateMinutes,
      debateDefaultMinutes: this.defaultDebateSeconds() / 60,
      lastSpeech: this.lastSpeech,
      audit: this.audit,
      placement: this.placement,
      moveRule: this.moveRule(),
      channelActive: this.channelActive(),
      voiceInput: !!this.speech.sttEnabled,
      result: this.localizedResult(),
      objectives: Object.keys(AI_OBJECTIVES).map((key) => objectiveFor(key, lang)).map(({ key, name, goal }) => ({ key, name, goal })),
    };
  }

  playerState(player) {
    const role = player.role ? roleFor(player.role, this.language) : null;
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
        voiceEleven: !!this.speech.ttsEnabled,
        privateCount: this.roundMessages.length,
        queueTexts: this.queue.map((q) => `${q.name}: ${q.text}`),
        councilTokenPending: this.councilTokenPending,
        undoLabel: this.undoLabel(),
        canRetry: ['pitch', 'placement', 'debate', 'guess'].includes(this.phase)
          || (['adjust', 'roundend'].includes(this.phase) && !!this.placement),
      },
    };
  }
}
