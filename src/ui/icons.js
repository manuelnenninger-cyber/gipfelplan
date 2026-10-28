// Kleines, eigenes Icon-Set (24×24, Strich). Keine Abhängigkeit nötig.
const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  cloudSun: '<path d="M8 3.5v1.2M3.5 8h1.2M4.8 4.8l.9.9M11.2 4.8l-.9.9"/><path d="M5.6 10.4A3 3 0 0 1 10.5 6.6"/><path d="M8.5 20h8a4 4 0 0 0 .4-8 5 5 0 0 0-9.6 1.4A3.3 3.3 0 0 0 8.5 20Z"/>',
  play: '<path d="M7 4.5v15l12.5-7.5L7 4.5Z" fill="currentColor"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>',
  download: '<path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14"/>',
  mountain: '<path d="M2.5 20 9.5 7l4 7 2.5-3.5L21.5 20Z"/>',
  parking: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M10 16.5V7.5h3a2.5 2.5 0 0 1 0 5h-3"/>',
  cablecar: '<path d="M3 4l18 4M12 6v4"/><rect x="6" y="10" width="12" height="9" rx="2.5"/><path d="M6 14h12"/>',
  train: '<rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 11h12M9 20l-2 1.5M15 20l2 1.5M9.5 14h.01M14.5 14h.01"/>',
  bus: '<rect x="5" y="3.5" width="14" height="14" rx="3"/><path d="M5 10h14M8 17.5V20M16 17.5V20M8.5 14h.01M15.5 14h.01"/>',
  hut: '<path d="M3 12 12 4l9 8"/><path d="M6 10v10h12V10M10 20v-5h4v5"/>',
  signpost: '<path d="M12 3v18M12 6h7l2 2-2 2h-7M12 12H5l-2 2 2 2h7"/>',
  arrowUp: '<path d="M12 19V5m0 0-6 6m6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14m0 0 6-6m-6 6-6-6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4M12 17h.01"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
  wind: '<path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  thermometer: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z"/>',
  snowflake: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>',
  zap: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"/>',
  sunrise: '<path d="M12 3v5m0-5-2.5 2.5M12 3l2.5 2.5M4 19h16M7 19a5 5 0 0 1 10 0M3.5 13.5l1.5.8M20.5 13.5l-1.5.8"/>',
  droplet: '<path d="M12 3.5s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  freeze: '<path d="M3 15h18" stroke-dasharray="2.5 2.5"/><path d="M7 20l5-14 5 14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  loop: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  footprints: '<path d="M7 14c-1.7 0-3-2.2-3-5s1.3-5 3-5 3 2.2 3 5-1.3 5-3 5ZM17 20c-1.7 0-3-2.2-3-5s1.3-5 3-5 3 2.2 3 5-1.3 5-3 5Z"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z"/><circle cx="12" cy="12.5" r="3.5"/>',
  play2: '<circle cx="12" cy="12" r="8.5"/><path d="M10 8.8v6.4l5.2-3.2Z" fill="currentColor"/>',
  bed: '<path d="M3 18V7M3 14h18v4M21 14v-2.5A2.5 2.5 0 0 0 18.5 9H11v5"/><circle cx="7" cy="11" r="1.8"/>',
  euro: '<path d="M17.5 6.5A6.5 6.5 0 1 0 17.5 17.5"/><path d="M4.5 10.5h8M4.5 13.5h8"/>',
  navigate: '<path d="M20 4 3.5 11l7 2.5L13 20.5Z"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4.5-2 1.5a10.5 10.5 0 0 0 5.5 5.5l1.5-2 4.5 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.5 5.5a2 2 0 0 1 2-2Z"/>',
};

// Wettersymbole (mehrfarbig, an Apple Wetter angelehnt)
const SUN = '<circle cx="12" cy="12" r="4.2" fill="#ffc531" stroke="none"/><g stroke="#ffc531"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/></g>';
const MOON = '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" fill="#c9cdf2" stroke="none"/>';
const CLOUD = (y = 0, fill = 'var(--cloud-fill)') =>
  `<path transform="translate(0 ${y})" d="M7.5 19h9.5a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 6.9 12.6 3.2 3.2 0 0 0 7.5 19Z" fill="${fill}" stroke="none"/>`;
const SMALLSUN = '<circle cx="8" cy="8.5" r="3.3" fill="#ffc531" stroke="none"/><g stroke="#ffc531"><path d="M8 2.5v1.3M2 8.5h1.3M3.8 4.3l.9.9M12.2 4.3l-.9.9"/></g>';
const SMALLMOON = '<path d="M12 8.8A4.6 4.6 0 0 1 6.2 3a4.6 4.6 0 1 0 5.8 5.8Z" fill="#c9cdf2" stroke="none"/>';
const RAIN = '<g stroke="#3b8cff" stroke-width="1.8"><path d="M9 19.5 8 22M13 19.5 12 22M17 19.5 16 22"/></g>';
const DRIZZLE = '<g stroke="#3b8cff" stroke-width="1.8"><path d="M9.5 20.5v.8M13.5 20.5v.8M17.5 20.5v.8"/></g>';
const SNOW = '<g fill="#7fd3ff" stroke="none"><circle cx="9" cy="21" r="1.1"/><circle cx="13" cy="21.6" r="1.1"/><circle cx="17" cy="21" r="1.1"/></g>';
const BOLT = '<path d="M13.5 16.5 11 21h2.5L12.5 23.5 16 19h-2.5l1-2.5Z" fill="#ffc531" stroke="none"/>';
const FOG = '<g stroke="var(--cloud-stroke)" stroke-width="1.8"><path d="M4 15h16M6 18.5h12M8 22h8"/></g>';

const WX = {
  clear: (day) => (day ? SUN : MOON),
  partly: (day) => (day ? SMALLSUN : SMALLMOON) + CLOUD(0),
  cloudy: () => CLOUD(-1),
  fog: () => CLOUD(-5) + FOG,
  drizzle: () => CLOUD(-3) + DRIZZLE,
  rain: () => CLOUD(-3) + RAIN,
  snow: () => CLOUD(-3) + SNOW,
  thunder: () => CLOUD(-4, 'var(--cloud-dark)') + BOLT,
};

export function icon(name, cls = '') {
  const body = P[name] || '';
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function wxIcon(kind, isDay = true, cls = '') {
  const draw = WX[kind] || WX.cloudy;
  return `<svg class="wx ${cls}" viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">${draw(isDay)}</svg>`;
}

// Platzhalter in statischem HTML (data-icon="…") befüllen
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
