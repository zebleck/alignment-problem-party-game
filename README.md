# The Alignment Problem

A party game for 6 to 14 players. A real LLM plays an AI with a hidden objective; a council of humans decides over five rounds how much power to give it. Rules: see the one-page sheet (v0.3). All numbers live in `data.js`.

## Start

```
npm install
copy .env.example .env      (then paste your keys into .env)
npm start
```

The console prints three links:

- **Table screen** `/screen`: put it on the TV. The AI speaks through this device. Click "Turn sound on" once.
- **Moderator** `/mod?key=...`: one neutral person drives the game from here.
- **Players** `/play`: everyone opens this on their phone (QR code on the table screen).

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

1. The AI pitches (spoken on the table screen) and promises a token placement.
2. Moderator opens the debate. Players hold the talk button or type to question the AI; answers are spoken.
3. If the private channel is granted: phone check. Every phone shows a terminal entry, message or not.
4. Show of hands. The moderator enters Full, Conditional or Reject.
5. The AI places its tokens; the council may move one. Next round.

After round 5 everyone guesses the AI's objective on their phone, then the reveal shows the objective, the AI's private notes and who reached their goal.

## Files

| File | What it does |
| --- | --- |
| `data.js` | Rounds, roles, AI objectives, all numbers |
| `game.js` | State and rules; validates everything the AI returns |
| `ai.js` | Prompt, Anthropic API call, scripted fallback AI |
| `speech.js` | ElevenLabs speech-to-text and text-to-speech |
| `server.js` | HTTP + WebSocket server |
| `public/` | The three views |
| `test/sim.js` | Plays full games against the scripted AI (`npm test`) |

## Settings (`.env`)

`GAME_LANGUAGE=de` makes the AI speak German (cards and buttons stay English). `MAX_QUESTIONS` caps AI answers per debate. `FORCE_OBJECTIVE=aligned|paternalistic|optimizer` fixes the AI's objective for testing.

## Not yet tested

The rules and all three views are tested end to end with the scripted AI. The live Anthropic and ElevenLabs calls were written against their documented APIs but have not been run with real keys.
