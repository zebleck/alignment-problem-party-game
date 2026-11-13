// Regenerates the ready-made PDFs in print/ from the live print pages, in
// German and English, using headless Chrome or Edge.
//
//   npm run pdfs                      all documents
//   npm run pdfs -- rulebook cheatsheet   only these
//
// It starts its own game server on a spare port, so the numbers and texts
// come from the code as it is now. Set CHROME to a browser path if none is found.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DOCS = {
  rulebook: { page: '/rules', file: 'rulebook' },
  cheatsheet: { page: '/cheatsheet', file: 'moderator-cheat-sheet' },
  cards: { page: '/cards', file: 'voting-cards' },
  blackbox: { page: '/blackbox.html', file: 'black-box' },
};

const browser = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
if (!browser) {
  console.error('No Chrome or Edge found. Set the CHROME environment variable to a browser path.');
  process.exit(1);
}

const wanted = process.argv.slice(2);
const unknown = wanted.filter((w) => !DOCS[w]);
if (unknown.length) {
  console.error(`Unknown document: ${unknown.join(', ')}. Choose from: ${Object.keys(DOCS).join(', ')}.`);
  process.exit(1);
}
const names = wanted.length ? wanted : Object.keys(DOCS);

const app = createApp({ MOD_KEY: 'pdf' });
await app.ready;
await new Promise((resolve) => app.server.listen(0, resolve));
const base = `http://localhost:${app.server.address().port}`;
const outDir = path.join(ROOT, 'print');
fs.mkdirSync(outDir, { recursive: true });

// Not spawnSync: this process is also the server the browser loads the page from.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-pdf-')); // own profile, so an open browser is left alone
const run = (args) => new Promise((resolve) => {
  const child = spawn(browser, args, { stdio: 'ignore' });
  const timer = setTimeout(() => child.kill(), 60000);
  child.on('exit', () => { clearTimeout(timer); resolve(); });
  child.on('error', () => { clearTimeout(timer); resolve(); });
});

let failed = false;
for (const name of names) {
  for (const lang of ['de', 'en']) {
    const out = path.join(outDir, `${DOCS[name].file}-${lang}.pdf`);
    const tmp = `${out}.tmp`;
    fs.rmSync(tmp, { force: true });
    await run([
      '--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${profile}`,
      '--virtual-time-budget=8000', // the pages build themselves after loading
      `--print-to-pdf=${tmp}`,
      `${base}${DOCS[name].page}?lang=${lang}`,
    ]);
    if (fs.existsSync(tmp) && fs.statSync(tmp).size > 5000) {
      fs.renameSync(tmp, out);
      console.log(`ok    print/${path.basename(out)}  (${Math.round(fs.statSync(out).size / 1024)} KB)`);
    } else {
      fs.rmSync(tmp, { force: true });
      console.log(`FAIL  print/${path.basename(out)}  (left unchanged)`);
      failed = true;
    }
  }
}
app.server.close();
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
process.exit(failed ? 1 : 0);
