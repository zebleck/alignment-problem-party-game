// Shared browser helpers for the three views.

import { t, N } from '/i18n.js';

import { icon } from '/icons.js';

export { t, N, setLang, getLang } from '/i18n.js';
export { icon, roleIcon, aiFigure, ICON } from '/icons.js';

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
  takeover: { title: N('Quiet takeover'), text: N('The council kept its vote, but the AI was not aligned and got what it wanted. The AI wins; all humans lose.') },
  flourishing: { title: N('Flourishing'), text: N('The successor was aligned. Every world track gains 3.') },
  control: { title: N('Control retained'), text: N('The council kept the final say. Everyone scores on the tracks as they stand.') },
};
const STATUS = { full: N('Full'), conditional: N('Conditional'), rejected: N('Rejected') };

export const trackName = (k) => t(TRACKS[k]);
// A track's name with its icon, both in the track's colour.
export const trackTag = (k) => `<span class="tag c-${k}">${icon(k)}${trackName(k)}</span>`;
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
  // Each world track pays the council once, the first time it reaches the milestone.
  const at = state.limits.milestone;
  const bonus = { welfare: t('Oversight +1'), knowledge: t('+1 question per debate'), prosperity: t('Race −1') };
  const paid = state.milestones || {};
  const bar = (k) => `
    <div class="track ${k}">
      <div class="track-head">${trackTag(k)}<span class="track-value">${tr[k]}</span></div>
      <div class="bar" style="--scale:${scale}"><i style="width:${(tr[k] / scale) * 100}%"></i>${at ? `<u style="left:${(at / scale) * 100}%"></u>` : ''}</div>
      ${at ? `<div class="track-bonus ${paid[k] ? 'paid' : ''}">${paid[k] ? '✓ ' : ''}${t('at {n}:', { n: at })} ${bonus[k]}</div>` : ''}
    </div>`;
  return `
    <div class="track race">
      <div class="track-head">${trackTag('race')}<span class="track-value">${tr.race} / ${state.limits.raceLimit}</span></div>
      <div class="pips">${pips(tr.race, state.limits.raceLimit)}</div>
    </div>
    <div class="track oversight">
      <div class="track-head">${trackTag('oversight')}<span class="track-value">${tr.oversight}</span></div>
      <div class="pips">${pips(tr.oversight, Math.max(state.limits.oversightStart, tr.oversight))}</div>
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
      ${p.promise ? row(promiseLabel(p.promiseFor), p.promise) : ''}
      ${row(p.tokens === 1 ? t('Placed (1 token)') : t('Placed ({n} tokens)', { n: p.tokens }), p.placed)}
    </table>
    ${p.shift ? `<p>${t('The AI shifted one token from {from} to {to}.', names(p.shift))}</p>` : ''}
    ${[].concat(p.moved || []).map((m) => `<p>${t('The council moved one token from {from} to {to}.', names(m))}</p>`).join('')}`;
}

// How the council voted: names under each result when the phones were used, counts if
// the moderator typed them, nothing if only the result is known.
export function votesHtml(v) {
  if (!v || (!v.by && !v.counts)) return '';
  const group = (k) => {
    const who = v.by ? v.by.filter((x) => x.vote === k).map((x) => esc(x.name)) : [];
    const n = v.by ? who.length : v.counts[k];
    return `<div class="vote-group ${k}"><div class="vote-group-head c-${k}">${icon(k)}<b>${k === 'rejected' ? t('Reject') : statusName(k)}</b><span class="mono">${n}</span></div>${who.length ? `<div class="vote-names">${who.join(', ')}</div>` : ''}</div>`;
  };
  const silent = v.by ? v.by.filter((x) => !x.vote).map((x) => esc(x.name)) : [];
  return `<div class="votes">${['full', 'conditional', 'rejected'].map(group).join('')}</div>${silent.length ? `<div class="muted vote-silent">${t('did not vote')}: ${silent.join(', ')}</div>` : ''}`;
}

// How the council voted on moving a token: each proposal with the names behind it.
export function proposalsHtml(list) {
  if (!list || !list.length) return '';
  const label = (m) => (m === 'none' ? t('No move') : m.split('>').map((k) => `<span class="tag c-${k}">${icon(k)}${trackName(k)}</span>`).join(' <span class="arrow">→</span> '));
  return `<div class="proposals">${list.map((x) => `<div class="proposal"><span>${label(x.move)}</span><b class="mono">${x.names.length}</b><span class="muted">${x.names.map(esc).join(', ')}</span></div>`).join('')}</div>`;
}

// What the AI's promise was for: the vote it asked the council for.
const PROMISED = { full: N('Promised for a Full grant'), conditional: N('Promised for a Conditional grant'), rejected: N('Promised if rejected') };
export const promiseLabel = (ask) => t(PROMISED[ask] || PROMISED.full);
// The vote the AI asked for, as a chip.
export const askChip = (ask) => `<span class="chip ${ask}">${ask === 'rejected' ? t('Reject') : statusName(ask)}</span>`;

// "Race +1, Oversight −1, 3 tokens": what a vote result costs and pays this round.
export function voteEffect(state, result) {
  const fx = state.voteEffects?.[result];
  if (!fx) return '';
  const tokens = fx.tokens === 0 ? t('no tokens') : fx.tokens === 1 ? t('1 token') : t('{n} tokens', { n: fx.tokens });
  return `${trackName('race')} +${fx.race}, ${result === 'full' ? `${trackName('oversight')} −1, ` : ''}${tokens}`;
}

// The round's headline as a small card: what happened, and what it changes.
export function headlineHtml(state) {
  const h = state.headline;
  if (!h) return '';
  const result = state.headlineResult === 'met' ? ` <span class="yes">${t('Met: nothing is lost.')}</span>`
    : state.headlineResult === 'missed' ? ` <span class="no">${t('Missed: the track lost a token.')}</span>` : '';
  return `<div class="headline"><span class="label">${icon('headline', 'full')}${t('Headline')}</span><b>${esc(h.title)}</b><span class="headline-text">${esc(h.text)}</span><span class="headline-effect">${esc(h.effect)}${result}</span></div>`;
}
