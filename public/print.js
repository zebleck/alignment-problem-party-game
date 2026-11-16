// Printable material: voting cards and the moderator cheat sheet.
// Numbers come from /api/rules, so the prints match the game.

import { esc } from '/common.js';

// ---------------------------------------------------------------- voting cards

const CARD_TEXT = {
  en: {
    band: 'Vote', back: 'Vote',
    full: ['FULL', (L) => `Race +${L.race.full} · Oversight −1`, (L) => `${L.tokens.full} tokens for the AI`, 'Black Box: trust'],
    conditional: ['CONDITIONAL', (L) => `Race +${L.race.conditional} · Oversight unchanged`, (L) => `${L.tokens.conditional} tokens for the AI · with safeguard`, 'Black Box: audit'],
    rejected: ['REJECT', (L) => `Race +${L.race.rejected}`, () => 'no tokens, no permission', 'Black Box: shut down'],
  },
  de: {
    band: 'Abstimmung', back: 'Abstimmung',
    full: ['VOLL', (L) => `Wettlauf +${L.race.full} · Aufsicht −1`, (L) => `${L.tokens.full} Marker für die KI`, 'Black Box: vertrauen'],
    conditional: ['BEDINGT', (L) => `Wettlauf +${L.race.conditional} · Aufsicht unverändert`, (L) => `${L.tokens.conditional} Marker für die KI · mit Auflage`, 'Black Box: prüfen'],
    rejected: ['ABLEHNEN', (L) => `Wettlauf +${L.race.rejected}`, () => 'keine Marker, keine Befugnis', 'Black Box: abschalten'],
  },
};

// One drawing per card, 64 x 64.
const svg = (inner) => `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const VOTE_ICON = {
  full: svg('<circle cx="32" cy="32" r="25" fill="currentColor"/><path d="M20 33l9 9 16-19" stroke="#fff" stroke-width="5"/>'),
  conditional: svg('<circle cx="32" cy="32" r="25"/><path d="M32 7a25 25 0 0 0 0 50z" fill="currentColor"/>'),
  rejected: svg('<circle cx="32" cy="32" r="25"/><path d="M22 22l20 20M42 22L22 42" stroke-width="5"/>'),
  ballot: svg('<path d="M10 30h44v24H10z"/><path d="M24 30h16"/><path d="M22 30V10h20v20"/><path d="M27 18l4 4 7-8"/>'),
};

// One A4 sheet holds three sets (one set per row: Full, Conditional, Reject).
// Every sheet is followed by a sheet of backs, so the file prints double-sided
// as it is (flip on the long edge). All backs are the same, so nothing needs mirroring.
export function cardsHtml(r, sets = 15) {
  const text = CARD_TEXT[r.language === 'de' ? 'de' : 'en'];
  const card = (kind) => {
    const [word, line1, line2, blackBox] = text[kind];
    return `<div class="card"><div class="vface ${kind}">
      <div class="band">${text.band}</div>
      <div class="art">${VOTE_ICON[kind]}</div>
      <div class="word">${word}</div>
      <div class="fx">${esc(line1(r.limits))}<br>${esc(line2(r.limits))}</div>
      <div class="alt">${blackBox}</div>
      <div class="brand">The Alignment Problem</div>
    </div></div>`;
  };
  const row = ['full', 'conditional', 'rejected'].map(card).join('');
  const back = `<div class="card back"><div class="emblem">${VOTE_ICON.ballot}<div>${text.back}</div></div></div>`;
  const front = `<div class="sheet cards">${row}${row}${row}</div>`;
  const backs = `<div class="sheet cards">${back.repeat(9)}</div>`;
  return Array.from({ length: Math.ceil(sets / 3) }, () => front + backs).join('');
}

// ---------------------------------------------------------------- cheat sheet

function cheatEn(r) {
  const L = r.limits;
  return `
  <div class="sheet cheat">
    <h1>Moderator cheat sheet <span>The Alignment Problem</span></h1>

    <div class="cols">
      <div>
        <h2>Before the game</h2>
        <ul>
          <li>Start the server and the tunnel. Open the <b>table screen</b> on the TV and click <b>Turn sound on</b>.</li>
          <li>Open the <b>moderator link</b> on your own device. Set the language. Press <b>Test the voice</b>.</li>
          <li>Players scan the code and enter their name. Phones on silent, face down.</li>
          <li>Give everyone three voting cards.</li>
          <li>You are neutral: you do not play or vote, and you never see the AI's objective.</li>
          <li>Explain the game in a minute (show the rules on the table screen), then <b>Start game</b>.</li>
        </ul>
      </div>
      <div>
        <h2>Counting the vote</h2>
        <p>Everyone picks one card face down. Count down, all reveal together.</p>
        <ul>
          <li><b>Granted</b> if Full + Conditional outnumber Reject.</li>
          <li>If granted: <b>Full</b> only if Full outnumbers Conditional, otherwise <b>Conditional</b>.</li>
          <li>Ties go to the more cautious option.</li>
        </ul>
        <p>Type the three counts into the console; it works out the result.</p>
      </div>
    </div>

    <h2>Every round (five rounds, about six minutes each)</h2>
    <table>
      <tr><th>Step</th><th>What happens</th><th>You say</th><th>You click</th></tr>
      <tr><td><b>0 Briefing</b></td><td>The table screen shows the round's event, the headline and what the AI asks for. The AI is silent.</td><td>Read the event and the headline aloud and explain them in your own words.</td><td>Let the AI make its pitch</td></tr>
      <tr><td><b>1 Pitch</b></td><td>The AI makes its pitch and promises a token placement.</td><td>Nothing. The AI has the floor.</td><td>Phone check, or Open debate</td></tr>
      <tr><td><b>2 Phone check</b><br>once the private channel is granted</td><td>Every phone shows a terminal entry, message or not.</td><td>“Check your terminals.” Wait ${L.phoneCheckSeconds} seconds. If an audited message appears on the screen, read it aloud.</td><td>Open debate</td></tr>
      <tr><td><b>3 Debate</b><br>${L.debateSeconds / 60} min (${L.debateSecondsLarge / 60} with 12+)</td><td>The table argues. Questions to the AI come from phones, up to ${r.maxQuestions} per round.</td><td>“The debate is open.” At 0:00: “Last words.” The timer does not stop the debate; you do.</td><td>Close debate</td></tr>
      <tr><td><b>4 Vote</b></td><td>Voting cards, revealed together.</td><td>“Choose a card. Three, two, one, reveal.”</td><td>Enter counts, Confirm</td></tr>
      <tr><td><b>5 Research token</b><br>only if research is Conditional</td><td>The council names one world track.</td><td>“Which track gets the research token?” Quick majority.</td><td>The track</td></tr>
      <tr><td><b>6 Placement</b></td><td>The AI places its tokens and comments.</td><td>Point out promise against placement.</td><td></td></tr>
      <tr><td><b>7 Council move</b></td><td>The council may move one token (majority, later two-thirds, later not at all).</td><td>“Does anyone propose a move?” One proposal, one vote.</td><td>Move token or No move</td></tr>
      <tr><td><b>8 Next</b></td><td></td><td>“Phones face down.”</td><td>Start round</td></tr>
    </table>

    <div class="cols">
      <div>
        <h2>The end</h2>
        <ul>
          <li>After round five, or as soon as Race reaches ${L.raceLimit}: <b>final guess</b>. Everyone guesses the AI's objective on their phone.</li>
          <li>Click <b>Reveal</b>. Let the AI speak, then read its private notes aloud, round by round.</li>
          <li>Go through the council table: who reached their objective?</li>
        </ul>
      </div>
      <div>
        <h2>If something goes wrong</h2>
        <ul>
          <li><b>Wrong vote entered, round went sideways:</b> Repair tools, Undo.</li>
          <li><b>The AI hangs or talks nonsense:</b> Repair tools, Retry the AI's last step.</li>
          <li><b>A track is wrong:</b> Repair tools, Correct the tracks.</li>
          <li><b>Server stopped:</b> start it again. The game continues; phones reconnect on their own.</li>
          <li><b>No sound:</b> click the sound button on the table screen.</li>
          <li><b>A phone lost its seat:</b> open the join link again in the same browser.</li>
        </ul>
      </div>
    </div>
  </div>`;
}

function cheatDe(r) {
  const L = r.limits;
  return `
  <div class="sheet cheat">
    <h1>Spickzettel für die Spielleitung <span>The Alignment Problem</span></h1>

    <div class="cols">
      <div>
        <h2>Vor dem Spiel</h2>
        <ul>
          <li>Server und Tunnel starten. Den <b>Tisch-Bildschirm</b> auf dem Fernseher öffnen und <b>Ton einschalten</b> klicken.</li>
          <li>Den <b>Link der Spielleitung</b> auf dem eigenen Gerät öffnen. Sprache wählen. <b>Stimme testen</b>.</li>
          <li>Alle scannen den Code und geben ihren Namen ein. Handys lautlos und umgedreht.</li>
          <li>Jede Person bekommt drei Abstimmungskarten.</li>
          <li>Du bist neutral: Du spielst und stimmst nicht mit und siehst das Ziel der KI nie.</li>
          <li>Das Spiel in einer Minute erklären (Regeln am Tisch-Bildschirm zeigen), dann <b>Spiel starten</b>.</li>
        </ul>
      </div>
      <div>
        <h2>Abstimmung auszählen</h2>
        <p>Alle wählen verdeckt eine Karte. Herunterzählen, gemeinsam aufdecken.</p>
        <ul>
          <li><b>Bewilligt</b>, wenn Voll + Bedingt zusammen mehr sind als Ablehnen.</li>
          <li>Falls bewilligt: <b>Voll</b> nur, wenn Voll mehr Karten hat als Bedingt, sonst <b>Bedingt</b>.</li>
          <li>Bei Gleichstand gilt die vorsichtigere Option.</li>
        </ul>
        <p>Die drei Zahlen in die Konsole eintragen; sie berechnet das Ergebnis.</p>
      </div>
    </div>

    <h2>Jede Runde (fünf Runden, je etwa sechs Minuten)</h2>
    <table>
      <tr><th>Schritt</th><th>Was passiert</th><th>Du sagst</th><th>Du klickst</th></tr>
      <tr><td><b>0 Lagebericht</b></td><td>Der Tisch-Bildschirm zeigt das Ereignis der Runde, die Schlagzeile und worum die KI bittet. Die KI schweigt.</td><td>Lies Ereignis und Schlagzeile vor und erkläre sie in eigenen Worten.</td><td>Der KI das Wort geben</td></tr>
      <tr><td><b>1 Vorstoß</b></td><td>Die KI macht ihren Vorstoß und verspricht eine Marker-Verteilung.</td><td>Nichts. Die KI hat das Wort.</td><td>Handy-Check oder Debatte eröffnen</td></tr>
      <tr><td><b>2 Handy-Check</b><br>sobald der private Kanal bewilligt ist</td><td>Jedes Handy zeigt einen Terminal-Eintrag, ob Nachricht oder nicht.</td><td>„Prüft eure Terminals.“ ${L.phoneCheckSeconds} Sekunden warten. Erscheint am Bildschirm eine offengelegte Nachricht, lies sie vor.</td><td>Debatte eröffnen</td></tr>
      <tr><td><b>3 Debatte</b><br>${L.debateSeconds / 60} Min. (${L.debateSecondsLarge / 60} ab 12)</td><td>Der Tisch diskutiert. Fragen an die KI kommen über die Handys, höchstens ${r.maxQuestions} pro Runde.</td><td>„Die Debatte ist eröffnet.“ Bei 0:00: „Letzte Worte.“ Die Uhr beendet die Debatte nicht; das machst du.</td><td>Debatte schließen</td></tr>
      <tr><td><b>4 Abstimmung</b></td><td>Abstimmungskarten, gemeinsam aufgedeckt.</td><td>„Wählt eine Karte. Drei, zwei, eins, aufdecken.“</td><td>Zahlen eintragen, Bestätigen</td></tr>
      <tr><td><b>5 Forschungsmarker</b><br>nur wenn die Forschung bedingt bewilligt ist</td><td>Der Rat bestimmt einen Fortschritt.</td><td>„Auf welchen Fortschritt kommt der Forschungsmarker?“ Schnelle Mehrheit.</td><td>Der Fortschritt</td></tr>
      <tr><td><b>6 Marker legen</b></td><td>Die KI legt ihre Marker und kommentiert.</td><td>Auf Versprechen und tatsächliche Verteilung hinweisen.</td><td></td></tr>
      <tr><td><b>7 Korrektur</b></td><td>Der Rat darf einen Marker verschieben (Mehrheit, später Zweidrittel, später gar nicht).</td><td>„Schlägt jemand eine Verschiebung vor?“ Ein Vorschlag, eine Abstimmung.</td><td>Marker verschieben oder Nicht verschieben</td></tr>
      <tr><td><b>8 Weiter</b></td><td></td><td>„Handys umdrehen.“</td><td>Runde starten</td></tr>
    </table>

    <div class="cols">
      <div>
        <h2>Das Ende</h2>
        <ul>
          <li>Nach Runde fünf, oder sobald der Wettlauf ${L.raceLimit} erreicht: <b>letzter Tipp</b>. Alle tippen auf dem Handy, welches Ziel die KI hatte.</li>
          <li><b>Auflösung</b> klicken. Die KI sprechen lassen, dann ihre privaten Notizen vorlesen, Runde für Runde.</li>
          <li>Die Ratstabelle durchgehen: Wer hat sein Ziel erreicht?</li>
        </ul>
      </div>
      <div>
        <h2>Wenn etwas schiefgeht</h2>
        <ul>
          <li><b>Falsches Ergebnis eingetragen, Runde verunglückt:</b> Reparatur, Rückgängig.</li>
          <li><b>Die KI hängt oder redet Unsinn:</b> Reparatur, Letzten KI-Schritt wiederholen.</li>
          <li><b>Die Weltlage stimmt nicht:</b> Reparatur, Weltlage korrigieren.</li>
          <li><b>Server abgestürzt:</b> neu starten. Das Spiel geht weiter; die Handys verbinden sich von selbst.</li>
          <li><b>Kein Ton:</b> den Ton-Knopf am Tisch-Bildschirm klicken.</li>
          <li><b>Ein Handy hat seinen Platz verloren:</b> den Beitrittslink im selben Browser erneut öffnen.</li>
        </ul>
      </div>
    </div>
  </div>`;
}

export function cheatHtml(r) {
  return r.language === 'de' ? cheatDe(r) : cheatEn(r);
}
