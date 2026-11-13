// Opens a Cloudflare quick tunnel to the game server and prints the HTTPS
// links for every view. Run next to "npm start":  npm run tunnel
// Add "-- --log" to see cloudflared's full output.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import { loadEnv } from './server.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv();
const port = Number(process.env.PORT) || 3000;
const showLog = process.argv.includes('--log');

// Same lookup as the server: MOD_KEY in .env, else the remembered key file.
function modKey() {
  if (process.env.MOD_KEY) return process.env.MOD_KEY;
  try {
    return fs.readFileSync(path.join(ROOT, 'data', 'moderator-key.txt'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

// An empty config makes cloudflared ignore ~/.cloudflared/config.yml, whose
// ingress rules would otherwise answer every request with 404.
const nullFile = process.platform === 'win32' ? 'NUL' : '/dev/null';
const child = spawn('cloudflared', ['tunnel', '--config', nullFile, '--url', `http://localhost:${port}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let base = null;
let connected = false;
let buffer = '';

function printLinks() {
  const key = modKey();
  const keyPart = key || '<key printed by npm start>';
  console.log('\nThe tunnel is open. Use these links:\n');
  console.log(`  Table screen:  ${base}/screen`);
  console.log(`  Moderator:     ${base}/mod?key=${keyPart}`);
  console.log(`  Players:       ${base}/play`);
  console.log(`  Rulebook:      ${base}/rules`);
  console.log(`  Solo test:     ${base}/dev?key=${keyPart}   (all views and 4 players in one tab)`);
  if (!key) console.log('\n  No moderator key found yet. Start the game with "npm start" first; it prints the key.');
  console.log('\n  Table screen as QR code:\n');
  qrcode.generate(`${base}/screen`, { small: true }, (qr) => console.log(qr.replace(/^/gm, '  ')));
  console.log('\n  The address changes every time the tunnel restarts. Keep this window open; Ctrl+C closes the tunnel.\n');
}

function onData(chunk) {
  if (showLog) process.stderr.write(chunk);
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop();
  for (const line of lines) {
    const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !base) {
      base = m[0];
      console.log('Got an address, connecting (this can take up to a minute) ...');
    }
    if (/Registered tunnel connection/.test(line) && base && !connected) {
      connected = true;
      printLinks();
    }
  }
}

console.log(`Opening a tunnel to http://localhost:${port} ...`);
child.stdout.on('data', onData);
child.stderr.on('data', onData);

child.on('error', (err) => {
  console.error(err.code === 'ENOENT'
    ? 'cloudflared was not found. Install it first, for example: winget install Cloudflare.cloudflared'
    : `Could not start cloudflared: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code) => {
  if (!connected && code) console.error(`cloudflared stopped before the tunnel was ready (exit code ${code}). Run "npm run tunnel -- --log" to see why.`);
  process.exit(code ?? 0);
});

process.on('SIGINT', () => child.kill());
