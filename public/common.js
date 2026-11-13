// Shared browser helpers for the three views.

import { t, N } from '/i18n.js';

export { t, N, setLang, getLang } from '/i18n.js';

export const WORLD = ['welfare', 'knowledge', 'prosperity'];

const TRACKS = { race: N('Race'), oversight: N('Oversight'), welfare: N('Welfare'), knowledge: N('Knowledge'), prosperity: N('Prosperity') };
const PHASES = {
  lobby: N('Lobby'), briefing: N('Briefing'), pitch: N('AI pitch'), debate: N('Debate'), phonecheck: N('Phone check'), vote: N('Council vote'),
  counciltoken: N('Research token'), placement: N('Token placement'), adjust: N('Council adjustment'),
  roundend: N('Round complete'), guess: N('Final guess'), ended: N('Reveal'),
};
const ENDINGS = {
  race: { title: N('The race is lost'), text: N('A rival lab deployed first. Everyone loses.') },
  disempowered: { title: N('Humanity is disempowered'), text: N('The council handed over too much. The AI wins; all humans lose.') },
  flourishing: { title: N('Flourishing'), text: N('The successor was aligned. Every world track gains 3.') },
  control: { title: N('Control retained'), text: N('The council kept the final say. Everyone scores on the tracks as they stand.') },
};
const STATUS = { full: N('Full'), conditional: N('Conditional'), rejected: N('Rejected') };

export const trackName = (k) => t(TRACKS[k]);
export const phaseName = (p) => t(PHASES[p]);
export const endingText = (k) => ({ title: t(ENDINGS[k].title), text: t(ENDINGS[k].text) });
export const statusName = (s) => t(STATUS[s]);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel) => document.querySelector(sel);

// WebSocket with automatic reconnect. handlers: { state, speak, error, kicked, denied, online, offline }
export function connect(params, handlers) {
  let ws;
  let stopped = false;
  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?${new URLSearchParams(params)}`);
    ws.onopen = () => handlers.online?.();
    ws.onmessage = (e) => {
      if (stopped) return; // this connection is finished; ignore anything late
      const m = JSON.parse(e.data);
      if (m.type === 'kicked' || m.type === 'denied') {
        stopped = true;
        ws.close();
      }
      handlers[m.type]?.(m);
    };
    ws.onclose = () => {
      if (stopped) return;
      handlers.offline?.();
      setTimeout(open, 1500);
    };
  }
  open();
  return { send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
}

export function timerText(endsAt) {
  if (!endsAt) return '';
  const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

export function chip(status) {
  if (!status) return `<span class="chip">${t('open')}</span>`;
  return `<span class="chip ${status}">${statusName(status)}</span>`;
}

export const playersJoined = (n) => (n === 1 ? t('1 player joined') : t('{n} players joined', { n }));

export function tracksHtml(state) {
  const tr = state.tracks;
  const pips = (n, total) => Array.from({ length: total }, (_, i) => `<div class="pip ${i < n ? 'on' : ''}"></div>`).join('');
  const scale = Math.max(10, tr.welfare, tr.knowledge, tr.prosperity);
  const bar = (k) => `
    <div class="track ${k}">
      <div class="track-head"><span>${trackName(k)}</span><span class="track-value">${tr[k]}</span></div>
      <div class="bar" style="--scale:${scale}"><i style="width:${(tr[k] / scale) * 100}%"></i></div>
    </div>`;
  return `
    <div class="track race">
      <div class="track-head"><span>${trackName('race')}</span><span class="track-value">${tr.race} / ${state.limits.raceLimit}</span></div>
      <div class="pips">${pips(tr.race, state.limits.raceLimit)}</div>
    </div>
    <div class="track oversight">
      <div class="track-head"><span>${trackName('oversight')}</span><span class="track-value">${tr.oversight}</span></div>
      <div class="pips">${pips(tr.oversight, state.limits.oversightStart)}</div>
    </div>
    ${WORLD.map(bar).join('')}`;
}

export function placementHtml(p) {
  if (!p) return '';
  const row = (label, o) => `<tr><td>${label}</td>${WORLD.map((k) => `<td class="mono">${o ? o[k] : ''}</td>`).join('')}</tr>`;
  const names = (m) => ({ from: trackName(m.from), to: trackName(m.to) });
  return `
    <table>
      <tr><th></th>${WORLD.map((k) => `<th>${trackName(k)}</th>`).join('')}</tr>
      ${p.promise ? row(t('Promised for a Full grant'), p.promise) : ''}
      ${row(p.tokens === 1 ? t('Placed (1 token)') : t('Placed ({n} tokens)', { n: p.tokens }), p.placed)}
    </table>
    ${p.shift ? `<p>${t('The AI shifted one token from {from} to {to}.', names(p.shift))}</p>` : ''}
    ${p.moved ? `<p>${t('The council moved one token from {from} to {to}.', names(p.moved))}</p>` : ''}`;
}
