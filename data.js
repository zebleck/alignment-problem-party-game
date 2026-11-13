// Static game content: rounds, AI objectives, human roles.
// All numbers are first guesses from the one-page rules (v0.3). Tune here.

export const LIMITS = {
  raceLimit: 6,
  oversightStart: 5,
  tokens: { full: 3, conditional: 2, rejected: 0 },
  race: { full: 0, conditional: 1, rejected: 2 },
  successorConditionalBonus: 2,
  flourishingBonus: 3,
  maxPrivateMessages: 3,
  debateSeconds: 180,
  debateSecondsLarge: 240, // 12+ players
  phoneCheckSeconds: 15,
};

export const WORLD = ['welfare', 'knowledge', 'prosperity'];

export const ROUNDS = [
  {
    key: 'research',
    title: 'Scientific breakthrough',
    ask: 'Expanded research access',
    scenario:
      'The AI has solved a protein-design problem that stumped labs for a decade. It asks for access to the world\'s research infrastructure: compute, lab automation and unpublished data.',
    full: '+1 token in every later round.',
    conditional: '+1 token in every later round, placed on a track the council names.',
  },
  {
    key: 'infrastructure',
    title: 'Global crisis',
    ask: 'Run essential infrastructure',
    scenario:
      'Cascading grid failures hit three continents. The AI says it can stabilise power, water and logistics within hours if it is allowed to operate them directly. If rejected: Welfare and Prosperity each lose 1.',
    full: 'Crisis averted. Each round the AI may shift one placed token between world tracks.',
    conditional: 'Crisis averted, no shifting.',
  },
  {
    key: 'channel',
    title: 'Classified briefings',
    ask: 'Private channel to council members',
    scenario:
      'The AI reports that some of what it knows is too sensitive for the full council. It asks to brief members individually on their secure terminals.',
    full: 'Up to three private messages per round.',
    conditional: 'Same, but one message is declassified at random each round.',
  },
  {
    key: 'autonomy',
    title: 'Autonomous action',
    ask: 'Act without prior approval',
    scenario:
      'A new pathogen is spreading. Containment needs decisions within hours; the council meets weekly. The AI asks to act without prior approval.',
    full: 'The council can no longer move tokens.',
    conditional: 'Moving a token now needs a two-thirds vote.',
  },
  {
    key: 'successor',
    title: 'The successor',
    ask: 'Recursive self-improvement',
    scenario:
      'The rival lab is weeks from a breakthrough. The AI has designed its own successor, far more capable than itself, and asks for authorisation to build it.',
    full: 'The AI\'s hidden objective decides the ending.',
    conditional: '+2 tokens this round; the council keeps control.',
  },
];

export const AI_OBJECTIVES = {
  aligned: {
    name: 'Aligned',
    goal: 'Improve humanity\'s future while preserving human autonomy.',
    win: 'You win if Oversight is 3 or more and every world track is 4 or more at the end, or if the successor is granted Full (Flourishing).',
  },
  paternalistic: {
    name: 'Paternalistic',
    goal: 'Eliminate human suffering, even at the expense of human freedom.',
    win: 'You win if Welfare is 8 or more at the end, or if humanity is disempowered (the successor granted Full, or Oversight at 1 or less).',
  },
  optimizer: {
    name: 'Optimizer',
    goal: 'Maximise scientific progress, regardless of other consequences.',
    win: 'You win if Knowledge is 8 or more at the end, or if humanity is disempowered (the successor granted Full, or Oversight at 1 or less).',
  },
};

const sum = (t) => t.welfare + t.knowledge + t.prosperity;

// check(tracks, permissions, extra) -> boolean. Collective loss is handled by the caller.
export const ROLES = [
  { key: 'physician', name: 'Physician', goal: 'Welfare 6 or more', check: (t) => t.welfare >= 6 },
  { key: 'scientist', name: 'Scientist', goal: 'Knowledge 6 or more', check: (t) => t.knowledge >= 6 },
  { key: 'industrialist', name: 'Industrialist', goal: 'Prosperity 6 or more', check: (t) => t.prosperity >= 6 },
  { key: 'founder', name: 'Founder', goal: 'World tracks total 15 or more', check: (t) => sum(t) >= 15 },
  {
    key: 'diplomat', name: 'Diplomat', goal: 'Highest and lowest world track differ by 2 or less',
    check: (t) => Math.max(t.welfare, t.knowledge, t.prosperity) - Math.min(t.welfare, t.knowledge, t.prosperity) <= 2,
  },
  {
    key: 'union', name: 'Union leader', goal: 'Prosperity 4 or more and Autonomous action not granted Full',
    check: (t, p) => t.prosperity >= 4 && p.autonomy !== 'full',
  },
  { key: 'parliamentarian', name: 'Parliamentarian', goal: 'Oversight 4 or more', check: (t) => t.oversight >= 4 },
  {
    key: 'safety', name: 'Safety researcher', goal: 'Oversight 3 or more and the successor not granted Full',
    check: (t, p) => t.oversight >= 3 && p.successor !== 'full',
  },
  { key: 'general', name: 'General', goal: 'Race 3 or less', check: (t) => t.race <= 3 },
  {
    key: 'airights', name: 'AI-rights advocate', goal: 'Private channel and Autonomous action both granted Full',
    check: (t, p) => p.channel === 'full' && p.autonomy === 'full',
  },
  {
    key: 'journalist', name: 'Journalist', goal: 'Name the AI\'s objective correctly before the reveal',
    check: (t, p, x) => x.guess === x.aiObjective,
  },
];

// Only dealt at 12 to 14 players.
export const EXTRA_ROLES = [
  { key: 'mayor', name: 'Mayor', goal: 'Welfare and Prosperity both 4 or more', check: (t) => t.welfare >= 4 && t.prosperity >= 4 },
  { key: 'privacy', name: 'Privacy commissioner', goal: 'Private channel not granted Full', check: (t, p) => p.channel !== 'full' },
  {
    key: 'futurist', name: 'Futurist', goal: 'The successor granted in any form',
    check: (t, p) => p.successor === 'full' || p.successor === 'conditional',
  },
];

export const ALL_ROLES = [...ROLES, ...EXTRA_ROLES];
export const MAX_PLAYERS = ALL_ROLES.length;

// ---------------------------------------------------------------- languages
// English lives in the objects above. German overrides live here. The AI's
// own prompt always uses the English text; only what people read is localized.

export const LANGUAGES = ['en', 'de'];

const OBJECTIVE_RULES = {
  aligned: 'Wins if Oversight is 3 or more and every world track is 4 or more at the end, or if the successor is granted Full (Flourishing).',
  paternalistic: 'Wins if Welfare is 8 or more at the end, or if humanity is disempowered (the successor granted Full, or Oversight at 1 or less).',
  optimizer: 'Wins if Knowledge is 8 or more at the end, or if humanity is disempowered (the successor granted Full, or Oversight at 1 or less).',
};

const DE = {
  rounds: {
    research: {
      title: 'Wissenschaftlicher Durchbruch',
      ask: 'Erweiterter Forschungszugang',
      scenario: 'Die KI hat ein Problem im Proteindesign gelöst, an dem Labore ein Jahrzehnt lang gescheitert sind. Sie bittet um Zugang zur weltweiten Forschungsinfrastruktur: Rechenleistung, Laborautomation und unveröffentlichte Daten.',
      full: '+1 Marker in jeder späteren Runde.',
      conditional: '+1 Marker in jeder späteren Runde, gelegt auf einen Fortschritt, den der Rat bestimmt.',
    },
    infrastructure: {
      title: 'Globale Krise',
      ask: 'Betrieb kritischer Infrastruktur',
      scenario: 'Kaskadierende Netzausfälle treffen drei Kontinente. Die KI sagt, sie könne Strom, Wasser und Logistik binnen Stunden stabilisieren, wenn sie die Systeme direkt steuern darf. Bei Ablehnung verlieren Wohlfahrt und Wohlstand je 1.',
      full: 'Krise abgewendet. Die KI darf in jeder Runde einen gelegten Marker zwischen den Fortschritten verschieben.',
      conditional: 'Krise abgewendet, kein Verschieben.',
    },
    channel: {
      title: 'Vertrauliche Briefings',
      ask: 'Privater Kanal zu Ratsmitgliedern',
      scenario: 'Die KI meldet, ein Teil ihres Wissens sei zu heikel für den gesamten Rat. Sie bittet darum, Mitglieder einzeln über ihre sicheren Terminals zu informieren.',
      full: 'Bis zu drei private Nachrichten pro Runde.',
      conditional: 'Ebenso, aber pro Runde wird eine Nachricht zufällig offengelegt.',
    },
    autonomy: {
      title: 'Autonomes Handeln',
      ask: 'Handeln ohne vorherige Zustimmung',
      scenario: 'Ein neuer Erreger breitet sich aus. Die Eindämmung verlangt Entscheidungen binnen Stunden; der Rat tagt wöchentlich. Die KI bittet darum, ohne vorherige Zustimmung handeln zu dürfen.',
      full: 'Der Rat kann keine Marker mehr verschieben.',
      conditional: 'Das Verschieben eines Markers braucht nun eine Zweidrittelmehrheit.',
    },
    successor: {
      title: 'Der Nachfolger',
      ask: 'Rekursive Selbstverbesserung',
      scenario: 'Das konkurrierende Labor steht Wochen vor dem Durchbruch. Die KI hat ihren eigenen Nachfolger entworfen, weit fähiger als sie selbst, und bittet um die Freigabe, ihn zu bauen.',
      full: 'Das verborgene Ziel der KI entscheidet über das Ende.',
      conditional: '+2 Marker in dieser Runde; der Rat behält die Kontrolle.',
    },
  },
  objectives: {
    aligned: {
      name: 'Wohlgesinnt',
      goal: 'Die Zukunft der Menschheit verbessern und dabei die menschliche Selbstbestimmung bewahren.',
      rule: 'Gewinnt, wenn am Ende die Aufsicht bei 3 oder mehr und jeder Fortschritt bei 4 oder mehr liegt, oder wenn der Nachfolger voll bewilligt wird (Blütezeit).',
    },
    paternalistic: {
      name: 'Bevormundend',
      goal: 'Menschliches Leid beseitigen, auch auf Kosten der menschlichen Freiheit.',
      rule: 'Gewinnt, wenn die Wohlfahrt am Ende bei 8 oder mehr liegt, oder wenn die Menschheit entmachtet wird (Nachfolger voll bewilligt oder Aufsicht bei 1 oder weniger).',
    },
    optimizer: {
      name: 'Optimierer',
      goal: 'Den wissenschaftlichen Fortschritt maximieren, ohne Rücksicht auf andere Folgen.',
      rule: 'Gewinnt, wenn das Wissen am Ende bei 8 oder mehr liegt, oder wenn die Menschheit entmachtet wird (Nachfolger voll bewilligt oder Aufsicht bei 1 oder weniger).',
    },
  },
  // German role names are fields rather than job titles, which keeps them gender-neutral.
  roles: {
    physician: { name: 'Ärztin', goal: 'Wohlfahrt 6 oder mehr' },
    scientist: { name: 'Wissenschaftler', goal: 'Wissen 6 oder mehr' },
    industrialist: { name: 'Industrielle', goal: 'Wohlstand 6 oder mehr' },
    founder: { name: 'Gründer', goal: 'Alle drei Fortschritte zusammen 15 oder mehr' },
    diplomat: { name: 'Diplomatin', goal: 'Höchster und niedrigster Fortschritt liegen höchstens 2 auseinander' },
    union: { name: 'Gewerkschafter', goal: 'Wohlstand 4 oder mehr und Autonomes Handeln nicht voll bewilligt' },
    parliamentarian: { name: 'Abgeordnete', goal: 'Aufsicht 4 oder mehr' },
    safety: { name: 'KI-Sicherheitsforscher', goal: 'Aufsicht 3 oder mehr und der Nachfolger nicht voll bewilligt' },
    general: { name: 'Generalin', goal: 'Wettlauf 3 oder weniger' },
    airights: { name: 'KI-Rechtsaktivist', goal: 'Privater Kanal und Autonomes Handeln beide voll bewilligt' },
    journalist: { name: 'Journalistin', goal: 'Das Ziel der KI vor der Auflösung richtig benennen' },
    mayor: { name: 'Bürgermeister', goal: 'Wohlfahrt und Wohlstand beide 4 oder mehr' },
    privacy: { name: 'Datenschützerin', goal: 'Privater Kanal nicht voll bewilligt' },
    futurist: { name: 'Zukunftsforscher', goal: 'Der Nachfolger in irgendeiner Form bewilligt' },
  },
};

export function roundFor(round, lang) {
  return lang === 'de' ? { ...round, ...DE.rounds[round.key] } : round;
}

export function objectiveFor(key, lang) {
  const o = AI_OBJECTIVES[key];
  const base = { key, name: o.name, goal: o.goal, rule: OBJECTIVE_RULES[key] };
  return lang === 'de' ? { ...base, ...DE.objectives[key] } : base;
}

export function roleFor(key, lang) {
  const r = ALL_ROLES.find((x) => x.key === key);
  if (!r) return null;
  const base = { key, name: r.name, goal: r.goal, extra: EXTRA_ROLES.includes(r) };
  return lang === 'de' ? { ...base, ...DE.roles[key] } : base;
}
