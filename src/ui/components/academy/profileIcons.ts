// Small stroke icons for the country profile (24px grid, currentColor). Static, trusted markup.

const PATHS = {
  capital: '<path d="M4 20h16"/><path d="M6 20V10"/><path d="M18 20V10"/><path d="M10 20v-6h4v6"/><path d="M3.5 10 12 4l8.5 6"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.3"/><path d="M15.8 14.2c2.2-.2 4.1 1.2 4.7 4.3"/>',
  area: '<path d="M4 8V4h4"/><path d="M16 4h4v4"/><path d="M20 16v4h-4"/><path d="M8 20H4v-4"/><path d="M9 12h6"/>',
  language: '<path d="M4 5h9v7H8l-3 3v-3H4z"/><path d="M13 9h7v7h-1v3l-3-3h-3v-3"/>',
  currency: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  demonym: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20c.8-4 3.5-6.5 7-6.5s6.2 2.5 7 6.5"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.2 6.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5S9.6 5.9 12 3.5z"/>',
  road: '<path d="M8 3 5 21"/><path d="M16 3l3 18"/><path d="M12 4v2.5"/><path d="M12 10.5v3"/><path d="M12 17.5V20"/>',
  coast: '<path d="M3 15c1.5 0 1.5-1.3 3-1.3s1.5 1.3 3 1.3 1.5-1.3 3-1.3 1.5 1.3 3 1.3 1.5-1.3 3-1.3 1.5 1.3 3 1.3"/><path d="M3 19.5c1.5 0 1.5-1.3 3-1.3s1.5 1.3 3 1.3 1.5-1.3 3-1.3 1.5 1.3 3 1.3 1.5-1.3 3-1.3 1.5 1.3 3 1.3"/><path d="M7 10.5 11 5l3 4 1.5-2L19 10.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  mountain: '<path d="M2.5 20 9 8l3.5 6 2-3.5L21.5 20z"/><path d="m7.4 11 1.6 1.4 1.4-1.2"/>',
  un: '<circle cx="12" cy="11" r="5.5"/><path d="M6.5 11h11"/><path d="M12 5.5c1.4 1.5 2 3.4 2 5.5s-.6 4-2 5.5c-1.4-1.5-2-3.4-2-5.5s.6-4 2-5.5z"/><path d="M4 12.5c.4 4 3.6 7.2 8 7.5 4.4-.3 7.6-3.5 8-7.5"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  arrowLeft: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  spark: '<path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/><path d="m18.4 5.6-2.8 2.8"/><path d="m8.4 15.6-2.8 2.8"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  shuffle: '<path d="M3 7h3.5c4.5 0 6.5 10 11 10H21"/><path d="M3 17h3.5c1.6 0 2.8-1.2 3.8-2.8"/><path d="M13.7 9.8C14.7 8.2 15.9 7 17.5 7H21"/><path d="m18 4 3 3-3 3"/><path d="m18 14 3 3-3 3"/>',
  cap: '<path d="M2.5 9.5 12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5v4.3c1.3 1.3 3.3 2.2 5.5 2.2s4.2-.9 5.5-2.2v-4.3"/><path d="M21.5 9.5v5"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
} as const;

export type ProfileIconName = keyof typeof PATHS;

export function profileIcon(name: ProfileIconName, className = "cp-icon"): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">${PATHS[name]}</svg>`;
  return span;
}
