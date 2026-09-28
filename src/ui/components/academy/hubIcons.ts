/** Small inline line icons for the Academy hub (static markup only). */
const ICONS = {
  flame: '<path d="M12 3c.6 3.2 3.9 5 3.9 9a3.9 3.9 0 0 1-7.8 0c0-1.6.7-2.8 1.6-3.8.2 1.4 1 2.3 2 2.6-.6-2.7-.4-5.3.3-7.8Z"/><path d="M8.3 14.8A4.6 4.6 0 0 0 12 21a5.6 5.6 0 0 0 5.6-5.6c0-1.3-.3-2.4-.9-3.4"/>',
  seal: '<path d="m12 2.8 2.2 1.6 2.7-.1.8 2.6 2.2 1.6-.9 2.6.9 2.6-2.2 1.6-.8 2.6-2.7-.1L12 21.2l-2.2-1.6-2.7.1-.8-2.6-2.2-1.6.9-2.6-.9-2.6 2.2-1.6.8-2.6 2.7.1Z"/><path d="m8.8 12.2 2.2 2.2 4.3-4.6"/>',
  review: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9"/><path d="M19.5 4v5h-5"/><path d="M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15"/><path d="M4.5 20v-5h5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1Z"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  twins: '<rect x="3.5" y="6" width="8" height="12" rx="1.5"/><rect x="12.5" y="6" width="8" height="12" rx="1.5"/><path d="M7.5 10v4M16.5 10v4"/>',
  back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
} as const;

export type HubIconName = keyof typeof ICONS;

export function hubIcon(name: HubIconName, className = "academy-icon"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  svg.innerHTML = ICONS[name];
  return svg;
}
