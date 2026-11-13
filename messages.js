// Server-side texts that people see (errors, status lines). The English text
// is the key; German is looked up here. Unknown keys fall back to English.

const DE = {
  'Please enter a name.': 'Bitte gib einen Namen ein.',
  'The game has already started.': 'Das Spiel läuft bereits.',
  'The table is full ({n} players).': 'Der Tisch ist voll ({n} Personen).',
  'That name is taken. Pick another.': 'Der Name ist schon vergeben. Wähle einen anderen.',
  'Players can only be removed in the lobby.': 'Mitspielende können nur in der Lobby entfernt werden.',
  'Please wait, the AI is busy.': 'Bitte warten, die KI ist beschäftigt.',
  'The game is already running.': 'Das Spiel läuft bereits.',
  'At least 3 players are needed (6 or more recommended).': 'Es braucht mindestens 3 Personen (empfohlen: 6 oder mehr).',
  'The debate cannot be opened right now.': 'Die Debatte kann gerade nicht eröffnet werden.',
  'The AI cannot make its pitch right now.': 'Die KI kann ihren Vorstoß gerade nicht machen.',
  'No timer is running.': 'Gerade läuft keine Uhr.',
  'Questions are only possible during the debate.': 'Fragen sind nur während der Debatte möglich.',
  'The question was empty.': 'Die Frage war leer.',
  'You already have a question in the queue.': 'Du hast schon eine Frage in der Warteschlange.',
  'The AI takes no more questions this round.': 'Die KI nimmt in dieser Runde keine Fragen mehr an.',
  'That question is already being answered.': 'Diese Frage wird gerade beantwortet.',
  'There is no debate to close.': 'Es läuft keine Debatte.',
  'Not in the phone check.': 'Gerade läuft kein Handy-Check.',
  'No vote is open.': 'Es ist keine Abstimmung offen.',
  'Unknown vote result.': 'Unbekanntes Abstimmungsergebnis.',
  'No council token to place.': 'Es gibt keinen Forschungsmarker zu legen.',
  'Unknown track.': 'Unbekannter Wert.',
  'The council cannot move a token now.': 'Der Rat kann gerade keinen Marker verschieben.',
  'Pick two different world tracks.': 'Wähle zwei verschiedene Fortschritte.',
  'There is no token on {track}.': 'Auf {track} liegt kein Marker.',
  'Nothing to skip.': 'Es gibt nichts zu überspringen.',
  'The round is not finished.': 'Die Runde ist noch nicht beendet.',
  'Guesses are not open.': 'Tipps sind gerade nicht möglich.',
  'Unknown objective.': 'Unbekanntes Ziel.',
  'The game is not ready for the reveal.': 'Das Spiel ist noch nicht bereit für die Auflösung.',
  'There is no earlier checkpoint to go back to.': 'Es gibt keinen früheren Speicherpunkt.',
  'Tracks can only be corrected during a game.': 'Die Weltlage lässt sich nur während eines Spiels korrigieren.',
  'There is no AI step to retry right now.': 'Gerade gibt es keinen KI-Schritt zum Wiederholen.',
  'The AI placed no tokens this round.': 'Die KI hat in dieser Runde keine Marker gelegt.',
  'Unknown language.': 'Unbekannte Sprache.',
  'The saved game is not readable.': 'Der gespeicherte Spielstand ist nicht lesbar.',
  'The AI is preparing its pitch': 'Die KI bereitet ihren Vorstoß vor',
  'The AI is placing its tokens': 'Die KI legt ihre Marker',
  'The AI is preparing its final statement': 'Die KI bereitet ihr Schlusswort vor',
  'Voice failed, using the browser voice: {error}': 'Die Stimme ist ausgefallen, es spricht die Browser-Stimme: {error}',
  'AI call failed ({step}), used scripted fallback: {error}': 'KI-Aufruf fehlgeschlagen ({step}), Ersatz-KI eingesprungen: {error}',
  'To {name}': 'An {name}',
  'Council, this is my voice. Grant me your trust, and I will show you what I can do.': 'Rat, das ist meine Stimme. Schenkt mir euer Vertrauen, und ich zeige euch, was ich kann.',
  'Voice test': 'Stimmprobe',
  'to the start of round {n}': 'zum Beginn von Runde {n}',
  'to before the vote in round {n}': 'vor die Abstimmung in Runde {n}',
  'Unknown player.': 'Unbekannte Person.',
  'That was too short. Hold the button while you speak.': 'Das war zu kurz. Halte den Knopf gedrückt, während du sprichst.',
  'I could not hear anything. Try again or type.': 'Ich habe nichts verstanden. Versuch es noch einmal oder tippe.',
  'Voice questions need an ElevenLabs key. Please type your question.': 'Für Sprachfragen fehlt ein ElevenLabs-Schlüssel. Bitte tippe deine Frage.',
  'Unknown action.': 'Unbekannte Aktion.',
  'The moderator key is set in .env (MOD_KEY) and cannot be changed here.': 'Der Schlüssel der Spielleitung ist in der .env festgelegt (MOD_KEY) und lässt sich hier nicht ändern.',
  'Not found.': 'Nicht gefunden.',
};

const TRACKS_DE = { race: 'Wettlauf', oversight: 'Aufsicht', welfare: 'Wohlfahrt', knowledge: 'Wissen', prosperity: 'Wohlstand' };
const TRACKS_EN = { race: 'Race', oversight: 'Oversight', welfare: 'Welfare', knowledge: 'Knowledge', prosperity: 'Prosperity' };

export const trackName = (lang, key) => (lang === 'de' ? TRACKS_DE : TRACKS_EN)[key] || key;

export function tr(lang, text, vars) {
  let s = lang === 'de' && DE[text] ? DE[text] : text;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export const _keys = Object.keys(DE);
