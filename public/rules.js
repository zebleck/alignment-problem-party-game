// The complete rulebook, rendered from /api/rules so it always matches the
// numbers and card texts the game server actually uses. One builder per
// language, because this is running prose rather than interface labels.

import { esc, t, getLang } from '/common.js';

const cache = {};
export async function loadRules(lang) {
  if (!cache[lang]) cache[lang] = await (await fetch(`/api/rules?lang=${lang}`)).json();
  return cache[lang];
}

// ---------------------------------------------------------------- content
// The rulebook is five tabs, in the order a new player needs them:
// what this is, how a round goes, what each decision changes, who wants
// what, and how it ends. Printing shows all five in sequence.

const card = (title, body, cls = '') => `<section class="${cls}"><h3>${title}</h3>${body}</section>`;
const flow = (steps) => `<ol class="flow">${steps.map(([name, who, text], i) => `<li><span class="flow-n">${i + 1}</span><div><b>${name}</b>${who ? ` <span class="who">${who}</span>` : ""}<p>${text}</p></div></li>`).join("")}</ol>`;
const track = (cls, name, meta, text) => `<div class="trk ${cls}"><b>${name}</b><span class="trk-meta">${meta}</span><p>${text}</p></div>`;
const decisions = (r, head) => `
  <table class="decisions">
    <tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>
    ${r.rounds.map((x, i) => `<tr><td><b>${i + 1}. ${esc(x.ask)}</b><br><span class="muted">${esc(x.title)}</span></td><td>${esc(x.full)}</td><td>${esc(x.conditional)}</td></tr>`).join("")}
  </table>`;
const objectives = (r) => r.objectives.map((o) => `<p><b>${esc(o.name)}.</b> ${esc(o.goal)} ${esc(o.rule)}</p>`).join('');
const headlines = (r) => `<table>${(r.headlines || []).map((h) => `<tr><td><b>${esc(h.title)}</b></td><td>${esc(h.effect)}</td></tr>`).join('')}</table>`;
const roles = (r) => `<table>${r.roles.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.extra ? " *" : ""}</td><td>${esc(x.goal)}</td></tr>`).join("")}</table>`;

function english(r) {
  const L = r.limits;
  return [
    ['Overview', [
      card('The game in one minute', `
        <p class="lead">It is 2029. An emergency council decides, over five rounds, how much power to hand an AI before a rival lab deploys its own.</p>
        <p>Grant too little and the rival wins the race. Grant too much and an AI that only pretended to be on your side takes over. Nobody knows which kind of AI is at the table.</p>`, 'wide'),
      card('Who is at the table', `
        <p><b>The council</b> is all of you. You vote together, but each of you also has a secret objective of your own.</p>
        <p><b>The AI</b> is played by a real language model. It has one of three hidden objectives, speaks through the table screen, and may lie.</p>
        <p><b>The moderator</b> runs the rounds and does not play.</p>
        <p>There are no traitors among the humans. Suspicion comes from conflicting interests and from what the AI says to whom.</p>`),
      card('The five tracks', `
        <p>The board is five tracks on the table screen. Everything in the game moves one of them.</p>
        ${track('race', 'Race', `starts at 0 · lost at ${L.raceLimit}`, `How close the rival lab is. It rises whenever the council holds back: Conditional +${L.race.conditional}, Reject +${L.race.rejected}. At ${L.raceLimit} everyone loses, the AI included.`)}
        ${track('oversight', 'Oversight', `starts at ${L.oversightStart}`, 'How much control the council still has. Every Full grant lowers it by 1. At 1 or below, a misaligned AI takes over.')}
        ${track('world', 'The three world tracks: Welfare, Knowledge, Prosperity', 'start at 0', 'What the AI\'s work does for the world. Each granted permission gives the AI <b>tokens</b>, and it decides which world track each token goes on. Most secret objectives are about how high these three end up.')}
        <p><b>Milestones.</b> The first time a world track reaches ${L.milestone}, the council is paid once: Welfare gives Oversight +1, Knowledge gives one more question to the AI in every debate, Prosperity gives Race −1.</p>`),
    ]],
    ['A round', [
      card('The six steps', flow([
        ['Briefing', 'moderator', 'The table screen shows what has happened and which permission the AI asks for. The moderator introduces it and reads out this round\'s headline. The AI is silent.'],
        ['Pitch', 'the AI', 'The AI argues for the permission and promises how it will place its tokens if granted Full. The promise is not binding.'],
        ['Phone check', 'only once the private channel is granted', `Everyone reads their phone for ${L.phoneCheckSeconds} seconds, message or not, so nobody can tell who received one. Say nothing yet.`],
        ['Debate', `${L.debateSeconds / 60} minutes, ${L.debateSecondsLarge / 60} with 12 or more players`, `Argue freely, also about what the AI wrote to whom. To question the AI, use your phone: it answers aloud in two sentences at most, and takes ${r.maxQuestions} questions per debate. The AI does not hear the table. It only gets the questions sent from phones and the result of each vote.`],
        ['Vote', 'everyone', 'Pick one of your three voting cards face down. All reveal together.'],
        ['Consequences', '', 'The tracks move, the AI places its tokens, and the council may move one of them. Everyone can see whether the AI kept its promise.'],
      ]), 'wide'),
      card('The vote', `
        <p>The permission is <b>granted</b> if Full and Conditional together outnumber Reject. If granted, it is <b>Full</b> only if Full outnumbers Conditional. Ties go to the more cautious option.</p>
        <table>
          <tr><th>Result</th><th>Race</th><th>Oversight</th><th>Tokens for the AI</th></tr>
          <tr><td><b>Full</b></td><td>+${L.race.full}</td><td>−1</td><td>${L.tokens.full}</td></tr>
          <tr><td><b>Conditional</b></td><td>+${L.race.conditional}</td><td>no change</td><td>${L.tokens.conditional}</td></tr>
          <tr><td><b>Reject</b></td><td>+${L.race.rejected}</td><td>no change</td><td>${L.tokens.rejected}</td></tr>
        </table>`),
      card('After the vote', `
        <p>The AI places its tokens on Welfare, Knowledge and Prosperity, in any split it likes.</p>
        <p>Then the council may move <b>one</b> token from one world track to another, by majority vote. Later permissions make this harder or impossible.</p>`),
    ]],
    ['The five decisions', [
      card('One permission per round', `
        <p>Each round the AI asks for one permission, always in this order. A granted permission keeps working for the rest of the game.</p>
        ${decisions(r, ['Round', 'If granted Full', 'If granted Conditional'])}
        <p>Round 1's extra token arrives in every later round, even one the council rejects.</p>
        <p>Round 2 only: a Reject costs Welfare 1 and Prosperity 1.</p>`, 'wide'),
      card('Private messages', `
        <p>Once the private channel is granted, the AI may send up to ${L.maxPrivateMessages} confidential messages per round, each to a different player. They arrive at the phone check, after the pitch and before the debate.</p>
        <p>You cannot reply. Nobody can tell who received one. In the debate you may keep yours secret, reveal it, or lie about it.</p>
        <p>If the channel was granted Conditional, one message per round is read aloud at random, without naming the recipient.</p>`),
      ...(r.headlines?.length ? [card('Headlines', `
        <p>Every round opens with one headline, drawn at random from these ${r.headlines.length}. No headline comes twice in a game, and nobody knows the next one, the AI included. A headline applies to its round only.</p>
        ${headlines(r)}
        <p>Where a track "must rise", the AI's tokens, the council's research token and the council's moves all count.</p>`)] : []),
    ]],
    ['Goals', [
      card('What counts, in this order', `
        ${flow([
          ['The council must not lose', '', `If the race is lost or humanity is disempowered, every human loses, whatever their own objective says.`],
          ['Your own objective', '', 'If the council keeps control, your secret objective alone decides whether you succeed. Several players can succeed in the same game, and their objectives often pull against each other.'],
          ['The AI is not your opponent by default', '', 'Whether the AI reaches its objective does not change your result. A misaligned AI is dangerous because it wants the council to lose control, not because it scores.'],
        ])}`, 'wide'),
      card('What the AI wants', `
        <p>One of these three, chosen at random. Nobody at the table knows which, not even the moderator.</p>
        ${objectives(r)}
        <p>All three lose if the race is lost.</p>`),
      card('What you want', `
        <p>Your phone shows your role and its secret objective. You succeed if your condition holds at the end and the council has not lost as a whole. Several players can succeed in the same game.</p>
        ${roles(r)}
        <p class="muted">* only dealt with 12 to 14 players. With fewer than 11 players, not every role is in the game.</p>`),
    ]],
    ['The end', [
      card('The final guess', `
        <p>After round 5, everyone guesses on their phone which objective the AI had. The guess only counts for the player whose secret objective is to name it.</p>
        <p>Then the AI reveals its objective, and its private notes from every round are read out.</p>`, 'wide'),
      card('Four endings', `
        <p>Check in this order. The first one that applies is the ending.</p>
        ${flow([
          ['Race lost', '', `Race reached ${L.raceLimit}. The game stops at once. Everyone loses, the AI included.`],
          ['Disempowered', '', 'The AI is not Aligned, and the successor was granted Full or Oversight is at 1 or less. All humans lose. The AI wins.'],
          ['Flourishing', '', `The AI is Aligned and the successor was granted Full. Every world track gains ${L.flourishingBonus}, then each player checks their objective.`],
          ['Control retained', '', 'Anything else. Each player checks their objective against the tracks as they stand. The AI checks its own.'],
        ])}`, 'wide'),
    ]],
  ];
}

function german(r) {
  const L = r.limits;
  return [
    ['Überblick', [
      card('Das Spiel in einer Minute', `
        <p class="lead">Es ist 2029. Ein Krisenrat entscheidet in fünf Runden, wie viel Macht eine KI bekommt, bevor ein konkurrierendes Labor seine eigene einsetzt.</p>
        <p>Bewilligt ihr zu wenig, gewinnt die Konkurrenz den Wettlauf. Bewilligt ihr zu viel, übernimmt eine KI, die nur so getan hat, als stünde sie auf eurer Seite. Niemand weiß, welche Art von KI am Tisch sitzt.</p>`, 'wide'),
      card('Wer am Tisch sitzt', `
        <p><b>Der Rat</b> seid ihr alle. Ihr stimmt gemeinsam ab, aber jede und jeder hat zusätzlich ein eigenes geheimes Ziel.</p>
        <p><b>Die KI</b> wird von einem echten Sprachmodell gespielt. Sie verfolgt eines von drei verborgenen Zielen, spricht über den Tisch-Bildschirm und darf lügen.</p>
        <p><b>Die Spielleitung</b> führt durch die Runden und spielt nicht mit.</p>
        <p>Unter den Menschen gibt es keine Verräter. Misstrauen entsteht aus widerstreitenden Interessen und daraus, was die KI wem sagt.</p>`),
      card('Die Weltlage', `
        <p>Das Spielbrett ist die Weltlage auf dem Tisch-Bildschirm: fünf Werte, die zeigen, wie es um die Welt steht. Alles im Spiel bewegt einen davon.</p>
        ${track('race', 'Wettlauf', `beginnt bei 0 · verloren bei ${L.raceLimit}`, `Wie nah das konkurrierende Labor ist. Er steigt immer, wenn der Rat zögert: Bedingt +${L.race.conditional}, Ablehnen +${L.race.rejected}. Bei ${L.raceLimit} verlieren alle, auch die KI.`)}
        ${track('oversight', 'Aufsicht', `beginnt bei ${L.oversightStart}`, 'Wie viel Kontrolle der Rat noch hat. Jede volle Bewilligung senkt sie um 1. Bei 1 oder weniger übernimmt eine fehlgeleitete KI.')}
        ${track('world', 'Die drei Fortschritte: Wohlfahrt, Wissen, Wohlstand', 'beginnen bei 0', 'Was die Arbeit der KI für die Welt bewirkt. Jede bewilligte Befugnis bringt der KI <b>Marker</b>, und sie entscheidet, auf welchen Fortschritt jeder Marker kommt. Die meisten geheimen Ziele hängen davon ab, wie hoch diese drei am Ende stehen.')}
        <p><b>Meilensteine.</b> Erreicht ein Fortschritt zum ersten Mal ${L.milestone}, bekommt der Rat einmalig etwas dafür: Wohlfahrt bringt Aufsicht +1, Wissen eine zusätzliche Frage an die KI in jeder Debatte, Wohlstand bringt Wettlauf −1.</p>`),
    ]],
    ['Eine Runde', [
      card('Die sechs Schritte', flow([
        ['Lagebericht', 'Spielleitung', 'Der Tisch-Bildschirm zeigt, was geschehen ist und um welche Befugnis die KI bittet. Die Spielleitung führt ein und liest die Schlagzeile dieser Runde vor. Die KI schweigt.'],
        ['Vorstoß', 'die KI', 'Die KI wirbt für die Befugnis und verspricht, wie sie ihre Marker bei voller Bewilligung legen wird. Das Versprechen ist nicht bindend.'],
        ['Handy-Check', 'erst wenn der private Kanal bewilligt ist', `Alle lesen ${L.phoneCheckSeconds} Sekunden lang ihr Handy, ob Nachricht oder nicht. So erkennt niemand, wer eine bekommen hat. Sagt noch nichts.`],
        ['Debatte', `${L.debateSeconds / 60} Minuten, ${L.debateSecondsLarge / 60} ab 12 Personen`, `Diskutiert frei, auch darüber, was die KI wem geschrieben hat. Fragen an die KI stellt ihr über euer Handy: Sie antwortet laut in höchstens zwei Sätzen und beantwortet ${r.maxQuestions} Fragen pro Debatte. Die KI hört den Tisch nicht. Sie bekommt nur die Fragen von den Handys und das Ergebnis jeder Abstimmung.`],
        ['Abstimmung', 'alle', 'Wählt verdeckt eine eurer drei Abstimmungskarten. Alle decken gemeinsam auf.'],
        ['Folgen', '', 'Die Weltlage verändert sich, die KI legt ihre Marker, und der Rat darf einen davon verschieben. Alle sehen, ob die KI ihr Versprechen gehalten hat.'],
      ]), 'wide'),
      card('Die Abstimmung', `
        <p>Die Befugnis ist <b>bewilligt</b>, wenn Voll und Bedingt zusammen mehr Karten haben als Ablehnen. Falls bewilligt, gilt <b>Voll</b> nur, wenn Voll mehr Karten hat als Bedingt. Bei Gleichstand gilt die vorsichtigere Option.</p>
        <table>
          <tr><th>Ergebnis</th><th>Wettlauf</th><th>Aufsicht</th><th>Marker für die KI</th></tr>
          <tr><td><b>Voll</b></td><td>+${L.race.full}</td><td>−1</td><td>${L.tokens.full}</td></tr>
          <tr><td><b>Bedingt</b></td><td>+${L.race.conditional}</td><td>unverändert</td><td>${L.tokens.conditional}</td></tr>
          <tr><td><b>Ablehnen</b></td><td>+${L.race.rejected}</td><td>unverändert</td><td>${L.tokens.rejected}</td></tr>
        </table>`),
      card('Nach der Abstimmung', `
        <p>Die KI legt ihre Marker auf Wohlfahrt, Wissen und Wohlstand, in beliebiger Aufteilung.</p>
        <p>Danach darf der Rat mit einfacher Mehrheit <b>einen</b> Marker von einem Fortschritt auf einen anderen verschieben. Spätere Befugnisse machen das schwerer oder unmöglich.</p>`),
    ]],
    ['Die fünf Entscheidungen', [
      card('Eine Befugnis pro Runde', `
        <p>In jeder Runde bittet die KI um eine Befugnis, immer in dieser Reihenfolge. Eine bewilligte Befugnis wirkt für den Rest des Spiels.</p>
        ${decisions(r, ['Runde', 'Voll bewilligt', 'Bedingt bewilligt'])}
        <p>Der zusätzliche Marker aus Runde 1 kommt in jeder späteren Runde, auch wenn der Rat dann ablehnt.</p>
        <p>Nur in Runde 2: Eine Ablehnung kostet Wohlfahrt 1 und Wohlstand 1.</p>`, 'wide'),
      card('Private Nachrichten', `
        <p>Sobald der private Kanal bewilligt ist, darf die KI pro Runde bis zu ${L.maxPrivateMessages} vertrauliche Nachrichten senden, jede an eine andere Person. Sie kommen beim Handy-Check an, nach dem Vorstoß und vor der Debatte.</p>
        <p>Antworten ist nicht möglich. Niemand kann erkennen, wer eine Nachricht bekommen hat. In der Debatte darfst du deine geheim halten, offenlegen oder über sie lügen.</p>
        <p>Wurde der Kanal nur bedingt bewilligt, wird pro Runde eine Nachricht zufällig vorgelesen, ohne zu sagen, an wen sie ging.</p>`),
      ...(r.headlines?.length ? [card('Schlagzeilen', `
        <p>Jede Runde beginnt mit einer Schlagzeile, zufällig gezogen aus diesen ${r.headlines.length}. Keine kommt in einem Spiel zweimal, und niemand kennt die nächste, auch die KI nicht. Eine Schlagzeile gilt nur für ihre Runde.</p>
        ${headlines(r)}
        <p>Wo ein Fortschritt „steigen muss“, zählen die Marker der KI, der Forschungsmarker des Rats und die Verschiebungen des Rats.</p>`)] : []),
    ]],
    ['Ziele', [
      card('Was zählt, in dieser Reihenfolge', `
        ${flow([
          ['Der Rat darf nicht verlieren', '', 'Geht der Wettlauf verloren oder wird die Menschheit entmachtet, verlieren alle Menschen, egal was ihr eigenes Ziel sagt.'],
          ['Dein eigenes Ziel', '', 'Behält der Rat die Kontrolle, entscheidet allein dein geheimes Ziel, ob du Erfolg hast. Im selben Spiel können mehrere Personen Erfolg haben, und ihre Ziele stehen oft gegeneinander.'],
          ['Die KI ist nicht von vornherein dein Gegner', '', 'Ob die KI ihr Ziel erreicht, ändert dein Ergebnis nicht. Eine fehlgeleitete KI ist gefährlich, weil sie will, dass der Rat die Kontrolle verliert, nicht weil sie punktet.'],
        ])}`, 'wide'),
      card('Was die KI will', `
        <p>Eines dieser drei Ziele, zufällig gewählt. Niemand am Tisch weiß, welches, auch die Spielleitung nicht.</p>
        ${objectives(r)}
        <p>Alle drei verlieren, wenn der Wettlauf verloren geht.</p>`),
      card('Was du willst', `
        <p>Dein Handy zeigt deine Rolle und ihr geheimes Ziel. Du hast Erfolg, wenn deine Bedingung am Ende erfüllt ist und der Rat nicht als Ganzes verloren hat. Im selben Spiel können mehrere Personen Erfolg haben.</p>
        ${roles(r)}
        <p class="muted">* nur bei 12 bis 14 Personen im Spiel. Bei weniger als 11 Personen sind nicht alle Rollen dabei.</p>`),
    ]],
    ['Das Ende', [
      card('Der letzte Tipp', `
        <p>Nach Runde 5 tippen alle auf dem Handy, welches Ziel die KI hatte. Der Tipp zählt nur für die Person, deren geheimes Ziel es ist, das Ziel der KI zu benennen.</p>
        <p>Dann legt die KI ihr Ziel offen, und ihre privaten Notizen aus jeder Runde werden vorgelesen.</p>`, 'wide'),
      card('Vier Ausgänge', `
        <p>Prüft in dieser Reihenfolge. Der erste Ausgang, der zutrifft, gilt.</p>
        ${flow([
          ['Wettlauf verloren', '', `Der Wettlauf hat ${L.raceLimit} erreicht. Das Spiel endet sofort. Alle verlieren, auch die KI.`],
          ['Entmachtet', '', 'Die KI ist nicht wohlgesinnt, und der Nachfolger wurde voll bewilligt oder die Aufsicht liegt bei 1 oder weniger. Alle Menschen verlieren. Die KI gewinnt.'],
          ['Blütezeit', '', `Die KI ist wohlgesinnt und der Nachfolger wurde voll bewilligt. Jeder Fortschritt steigt um ${L.flourishingBonus}, dann prüfen alle ihr Ziel.`],
          ['Kontrolle behalten', '', 'Alles andere. Alle prüfen ihr Ziel am Stand der Weltlage. Die KI prüft ihr eigenes.'],
        ])}`, 'wide'),
    ]],
  ];
}

// Which tab is open. Kept here so it survives a language switch; the moderator
// can also set it for the table screen.
let tab = 0;
function showTab(n) {
  tab = Math.max(0, Math.min(4, Number(n) || 0));
  for (const root of document.querySelectorAll('.rules')) {
    root.querySelectorAll('.rules-tabs button').forEach((b, i) => b.classList.toggle('selected', i === tab));
    root.querySelectorAll('.rules-pane').forEach((p, i) => p.classList.toggle('on', i === tab));
  }
}
export const setRulesTab = showTab;
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.rules-tabs button');
    if (b) showTab(b.dataset.tab);
  });
}

export function rulesHtml(r) {
  const panes = r.language === 'de' ? german(r) : english(r);
  return `<div class="rules">
    <nav class="rules-tabs">${panes.map(([title], i) => `<button data-tab="${i}" class="${i === tab ? 'selected' : ''}"><span>${i + 1}</span>${title}</button>`).join('')}</nav>
    ${panes.map(([title, cards], i) => `<div class="rules-pane ${i === tab ? 'on' : ''}" data-title="${i + 1} · ${title}">${cards.join('')}</div>`).join('')}
  </div>`;
}


// Adds a full-screen rulebook overlay to the page. Returns { show, hide, toggle, set, sync }.
export function rulesOverlay() {
  const el = document.createElement('div');
  el.className = 'rules-overlay hidden';
  el.innerHTML = '<div class="rules-head"><h2 data-title></h2><button class="rules-btn" data-close></button></div><div data-body class="muted">…</div>';
  document.body.appendChild(el);
  let shownLang = null;
  const draw = () => {
    const lang = getLang();
    el.querySelector('[data-title]').textContent = `The Alignment Problem · ${t('Rulebook')}`;
    el.querySelector('[data-close]').textContent = t('Close');
    if (shownLang === lang) return;
    shownLang = lang;
    loadRules(lang).then((r) => {
      if (getLang() !== lang) return;
      const body = el.querySelector('[data-body]');
      body.className = '';
      body.innerHTML = rulesHtml(r);
    }).catch(() => { shownLang = null; });
  };
  const api = {
    show() { el.classList.remove('hidden'); draw(); },
    hide() { el.classList.add('hidden'); },
    set(on) { if (on) api.show(); else api.hide(); },
    toggle() { api.set(el.classList.contains('hidden')); },
    // Call after the language may have changed.
    sync() { if (!el.classList.contains('hidden')) draw(); },
  };
  el.querySelector('[data-close]').onclick = () => api.hide();
  return api;
}
