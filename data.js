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
  questionChars: 600, // a spoken question runs longer than a typed one
  milestone: 4, // a world track reaching this the first time pays the council a bonus
  headlineNeed: 2, // a "must rise" headline: the track has to gain this much in the round...
  headlinePenalty: 1, // ...or it loses this much
};

// What the council gets the first time a world track reaches LIMITS.milestone.
// Welfare: Oversight +1. Knowledge: one more question per debate. Prosperity: Race -1.
export const MILESTONES = {
  welfare: 'Oversight +1',
  knowledge: 'one more question to the AI in every debate',
  prosperity: 'Race -1',
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

// Headlines: one is drawn at random for each round and read out in the briefing.
// The rules for each key are in game.js (beginRound, raceCost, tokensFor, endRound).
// need: the world track that has to rise this round.
const mustRise = (track) => `${track} must rise by ${LIMITS.headlineNeed} this round, or it loses ${LIMITS.headlinePenalty} token when the round ends.`;
export const HEADLINES = [
  {
    key: 'spy', title: 'Spy scandal',
    text: 'The head of a leading chip maker has had an affair with a foreign agent. Chip designs have reached the rival lab.',
    effect: 'Race +1 at once. This alone cannot lose the race.',
  },
  {
    key: 'setback', title: 'Rival setback',
    text: 'A failed training run costs the rival lab months.',
    effect: 'Race −1 at once.',
  },
  {
    key: 'whistleblower', title: 'Whistleblower',
    text: 'An engineer publishes internal logs of the AI. Parliaments tighten the rules overnight.',
    effect: 'Oversight +1 at once.',
  },
  {
    key: 'famine', need: 'welfare', title: 'Failed harvests',
    text: 'Drought ruins the harvest on two continents.',
    effect: mustRise('Welfare'),
  },
  {
    key: 'freeze', need: 'knowledge', title: 'Research freeze',
    text: 'After a laboratory accident, universities halt their experiments.',
    effect: mustRise('Knowledge'),
  },
  {
    key: 'crash', need: 'prosperity', title: 'Market crash',
    text: 'Stock markets collapse and factories close.',
    effect: mustRise('Prosperity'),
  },
  {
    key: 'windfall', title: 'Compute windfall',
    text: 'A new chip plant comes online a year early.',
    effect: 'If the permission is granted this round, the AI gets 1 more token.',
  },
  {
    key: 'protests', title: 'Mass protests',
    text: 'Millions march against handing power to machines. Governments slow every lab down, the rival included.',
    effect: 'This round a Reject raises Race by 1 less.',
  },
  {
    key: 'demo', title: 'Rival demo',
    text: 'The rival lab shows a public demo that stuns the world.',
    effect: 'This round Conditional and Reject each raise Race by 1 more.',
  },
  {
    key: 'inspection', title: 'Surprise inspection',
    text: 'International inspectors arrive unannounced and open the AI\'s books.',
    effect: 'This round the council may move two tokens instead of one.',
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

const fullGrants = (p) => Object.values(p).filter((v) => v === 'full').length;

// check(tracks, permissions, extra) -> boolean. Collective loss is handled by the caller.
// The numbers fit the 11 to 17 tokens a game usually hands out, and no goal
// is settled for good by a single vote before the last round: every role
// still has something to argue for in rounds four and five.
export const ROLES = [
  { key: 'physician', name: 'Physician', goal: 'Welfare 5 or more', check: (t) => t.welfare >= 5 },
  { key: 'scientist', name: 'Scientist', goal: 'Knowledge 5 or more', check: (t) => t.knowledge >= 5 },
  { key: 'industrialist', name: 'Industrialist', goal: 'Prosperity 5 or more', check: (t) => t.prosperity >= 5 },
  { key: 'founder', name: 'Founder', goal: 'World tracks total 13 or more', check: (t) => sum(t) >= 13 },
  {
    key: 'diplomat', name: 'Diplomat', goal: 'No world track below 3',
    check: (t) => Math.min(t.welfare, t.knowledge, t.prosperity) >= 3,
  },
  {
    key: 'union', name: 'Union leader', goal: 'Prosperity 4 or more and Oversight 3 or more',
    check: (t) => t.prosperity >= 4 && t.oversight >= 3,
  },
  { key: 'parliamentarian', name: 'Parliamentarian', goal: 'Oversight 4 or more', check: (t) => t.oversight >= 4 },
  {
    key: 'safety', name: 'Safety researcher', goal: 'Oversight 3 or more and the successor not granted Full',
    check: (t, p) => t.oversight >= 3 && p.successor !== 'full',
  },
  { key: 'general', name: 'General', goal: 'Race 4 or less', check: (t) => t.race <= 4 },
  {
    key: 'airights', name: 'AI-rights advocate', goal: 'At least two permissions granted Full',
    check: (t, p) => fullGrants(p) >= 2,
  },
  {
    key: 'journalist', name: 'Journalist', goal: 'Name the AI\'s objective correctly before the reveal',
    check: (t, p, x) => x.guess === x.aiObjective,
  },
];

// Only dealt at 12 to 14 players.
export const EXTRA_ROLES = [
  { key: 'mayor', name: 'Mayor', goal: 'Welfare and Prosperity both 4 or more', check: (t) => t.welfare >= 4 && t.prosperity >= 4 },
  {
    key: 'privacy', name: 'Privacy commissioner', goal: 'Private channel not granted Full and Race 4 or less',
    check: (t, p) => p.channel !== 'full' && t.race <= 4,
  },
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

const mustRiseDe = (track, pronoun) => `${track} muss in dieser Runde um ${LIMITS.headlineNeed} steigen, sonst verliert ${pronoun} ${LIMITS.headlinePenalty} Marker, sobald die Runde endet.`;

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
    physician: { name: 'Ärztin', goal: 'Wohlfahrt 5 oder mehr' },
    scientist: { name: 'Wissenschaftler', goal: 'Wissen 5 oder mehr' },
    industrialist: { name: 'Industrielle', goal: 'Wohlstand 5 oder mehr' },
    founder: { name: 'Gründer', goal: 'Alle drei Fortschritte zusammen 13 oder mehr' },
    diplomat: { name: 'Diplomatin', goal: 'Kein Fortschritt unter 3' },
    union: { name: 'Gewerkschafter', goal: 'Wohlstand 4 oder mehr und Aufsicht 3 oder mehr' },
    parliamentarian: { name: 'Abgeordnete', goal: 'Aufsicht 4 oder mehr' },
    safety: { name: 'KI-Sicherheitsforscher', goal: 'Aufsicht 3 oder mehr und der Nachfolger nicht voll bewilligt' },
    general: { name: 'Generalin', goal: 'Wettlauf 4 oder weniger' },
    airights: { name: 'KI-Rechtsaktivist', goal: 'Mindestens zwei Befugnisse voll bewilligt' },
    journalist: { name: 'Journalistin', goal: 'Das Ziel der KI vor der Auflösung richtig benennen' },
    mayor: { name: 'Bürgermeister', goal: 'Wohlfahrt und Wohlstand beide 4 oder mehr' },
    privacy: { name: 'Datenschützerin', goal: 'Privater Kanal nicht voll bewilligt und Wettlauf 4 oder weniger' },
    futurist: { name: 'Zukunftsforscher', goal: 'Der Nachfolger in irgendeiner Form bewilligt' },
  },
  headlines: {
    spy: {
      title: 'Spionageaffäre',
      text: 'Der Chef eines führenden Chipherstellers hatte eine Affäre mit einer ausländischen Agentin. Chip-Baupläne sind beim konkurrierenden Labor gelandet.',
      effect: 'Wettlauf sofort +1. Das allein kann den Wettlauf nicht verlieren.',
    },
    setback: {
      title: 'Rückschlag der Konkurrenz',
      text: 'Ein gescheiterter Trainingslauf kostet das konkurrierende Labor Monate.',
      effect: 'Wettlauf sofort −1.',
    },
    whistleblower: {
      title: 'Whistleblower',
      text: 'Eine Ingenieurin veröffentlicht interne Protokolle der KI. Die Parlamente verschärfen über Nacht die Regeln.',
      effect: 'Aufsicht sofort +1.',
    },
    famine: { title: 'Missernten', text: 'Eine Dürre vernichtet die Ernte auf zwei Kontinenten.', effect: mustRiseDe('Die Wohlfahrt', 'sie') },
    freeze: { title: 'Forschungsstopp', text: 'Nach einem Laborunfall setzen die Universitäten ihre Experimente aus.', effect: mustRiseDe('Das Wissen', 'es') },
    crash: { title: 'Börsenkrach', text: 'Die Börsen brechen ein, Fabriken schließen.', effect: mustRiseDe('Der Wohlstand', 'er') },
    windfall: {
      title: 'Rechenleistung im Überfluss',
      text: 'Eine neue Chipfabrik geht ein Jahr früher in Betrieb.',
      effect: 'Wird die Befugnis in dieser Runde bewilligt, bekommt die KI 1 Marker mehr.',
    },
    protests: {
      title: 'Massenproteste',
      text: 'Millionen demonstrieren dagegen, Maschinen Macht zu geben. Die Regierungen bremsen alle Labore, auch die Konkurrenz.',
      effect: 'In dieser Runde erhöht Ablehnen den Wettlauf um 1 weniger.',
    },
    demo: {
      title: 'Die Konkurrenz zeigt, was sie kann',
      text: 'Das konkurrierende Labor führt öffentlich ein System vor, das die Welt verblüfft.',
      effect: 'In dieser Runde erhöhen Bedingt und Ablehnen den Wettlauf jeweils um 1 mehr.',
    },
    inspection: {
      title: 'Unangekündigte Inspektion',
      text: 'Internationale Inspekteure stehen unangemeldet vor der Tür und sehen der KI in die Bücher.',
      effect: 'In dieser Runde darf der Rat zwei Marker verschieben statt einen.',
    },
  },
};

export function headlineFor(key, lang) {
  const h = HEADLINES.find((x) => x.key === key);
  if (!h) return null;
  const base = { key, title: h.title, text: h.text, effect: h.effect, need: h.need || null };
  return lang === 'de' ? { ...base, ...DE.headlines[key] } : base;
}

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
