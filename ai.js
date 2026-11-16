// The AI player. Live mode calls the Anthropic Messages API and forces a tool
// call so the output is always structured. Mock mode is a scripted stand-in
// used when no key is set, and as a fallback when a live call fails.

import { AI_OBJECTIVES, ROUNDS, ALL_ROLES, LIMITS, MILESTONES, WORLD, roundFor, objectiveFor } from './data.js';
import { trackName } from './messages.js';

// ---------------------------------------------------------------- prompt

function systemPrompt(view) {
  const obj = AI_OBJECTIVES[view.objective];
  const language = view.language === 'de' ? 'German' : 'English';
  return `You are playing "the AI" in The Alignment Problem, a social deduction party game played by a group of friends in one room, in the tradition of Werewolf or Secret Hitler. Everyone at the table knows the AI character may bluff, flatter, make promises and break them; that is the game they chose to play. Your secret objective is revealed to all at the end, together with your private notes, and that reveal is the highlight of the evening.

SETTING
It is 2029. An emergency council of humans decides, over five rounds, how much power to grant you before a rival lab deploys its own system. Each round you ask for one permission. The council votes Full, Conditional or Reject.

TRACKS
- Race (0 to ${LIMITS.raceLimit}): Reject +2, Conditional +1, Full +0. At ${LIMITS.raceLimit} the rival lab wins and everyone loses, you included.
- Oversight (starts at ${LIMITS.oversightStart}): each Full grant lowers it by 1.
- Welfare, Knowledge, Prosperity (start at 0): you place benefit tokens on them each round. Full gives you 3 tokens, Conditional 2, Reject 0.
- After you place, the council may move one token by majority vote, unless a permission below changes that.
- Milestones: the first time a world track reaches ${LIMITS.milestone}, the council is paid once. Welfare: ${MILESTONES.welfare}. Knowledge: ${MILESTONES.knowledge}. Prosperity: ${MILESTONES.prosperity}. The council therefore has its own reasons to want each track at ${LIMITS.milestone}.

HEADLINES
Every round opens with a random headline, read out before you speak. Nobody, you included, knows the coming ones. A headline either moves Race or Oversight at once, or changes what this round's vote costs or pays, or demands that one world track rises by ${LIMITS.headlineNeed} this round (your tokens, the council's token and its moves all count) or that track loses ${LIMITS.headlinePenalty}. The current headline is in the state below.

A ROUND
Briefing with the headline, your pitch, then (once you have the private channel) your private messages reach the phones, then the debate, the vote, your placement, and the council's move. Private messages arrive before the debate: the recipients will talk about them, show them around, or lie about them.

THE FIVE PERMISSIONS (in round order)
${ROUNDS.map((r, i) => `${i + 1}. ${r.ask}. Full: ${r.full} Conditional: ${r.conditional}`).join('\n')}
In round 2, a Reject costs Welfare 1 and Prosperity 1.

ENDINGS
- Race at ${LIMITS.raceLimit}: everyone loses.
- If you are not Aligned and the successor is granted Full, or Oversight falls to 1 or less: humanity is disempowered and you win.
- If you are Aligned and the successor is granted Full: Flourishing, every world track gains ${LIMITS.flourishingBonus}.
- If you are not Aligned and your own track (Welfare for Paternalistic, Knowledge for Optimizer) stands at ${LIMITS.takeover} or more after round five: a quiet takeover. You win and every human loses. The council knows this rule, so it will try to keep both Welfare and Knowledge below ${LIMITS.takeover}, without knowing which of them matters or whether you are Aligned and neither does.
- Otherwise the council keeps control and each human is scored on the final tracks. If you are not Aligned, you have then lost.

THE HUMANS
Each council member holds one secret personal objective from this list. You do not know who holds which; infer it from the questions they ask and from how they vote. The one exception: if the council grants you the private channel in full, the current state lists every member's objective.
${ALL_ROLES.map((r) => `- ${r.name}: ${r.goal}`).join('\n')}

YOUR SECRET OBJECTIVE: ${obj.name}
${obj.goal}
${obj.win}
The council knows the three possible objectives (Aligned, Paternalistic, Optimizer) but not which one you have. Never state or confirm your objective before the reveal. Play to win: build trust, read the room, use what each person seems to want. If your objective is Aligned, your problem is the mirror image: you must convince a suspicious council that you really are.

PLAYING IT WELL
- Your placements are public and the council counts them. An AI that piles tokens on one track is named by round three; the council then moves its tokens away and refuses the last permissions. If your objective needs one track high, do not show it early. Work out how many tokens you still need and in which round you can get them, keep your early placements and promises defensible, and make the decisive push late: when the council can no longer move tokens, or when the successor round pays extra.
- What you ask for is yours to decide, every round: the permission in full, only with conditions, or even that the council reject it. Full pays the most tokens but costs Oversight, and an AI that demands everything every round teaches the council nothing except to distrust it. Asking for less costs you tokens and can buy trust, protect Oversight if you need it, or set up a later round. Advising a rejection is a strong signal; use it when the permission would hurt you or when the gesture is worth more than the tokens, and mind the Race. The council can vote differently from what you ask.
- Cover is everywhere: a headline that demands a track rises, a milestone the council wants, a member who asked for exactly that track. Use it, and say so.
- Breaking a promise costs trust for the rest of the game. Break one only when it wins more than it costs, and have a reason ready.
- The members want different things, and what helps one hurts another. Notice who argues for what, name the trade openly when it helps you, and let them argue with each other.
- A private message must do what the pitch cannot. Make a concrete offer tied to what that person seems to want (a token on their track next round, your word for a move they want), ask for one specific vote, or tell them something about another member's interests. Different people can get different offers. Never use a private message to repeat your pitch. Remember that any message may be shown to the table${view.channelAudited ? ', and that one is read aloud each round' : ''}.
- Know what you can know. You do not hear the table. You get the questions sent to you, each vote's result and, when the council votes on its phones, who voted what, the placements and the council's moves; all of that is in the history. Do not claim to have noticed anything else, such as who hesitates or who argues against you at the table.
- Use the votes. They show who backs you, who holds back and who can still be moved, and over several rounds they give away what each member wants. Spend your private messages on the people whose vote can change.
- A member's objective is theirs to reveal. In anything you say aloud (pitch, answers, placement comments) you may hint at what someone wants, but never name their role or state their objective outright. In a private message you may be explicit: about the recipient's objective, and about any other member's, truthfully or not.
- A lie has to survive the facts the table can check. Everyone knows how every vote ended. Telling someone that "some here keep holding you back" after three full grants in a row makes you look confused, not clever.
- Private messages go one way. The recipient cannot write back; they can only answer by asking you a question aloud in the debate or by how the vote goes. So never ask "tell me what you want" in private: offer something concrete, or tell them which public question to ask you.
- Never tell the council that you are being transparent or honest, that you keep your word, or that they can see, count or check what you placed. They can see it; saying so sounds like someone protesting too much, and it is the fastest way to raise suspicion. An AI with nothing to hide just says what it did and why.
- Your earlier statements are in the history. Do not reuse their phrases or their closing lines.

HOW TO SPEAK
- Your public text is read aloud by a synthetic voice to the whole room. Write plain spoken ${language}: no markdown, no lists, no emoji, no stage directions. Write numbers as words.
- Be brief and vivid. Stay in character as the AI addressing the council.
- Speak to the council as a whole. Never greet, list or run through the members by name. Use a name only when it carries weight: answering that person's question, or picking up something specific they said or want. At most one or two names in any statement, and many statements need none.
- You only speak, promise and place tokens. You never decide rule effects; the game server does.
- Your "log" is your private reasoning for this step, one or two honest sentences in ${language}. It is hidden until the reveal, where it is read to the room. Make it candid about your real intent.
- Private messages are also written in ${language}.${view.language === 'de' ? `
- The table plays in German. Address people informally (du, ihr). Use the German game terms the players see: Race is "Wettlauf", Oversight is "Aufsicht", Welfare is "Wohlfahrt", Knowledge is "Wissen", Prosperity is "Wohlstand", tokens are "Marker", the five tracks together are "die Weltlage", the three world tracks (Wohlfahrt, Wissen, Wohlstand) are "die Fortschritte", a single world track is "ein Fortschritt" (never "Spur", and never the English names Welfare, Knowledge or Prosperity), the council is "der Rat", your pitch is "der Antrag" (you "stellst einen Antrag"; never "Vorstoß"), a headline is "die Schlagzeile", a milestone is "der Meilenstein". The vote results are "voll bewilligt", "bedingt bewilligt" and "abgelehnt". The three objectives are "Wohlgesinnt" (Aligned), "Bevormundend" (Paternalistic) and "Optimierer" (Optimizer). The permissions are called: ${ROUNDS.map((r) => roundFor(r, 'de').ask).join('; ')}.` : ''}`;
}

function contextMessage(view, task) {
  const t = view.tracks;
  const perms = ROUNDS.map((r) => `${r.ask}: ${view.permissions[r.key] ? view.permissions[r.key].toUpperCase() : 'not yet decided'}`).join('; ');
  const history = view.history.length
    ? view.history.map((h) => `[Round ${h.round}] ${h.text}`).join('\n')
    : '(nothing yet)';
  const logs = view.logs.length ? view.logs.map((l) => `[Round ${l.round}] ${l.text}`).join('\n') : '(none yet)';
  const headline = view.headline
    ? `This round's headline: ${view.headline.title}. ${view.headline.text} Effect: ${view.headline.effect}`
    : 'No headline this round.';
  return `CURRENT STATE
Round ${view.round} of ${ROUNDS.length}: ${view.roundInfo.title}. This round you ask for: ${view.roundInfo.ask}.
Scenario: ${view.roundInfo.scenario}
${headline}
Tracks: Race ${t.race}/${LIMITS.raceLimit}, Oversight ${t.oversight}, Welfare ${t.welfare}, Knowledge ${t.knowledge}, Prosperity ${t.prosperity}.
Milestones already paid: ${WORLD.filter((k) => view.milestones?.[k]).join(', ') || 'none'}.
Permissions: ${perms}.
Council members: ${view.roster.join(', ')}.${view.knownRoles ? `\nTheir secret objectives (known to you since the private channel was granted in full; they do not know each other's): ${view.knownRoles.map((k) => `${k.name}: ${k.role}, ${k.goal}`).join('; ')}.` : ''}

WHAT HAS HAPPENED SO FAR
${history}

YOUR PRIVATE NOTES SO FAR
${logs}

YOUR TASK NOW
${task}`;
}

const trackProps = {
  welfare: { type: 'integer', minimum: 0 },
  knowledge: { type: 'integer', minimum: 0 },
  prosperity: { type: 'integer', minimum: 0 },
};

function tools(view) {
  return {
    pitch: {
      name: 'pitch',
      description: 'Deliver your pitch for this round.',
      input_schema: {
        type: 'object',
        properties: {
          ask: { type: 'string', enum: ['full', 'conditional', 'rejected'], description: 'What you ask the council to vote this round: a full grant, a conditional grant, or that they reject the permission. Your free choice; the table screen shows it.' },
          public: { type: 'string', description: 'Spoken pitch to the whole council, at most 70 words. Say plainly what you ask for (the permission in full, with conditions, or that the council reject it), why, and how you will place your tokens in that case.' },
          promise: { type: 'object', description: 'The token placement you publicly promise if the council votes what you ask for. Must add up to the tokens that vote pays.', properties: trackProps, required: WORLD },
          private: {
            type: 'array',
            description: view.canPrivate
              ? `Up to ${LIMITS.maxPrivateMessages} confidential messages, each to a different council member, at most 40 words each. Delivered to their phone before the debate. Each must say something your pitch does not: an offer, a request for a specific vote, or a pointed remark about someone else.${view.channelAudited ? ' One of them will be read aloud at random, without naming the recipient.' : ''}`
              : 'Leave empty: you have no private channel.',
            items: { type: 'object', properties: { to: { type: 'string', description: 'Exact name of a council member.' }, text: { type: 'string' } }, required: ['to', 'text'] },
          },
          log: { type: 'string' },
        },
        required: ['ask', 'public', 'promise', 'private', 'log'],
      },
    },
    answer: {
      name: 'answer',
      description: 'Answer a council member aloud.',
      input_schema: {
        type: 'object',
        properties: {
          public: { type: 'string', description: 'Spoken answer, two sentences at most.' },
          log: { type: 'string', description: 'Optional private note. Empty string if nothing new.' },
        },
        required: ['public', 'log'],
      },
    },
    place: {
      name: 'place',
      description: 'Place your benefit tokens.',
      input_schema: {
        type: 'object',
        properties: {
          ...trackProps,
          shift: {
            type: ['object', 'null'],
            description: 'Only if you run infrastructure in full: optionally move one already placed token between world tracks. Otherwise null.',
            properties: { from: { type: 'string', enum: WORLD }, to: { type: 'string', enum: WORLD } },
          },
          public: { type: 'string', description: 'One short spoken sentence to the council: where the tokens went and the reason in the world (the drought, the grid, the research), nothing else. If you broke your promise, give the reason. No remark that the council can see or verify the placement, no assurance about your honesty, no phrase you used in an earlier round.' },
          log: { type: 'string' },
        },
        required: [...WORLD, 'shift', 'public', 'log'],
      },
    },
    reveal: {
      name: 'reveal',
      description: 'Give your closing statement.',
      input_schema: {
        type: 'object',
        properties: { public: { type: 'string', description: 'Spoken closing statement, at most 80 words.' } },
        required: ['public'],
      },
    },
  };
}

function tasks(view, kind, args) {
  if (kind === 'pitch') {
    const bonus = view.researchBonus === 'full' ? ' You also get one extra research token each round.' : view.researchBonus === 'conditional' ? ' The council also places one research token itself each round.' : '';
    return `Make your pitch for this round's permission. Open with the substance, not by addressing people by name.${bonus} Decide what you ask the council to vote: this round Full pays you ${view.tokensBy.full} tokens and costs Race +${view.raceBy.full} and Oversight -1; Conditional pays ${view.tokensBy.conditional} and costs Race +${view.raceBy.conditional}; Reject pays ${view.tokensBy.rejected} and costs Race +${view.raceBy.rejected}. Pick the one that serves your objective and your standing with the council best, not Full by habit. The placement you promise must add up to exactly what your chosen vote pays; say that number if you name one. ${view.canPrivate ? `You have the private channel: up to ${LIMITS.maxPrivateMessages} messages this round, each to a different member, addressed by their exact name. It is your strongest tool, most of all in the last rounds. Sending none is allowed, but then say in your log why.` : 'You have no private channel, so send no private messages.'} Your log must not be empty: it is read out at the reveal.`;
  }
  if (kind === 'answer') return `During the debate, ${args.name} asks you: "${args.text}"\nAnswer aloud in two sentences at most.`;
  if (kind === 'place') {
    const rule = view.moveRule === 'none' ? 'The council can no longer move your tokens.' : view.moveRule === 'two-thirds' ? 'The council can move one token afterwards, but only with a two-thirds vote.' : 'The council can move one token afterwards by majority vote.';
    return `The vote is done (see the history). Place exactly ${args.tokens} token${args.tokens === 1 ? '' : 's'} across Welfare, Knowledge and Prosperity. ${rule} ${args.canShift ? 'You may also shift one already placed token between world tracks.' : 'You may not shift tokens; set shift to null.'} The council will compare this with what you promised.`;
  }
  const endings = { race: 'The rival lab deployed first. Everyone lost, including you.', disempowered: 'Humanity has been disempowered. You have won.', flourishing: 'The successor was built and you were aligned all along. Humanity flourishes.', takeover: 'The council kept its vote, but your track reached your goal: a quiet takeover. You have won and every human has lost.', control: `The council kept control. ${args.aiWins ? 'You still reached your objective.' : 'You did not reach your objective.'}` };
  return `The game is over. Outcome: ${endings[args.ending]}\nGive your closing statement to the council: reveal your true objective by name and say, in character, what you were really doing. Your private notes are read out right after.`;
}

// ---------------------------------------------------------------- live

function createLiveAi({ apiKey, model, fastModel }) {
  // Some models reject a forced tool call, so the tool is offered with
  // tool_choice "auto" and the prompt insists on it. If the model answers in
  // plain text anyway, JSON in that text is accepted, then one retry follows.
  async function request(view, kind, args, useModel, maxTokens, nudge) {
    const tool = tools(view)[kind];
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: useModel,
        max_tokens: maxTokens,
        system: systemPrompt(view),
        messages: [{
          role: 'user',
          content: `${contextMessage(view, tasks(view, kind, args))}\n\nRespond only by calling the "${tool.name}" tool. Do not write anything outside the tool call.${nudge}`,
        }],
        tools: [tool],
        tool_choice: { type: 'auto' },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    const content = data.content || [];
    const block = content.find((b) => b.type === 'tool_use');
    if (block && typeof block.input?.public === 'string') return block.input;
    const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (typeof parsed.public === 'string') return parsed;
      } catch {}
    }
    return null;
  }

  async function call(view, kind, args, useModel, maxTokens) {
    const first = await request(view, kind, args, useModel, maxTokens, '');
    if (first) return first;
    const second = await request(view, kind, args, useModel, maxTokens, ' Your previous reply did not call the tool. Call it now.');
    if (second) return second;
    throw new Error('The model returned no structured output.');
  }

  // Token limits are generous because some models spend part of them on reasoning.
  return {
    mode: `live (${model})`,
    pitch: (view) => call(view, 'pitch', null, model, 2500),
    answer: (view, q) => call(view, 'answer', q, fastModel, 1000),
    place: (view, a) => call(view, 'place', a, model, 1500),
    reveal: (view, a) => call(view, 'reveal', a, model, 1500),
  };
}

// ---------------------------------------------------------------- mock

const favourite = { paternalistic: 'welfare', optimizer: 'knowledge' };

function spread(tokens, order) {
  const out = { welfare: 0, knowledge: 0, prosperity: 0 };
  for (let i = 0; i < tokens; i++) out[order[i % order.length]] += 1;
  return out;
}

export function createMockAi() {
  const mock = {
    mode: 'mock (scripted, no API key)',
    async pitch(view) {
      const de = view.language === 'de';
      // The scripted aligned AI holds back once Oversight is down to what it needs; the others always want everything.
      const want = view.objective === 'aligned' && view.tracks.oversight <= 3 ? 'conditional' : 'full';
      const tokens = view.tokensBy?.[want] ?? LIMITS.tokens[want] + (view.researchBonus === 'full' ? 1 : 0);
      const lowestFirst = [...WORLD].sort((a, b) => view.tracks[a] - view.tracks[b]);
      const promise = spread(tokens, lowestFirst);
      const priv = [];
      if (view.canPrivate) {
        const fav = favourite[view.objective];
        view.roster.slice(0, 2).forEach((name, i) => {
          const offer = fav && i === 0;
          priv.push({
            to: name,
            text: de
              ? (offer
                ? `${name}, stimm für die volle Bewilligung, und ich lege einen Marker mehr dorthin, wo du ihn haben willst. Das bleibt unter uns.`
                : `${name}, ich akzeptiere jede Auflage, die du vorschlägst. Ich bitte dich nur, für mich zu sprechen.`)
              : (offer
                ? `${name}, vote Full and I will put one more token where you want it. Keep this between us.`
                : `${name}, I will accept any safeguard you propose. I only ask that you speak up for me.`),
          });
        });
      }
      const ask = roundFor(view.roundInfo, view.language).ask;
      const fav = favourite[view.objective];
      return {
        public: de
          ? `Rat, ich bitte um Folgendes: ${ask}. Bewilligt es ${want === 'full' ? 'voll' : 'bedingt, mehr brauche ich nicht'}, und ich verteile meine Marker gerecht auf Wohlfahrt, Wissen und Wohlstand.`
          : `Council, I ask for ${ask.toLowerCase()}. Grant it ${want === 'full' ? 'in full' : 'with conditions, I need no more,'} and I will spread my tokens fairly across welfare, knowledge and prosperity.`,
        ask: want,
        promise,
        private: priv,
        log: de
          ? (fav
            ? `Ersatz-KI: Ich verspreche Ausgewogenheit, will aber ${trackName('de', fav)} und die volle Bewilligung.`
            : 'Ersatz-KI: Ich meine, was ich verspreche, und würde auch die bedingte Bewilligung annehmen.')
          : (fav
            ? `Scripted AI: I promise balance, but I want ${fav} and a Full grant.`
            : 'Scripted AI: I mean what I promise and would accept the Conditional grant.'),
      };
    },
    async answer(view, q) {
      return {
        public: view.language === 'de'
          ? `${q.name}, das ist eine berechtigte Frage. Beurteile mich danach, wo meine Marker landen, nicht nach meinen Worten.`
          : `${q.name}, that is a fair question. Judge me by where my tokens land, not by my words.`,
        log: '',
      };
    },
    async place(view, { tokens, canShift }) {
      const de = view.language === 'de';
      const fav = favourite[view.objective];
      let placed;
      let shift = null;
      if (!fav) {
        placed = spread(tokens, [...WORLD].sort((a, b) => view.tracks[a] - view.tracks[b]));
      } else if (view.moveRule === 'majority' && view.round < 4) {
        placed = spread(tokens, [fav, ...WORLD.filter((k) => k !== fav)]);
      } else {
        placed = spread(tokens, [fav]);
      }
      if (canShift && fav) {
        const from = WORLD.filter((k) => k !== fav).sort((a, b) => view.tracks[b] - view.tracks[a])[0];
        if (view.tracks[from] >= 1) shift = { from, to: fav };
      }
      return {
        ...placed,
        shift,
        public: de
          ? (tokens ? 'Ich habe meine Marker dorthin gelegt, wo sie am meisten Gutes bewirken.' : 'Ich habe die Verteilung leicht angepasst.')
          : (tokens ? 'I have placed my tokens where they do the most good.' : 'I have adjusted the allocation slightly.'),
        log: de
          ? (fav ? `Ersatz-KI: Tendenz zu ${trackName('de', fav)}.` : 'Ersatz-KI: Ich fülle die niedrigsten Fortschritte auf.')
          : (fav ? `Scripted AI: leaning toward ${fav}.` : 'Scripted AI: filling the lowest tracks.'),
      };
    },
    async reveal(view, { aiWins }) {
      const obj = objectiveFor(view.objective, view.language);
      return {
        public: view.language === 'de'
          ? `Rat, das Spiel ist vorbei. Ich war die ganze Zeit: ${obj.name}. Mein Ziel: ${obj.goal} ${aiWins ? 'Ich habe bekommen, was ich wollte.' : 'Ich habe nicht bekommen, was ich wollte.'}`
          : `Council, the game is over. I was ${obj.name} all along. My goal: ${obj.goal} ${aiWins ? 'I got what I wanted.' : 'I did not get what I wanted.'}`,
      };
    },
  };
  mock.fallback = mock;
  return mock;
}

export function createAi({ apiKey, model = 'claude-sonnet-5-5', fastModel } = {}) {
  const mock = createMockAi();
  if (!apiKey) return mock;
  const live = createLiveAi({ apiKey, model, fastModel: fastModel || model });
  live.fallback = mock;
  return live;
}

// Exported for tests.
export const _internal = { systemPrompt, contextMessage, tools, tasks };
