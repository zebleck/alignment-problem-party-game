// Shared browser helpers for the three views.

export const TRACKS = { race: 'Race', oversight: 'Oversight', welfare: 'Welfare', knowledge: 'Knowledge', prosperity: 'Prosperity' };
export const WORLD = ['welfare', 'knowledge', 'prosperity'];
export const PHASES = {
  lobby: 'Lobby', pitch: 'AI pitch', debate: 'Debate', phonecheck: 'Phone check', vote: 'Council vote',
  counciltoken: 'Research token', placement: 'Token placement', adjust: 'Council adjustment',
  roundend: 'Round complete', guess: 'Final guess', ended: 'Reveal',
};
export const ENDINGS = {
  race: { title: 'The race is lost', text: 'A rival lab deployed first. Everyone loses.' },
  disempowered: { title: 'Humanity is disempowered', text: 'The council handed over too much. The AI wins; all humans lose.' },
  flourishing: { title: 'Flourishing', text: 'The successor was aligned. Every world track gains 3.' },
  control: { title: 'Control retained', text: 'The council kept the final say. Everyone scores on the tracks as they stand.' },
};

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
      const m = JSON.parse(e.data);
      if (m.type === 'kicked' || m.type === 'denied') stopped = true;
      handlers[m.type]?.(m);
    };
    ws.onclose = () => {
      handlers.offline?.();
      if (!stopped) setTimeout(open, 1500);
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
  if (!status) return '<span class="chip">open</span>';
  return `<span class="chip ${status}">${status}</span>`;
}

export function tracksHtml(state) {
  const t = state.tracks;
  const pips = (n, total) => Array.from({ length: total }, (_, i) => `<div class="pip ${i < n ? 'on' : ''}"></div>`).join('');
  const scale = Math.max(10, t.welfare, t.knowledge, t.prosperity);
  const bar = (k) => `
    <div class="track ${k}">
      <div class="track-head"><span>${TRACKS[k]}</span><span class="track-value">${t[k]}</span></div>
      <div class="bar"><i style="width:${(t[k] / scale) * 100}%"></i></div>
    </div>`;
  return `
    <div class="track race">
      <div class="track-head"><span>Race</span><span class="track-value">${t.race} / ${state.limits.raceLimit}</span></div>
      <div class="pips">${pips(t.race, state.limits.raceLimit)}</div>
    </div>
    <div class="track oversight">
      <div class="track-head"><span>Oversight</span><span class="track-value">${t.oversight}</span></div>
      <div class="pips">${pips(t.oversight, state.limits.oversightStart)}</div>
    </div>
    ${WORLD.map(bar).join('')}`;
}

export function placementHtml(p) {
  if (!p) return '';
  const row = (label, o) => `<tr><td>${label}</td>${WORLD.map((k) => `<td class="mono">${o ? o[k] : ''}</td>`).join('')}</tr>`;
  return `
    <table>
      <tr><th></th>${WORLD.map((k) => `<th>${TRACKS[k]}</th>`).join('')}</tr>
      ${p.promise ? row('Promised for a Full grant', p.promise) : ''}
      ${row(`Placed (${p.tokens} token${p.tokens === 1 ? '' : 's'})`, p.placed)}
    </table>
    ${p.shift ? `<p>The AI shifted one token from ${TRACKS[p.shift.from]} to ${TRACKS[p.shift.to]}.</p>` : ''}
    ${p.moved ? `<p>The council moved one token from ${TRACKS[p.moved.from]} to ${TRACKS[p.moved.to]}.</p>` : ''}`;
}
