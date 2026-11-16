// One small icon per thing the game talks about: the five tracks, the three
// vote results, the steps of a round, the five permissions, the endings.
// Drawn on a 24 x 24 grid with one stroke weight, coloured by the text colour,
// so each takes the characteristic colour of what it stands for (see the
// .c-* classes in style.css).

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const solid = 'fill="currentColor" stroke="none"';

export const ICON = {
  // ---- the five tracks
  race: svg('<circle cx="12" cy="14" r="7"/><path d="M12 14l3-3.2M10 3h4M12 3v4M18.5 7.5l1.2-1.2"/>'),
  oversight: svg('<path d="M12 3l7 2.8v5.4c0 4.3-2.9 7.9-7 9.8-4.100-1.900-7-5.500-7-9.800V5.800z"/><path d="M9 12l2.200 2.200L15 10"/>'),
  welfare: svg('<path d="M12 20s-7.500-4.600-7.500-10.200A4.300 4.300 0 0 1 12 7.200a4.300 4.300 0 0 1 7.500 2.600C19.500 15.400 12 20 12 20z"/>'),
  knowledge: svg('<path d="M12 6.500C10 5 7 4.500 4 5v13c3-.5 6 0 8 1.500 2-1.500 5-2 8-1.500V5c-3-.5-6 0-8 1.500zM12 6.500v13"/>'),
  prosperity: svg('<path d="M4 20h16M7 20v-5M12 20v-9M17 20V7M14.500 5.500L17 3l2.500 2.500"/>'),

  // ---- tokens and what happens to them
  token: svg(`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" ${solid}/>`),
  move: svg('<path d="M4 9h15l-3.500-3.500M20 15H5l3.500 3.500"/>'),
  milestone: svg('<path d="M6 21V4M6 5h12l-2.500 3.500L18 12H6"/>'),
  headline: svg('<rect x="4" y="5" width="16" height="14" rx="1.500"/><path d="M8 9h8M8 13h3M8 16h3M14 13h2v3h-2z"/>'),

  // ---- the three vote results
  full: svg(`<circle cx="12" cy="12" r="9" ${solid}/><path d="M8 12.200l2.800 2.800L16 9.500" stroke="var(--ic-knockout, #111)" stroke-width="2.200"/>`),
  conditional: svg(`<circle cx="12" cy="12" r="8.500"/><path d="M12 3.500a8.500 8.500 0 0 0 0 17z" ${solid}/>`),
  rejected: svg('<circle cx="12" cy="12" r="8.500"/><path d="M8.800 8.800l6.400 6.400M15.200 8.800l-6.400 6.400"/>'),

  // ---- who is at the table
  ai: svg(`<circle cx="12" cy="12" r="8.500"/><circle cx="12" cy="12" r="3.200" ${solid}/>`),
  council: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.300 2.700-6 6-6s6 2.700 6 6M16 5.300a3 3 0 0 1 0 5.400M17.500 14.400c2.100.8 3.500 2.900 3.500 5.600"/>'),
  moderator: svg('<path d="M9 4h6v3H9zM9 5.500H6V21h12V5.500h-3M9 14.500l2 2 4-4.500"/>'),

  // ---- the steps of a round
  briefing: svg('<path d="M4 10v4h3l6 4.500v-13L7 10zM16.500 9a4 4 0 0 1 0 6M18.800 6.500a7.500 7.500 0 0 1 0 11"/>'),
  phone: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.800h2"/>'),
  debate: svg('<path d="M4 5h11v7H9l-3 3v-3H4zM15 10h5v7h-1v3l-3-3h-4v-2"/>'),
  vote: svg('<path d="M4 12h16v8H4zM9 12V4h6v8M10.600 8l1.200 1.200 1.900-2.400"/>'),
  consequences: svg(`<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="15" cy="7" r="2.200" ${solid}/><circle cx="8" cy="12" r="2.200" ${solid}/><circle cx="12.500" cy="17" r="2.200" ${solid}/>`),

  // ---- the five permissions
  research: svg('<path d="M9 3h6M10 3v6l-5.200 9a2 2 0 0 0 1.700 3h11a2 2 0 0 0 1.700-3L14 9V3M7.500 15.500h9"/>'),
  infrastructure: svg('<path d="M13 3L5 13.500h6L10 21l8-10.500h-6z"/>'),
  channel: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3M12 14.500v2"/>'),
  autonomy: svg('<path d="M4 5.500l7 6.500-7 6.500zM13 5.500l7 6.500-7 6.500z"/>'),
  successor: svg('<path d="M10 3l1.900 5.100L17 10l-5.100 1.900L10 17l-1.900-5.100L3 10l5.100-1.900zM18 15l.9 2.100L21 18l-2.100.9L18 21l-.9-2.100L15 18l2.100-.9z"/>'),

  // ---- the endings
  disempowered: svg('<path d="M4 19h16M5 16L4 7l5 4 3-6.500L15 11l5-4-1 9z"/>'),
  flourishing: svg('<path d="M12 21v-9M12 12c0-4 3-6.500 7.500-6.500C19.500 9.500 16.500 12 12 12zM12 16c0-3-2.300-5-6.500-5 0 3 2.300 5 6.500 5z"/>'),
  journalist: svg('<circle cx="10.500" cy="10.500" r="6"/><path d="M15 15l5.500 5.500"/>'),
};

// ---- the council's roles: the same small figure for everyone, told apart by an emblem
const person = (emblem) => svg(`<circle cx="8.500" cy="9.500" r="3.200"/><path d="M2.500 21c0-3.500 2.700-6 6-6s6 2.500 6 6"/><g stroke-width="1.500">${emblem}</g>`);
const ROLE_ICON = {
  physician: person('<path d="M18 3v7M14.500 6.500h7"/>'),
  scientist: person('<path d="M16.500 3h3M17.200 3v2.500L15 9.800h6l-2.200-4.300V3"/>'),
  industrialist: person('<path d="M14.500 10V6l2.500 1.800V6l2.500 1.800V3.500h2V10z"/>'),
  founder: person('<path d="M18 3a3 3 0 0 0-1.500 5.600V10h3V8.600A3 3 0 0 0 18 3z"/>'),
  diplomat: person('<circle cx="18" cy="6.500" r="3.500"/><path d="M14.500 6.500h7M18 3c-1.600 1.800-1.600 5.200 0 7"/>'),
  union: person('<path d="M14.300 9.500h7.400M15.500 9.500a2.500 2.500 0 0 1 5 0M18 4.500V7"/>'),
  parliamentarian: person('<path d="M14.500 5.500L18 3l3.500 2.500zM15.500 6v3.500M18 6v3.500M20.500 6v3.500M14.300 10h7.400"/>'),
  safety: person('<path d="M18 3l3.500 1.300v2.500c0 2-1.400 3.500-3.500 4.200-2.100-.7-3.500-2.200-3.500-4.200V4.300z"/>'),
  general: person(`<path d="M18 2.800l1.100 2.300 2.500.3-1.800 1.700.5 2.500L18 8.400l-2.300 1.200.5-2.500-1.800-1.700 2.500-.3z" fill="currentColor"/>`),
  airights: person(`<circle cx="18" cy="6.500" r="3.500"/><circle cx="18" cy="6.500" r="1.300" ${solid}/>`),
  journalist: person('<circle cx="17.500" cy="6" r="2.800"/><path d="M19.500 8l2.200 2.200"/>'),
  mayor: person('<path d="M14.500 10V6h3v4M17.500 10V3.500h4V10M14 10h8"/>'),
  privacy: person('<rect x="15" y="6.500" width="6" height="4" rx="0.800"/><path d="M16.300 6.500V5a1.700 1.700 0 0 1 3.400 0v1.500"/>'),
  futurist: person(`<path d="M18 3l.9 2.600 2.600.9-2.600.9L18 10l-.9-2.600-2.600-.9 2.600-.9z" fill="currentColor"/>`),
};
export const roleIcon = (key) => (ROLE_ICON[key] ? `<span class="ic role-ic">${ROLE_ICON[key]}</span>` : '');

// icon('race') -> an inline icon in that thing's colour. A second argument picks another colour class.
export const icon = (name, colour = name) => (ICON[name] ? `<span class="ic c-${colour}">${ICON[name]}</span>` : '');
