# The Alignment Problem

A party game for 6 to 14 players. A real LLM plays an AI with a hidden objective; a council of humans decides over five rounds how much power to give it. Rules: see the one-page sheet (v0.3). All numbers live in `data.js`.

## Start

```
npm install
copy .env.example .env      (then paste your keys into .env)
npm start
```

The console prints three links:

- **Table screen** `/screen`: put it on the TV. The AI speaks through this device. Click "Turn sound on" once. If several table screens are open, only one plays the voice: the one where sound was turned on last.
- **Moderator** `/mod?key=...`: one neutral person drives the game from here. The key is created once and kept in `data/moderator-key.txt`, so the link stays the same across restarts. It changes only via "New moderator key" on the console, or set `MOD_KEY` in `.env` to choose it yourself.
- **Players** `/play`: everyone opens this on their phone (QR code on the table screen).
- **Rulebook** `/rules`: the complete rules on one page, printable. Every view also has a Rulebook button, and the moderator can put the rules on the table screen. The page is generated from `data.js`, so it always matches the numbers in play.

### Testing alone

Open `http://localhost:3000/dev?key=<moderator key>` (the full link is printed at start). One tab shows the table screen, the moderator console and four player seats, each a separate player. Add `&n=6` for more seats. On `localhost` the microphone works without a tunnel, so hold-to-talk can be tested with the mouse.

### Phones and the microphone

Phone browsers only allow the microphone on HTTPS pages, so run a tunnel and use its address for all three views:

```
cloudflared tunnel --url http://localhost:3000
```

Open `https://<tunnel-address>/screen` on the laptop; the QR code then points phones at the right place.

### Without keys

- No `ANTHROPIC_API_KEY`: a scripted stand-in plays the AI. Good for learning the flow.
- No `ELEVENLABS_API_KEY`: questions are typed, and the table screen uses the browser's built-in voice.

## How a round runs

1. Briefing: the table screen shows the round's event, what the AI asks for, and a random headline that changes this round. The moderator introduces it, then lets the AI speak.
2. The AI pitches (spoken on the table screen) and promises a token placement.
3. If the private channel is granted: phone check. Every phone shows a terminal entry, message or not. This comes before the debate so the table can argue about the messages.
4. Moderator opens the debate. Players hold the talk button or type to question the AI; answers are spoken. The debate length is set in the moderator console, and the running timer can be adjusted by a minute at a time.
5. Everyone votes on their phone, in secret. The moderator closes the vote; the table screen then shows who voted what, and the AI learns it too. (If phones fail, vote with the printed cards and enter the counts by hand.)
6. The AI places its tokens; the council may move one. Next round.

After round 5 everyone guesses the AI's objective on their phone, then the reveal shows the objective, the AI's private notes and who reached their goal.

### Headlines and milestones

Both were added after the first full game (November 2026), whose players found it too predictable and the three world tracks without effect.

- **Headlines.** Ten of them in `data.js`; five are drawn per game, one per round. Some move Race or Oversight at once, some change what the round's vote costs or pays, some demand that a world track rises by 2 in the round or it loses a token. They also give a misaligned AI cover for a lopsided placement.
- **What the AI knows about the council.** It sees every question and, with phone voting, who voted what. It learns the members' secret objectives only if the council grants the private channel in full; aloud it may then only hint at them, in private messages it may name them.
- **Milestones.** The first time a world track reaches 4, the council is paid once: Welfare makes the next Reject cost 1 less Race, Knowledge gives one more question per debate, Prosperity Race −1.
- **Roles.** The three track roles each need their track to be the single highest, so they compete in every game. Roles are dealt so that every table has at least one guard (needs Oversight), one growth role (needs grants) and, from four players, two track roles.

After a game, players can leave feedback at `/feedback` (typed or spoken); the table screen shows a QR code for it, and the moderator console links to what came in. Entries are kept in `data/feedback.jsonl`.

## Printing

The app needs no printed components, but three things help at the table. Ready-made PDFs are in `print/` (German and English); the live versions are linked under Print on the moderator console.

| What | Page | How many |
| --- | --- | --- |
| Voting cards | `/cards` | 5 sheets = 15 sets of three (one set per player), each sheet followed by its backs. Print double-sided, flip on the long edge, scale 100 %. `?sets=9` prints fewer. |
| Moderator cheat sheet | `/cheatsheet` | 1 page |
| Rulebook | `/rules` | 4 pages in English, 5 in German, double-sided; two or three copies for the table |

The vote is cast on the phones; the cards are a backup for when phones fail (the moderator then types the three counts and the console works out the result). Granted if Full + Conditional outnumber Reject; if granted, Full only if Full outnumbers Conditional; ties go to the cautious option.

## Black Box (paper backup game)

A separate 15-minute game for 4 to 14 players that needs only printed cards: no server, phones or AI service. One player is the AI, secretly aligned or misaligned; each round it draws three cards, plays two and discards one, and the council votes to trust, audit (once per game) or shut it down. It reuses the voting cards.

- Print `print/black-box-de.pdf` or `-en.pdf` double-sided (flip on the long edge, scale 100 %): the rules, a blank reverse, then four card sheets, each followed by its backs.
- `public/blackbox.html` is the source. It is self-contained: open it straight from disk, pick the language, print.
- `python tools/paper_game_sim.py` replays the game with simple strategies and prints win rates, for tuning the numbers.

## The AI's voice

Pick or design a voice in ElevenLabs, copy its Voice ID into `ELEVENLABS_VOICE_ID` in `.env`, and restart. Optional: `ELEVENLABS_VOICE_ID_DE` for a separate German voice, and `ELEVENLABS_STABILITY`, `ELEVENLABS_SIMILARITY`, `ELEVENLABS_STYLE`, `ELEVENLABS_SPEED` to override the settings stored with the voice. "Test the voice" on the moderator console speaks a sample line on the table screen.

## Language

The moderator console has an English / Deutsch switch. It applies to the whole table at once: all three views, the scenario cards, roles and objectives, the rulebook, and the language the AI speaks and writes in. It can be changed at any time, including mid-game; things the AI already said stay as they were.

German role names are people, like the English ones ("Ärztin", "Gewerkschafter"), alternating feminine and masculine forms; a role is a character, not a statement about the player. Interface texts live in `public/i18n.js`, card and role texts in `data.js`, the rulebook prose in `public/rules.js`, server messages in `messages.js`. `npm test` fails if a text has no German version.

## If something breaks mid-game

The game is saved to `data/game-state.json` after every step.

- **Server crashed or needs a code fix:** stop it, fix, `npm start`. It resumes the same game; phones and screens reconnect on their own and players keep their roles. An AI step that was interrupted is redone. `npm run fresh` discards the saved game instead.
- **Wrong vote entered, or a round went sideways:** moderator console, Repair tools, Undo. Checkpoints exist at the start of every round and before every vote; pressing Undo again steps further back.
- **The AI hangs or says something broken:** Retry the AI's last step. It cancels the call in flight and redoes the pitch, placement or answer.
- **A track is wrong:** correct the numbers by hand under Repair tools. The AI is told about the correction.

Every game is also recorded in `data/games/`, one `.json` and one readable `.md` per game, named by its start time. The record is rewritten after each step, so it survives a reset, `npm run fresh` or a game that was never finished. It holds the full transcript, votes, token placements, private messages, the AI's objective and its private notes.

The saved file and the game records contain the AI's hidden objective, so the moderator should not open them during a game.

## Files

| File | What it does |
| --- | --- |
| `data.js` | Rounds, roles, AI objectives, all numbers |
| `game.js` | State and rules; validates everything the AI returns |
| `ai.js` | Prompt, Anthropic API call, scripted fallback AI |
| `messages.js` | German versions of server messages |
| `speech.js` | ElevenLabs speech-to-text and text-to-speech |
| `server.js` | HTTP + WebSocket server |
| `public/` | The three views |
| `public/icons.js` | One icon per track, vote result, round step, permission, ending and role; the colours are the `.c-*` classes in `style.css` |
| `test/sim.js` | Plays full games against the scripted AI (`npm test`) |

## Settings (`.env`)

`GAME_LANGUAGE=de` sets the starting language (see Language below). `MAX_QUESTIONS` caps AI answers per debate. `FORCE_OBJECTIVE=aligned|paternalistic|optimizer` fixes the AI's objective for testing. `HEADLINES=off` plays without headlines; `HEADLINES=spy,famine,demo,windfall,inspection` fixes their order.

## Not yet tested

The rules and all three views are tested end to end with the scripted AI. The live Anthropic and ElevenLabs calls were written against their documented APIs but have not been run with real keys.
