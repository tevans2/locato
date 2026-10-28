import { GAME_MODE_GROUPS } from "../src/core/gameModes";

// Link previews are read by crawlers that don't run the app, so the server fills in the page
// title, description and URL for the links people actually share: results, dailies and rooms.

export interface PageMeta {
  readonly title: string;
  readonly description: string;
}

const DEFAULT_META: PageMeta = {
  title: "Locato — A daily geography challenge",
  description: "A new geography challenge every day, plus flags, borders, maps and multiplayer. Free to play, no sign-up.",
};

const DAILY_GAMES: Readonly<Record<string, PageMeta>> = {
  overland: {
    title: "Locato Overland — today's route",
    description: "Link two countries by land, border by border. One route a day, the same for everyone. How short can you make it?",
  },
  mystery: {
    title: "Locato Mystery country — today's mystery",
    description: "Find today's hidden country from distance clues. Everyone gets the same one. How few guesses do you need?",
  },
};

function gameLabel(id: string): string | null {
  for (const group of GAME_MODE_GROUPS) {
    const mode = group.modes.find((entry) => entry.id === id);
    if (mode) return mode.label;
  }
  return null;
}

export function pageMetaFor(url: URL): PageMeta {
  const params = url.searchParams;
  const room = params.get("room")?.trim();
  if (room && /^[A-Za-z0-9]{3,12}$/.test(room)) {
    return { title: "Join my Locato game", description: `You're invited to a live multiplayer geography game. Tap to join room ${room.toUpperCase()}.` };
  }
  if (params.get("view") === "daily-challenge") {
    return {
      title: "Locato Daily — today's geography challenge",
      description: "Ten rounds of flags, maps, borders and Street View. The same puzzle for everyone today. Can you beat my score?",
    };
  }
  const game = params.get("game");
  if (game && params.get("daily") === "1" && DAILY_GAMES[game]) return DAILY_GAMES[game]!;
  const label = game ? gameLabel(game) : null;
  if (label) return { title: `${label} — Locato`, description: `Play ${label} on Locato, free geography games with a new challenge every day. No sign-up needed.` };
  return DEFAULT_META;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setContent(html: string, attribute: "property" | "name", key: string, value: string): string {
  const pattern = new RegExp(`(<meta ${attribute}="${key.replace(/[.:]/g, "\\$&")}" content=")[^"]*(")`);
  return html.replace(pattern, (_match, start: string, end: string) => `${start}${escapeAttribute(value)}${end}`);
}

/** index.html with this URL's preview tags. `origin` is the public origin (BASE_URL). */
export function renderPageMeta(html: string, url: URL, origin: string): string {
  const meta = pageMetaFor(url);
  // Shared links carry ?ref=share for analytics; the preview's canonical URL drops it.
  const canonical = new URL(url.pathname + url.search, origin);
  canonical.searchParams.delete("ref");
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttribute(meta.title)}</title>`);
  out = setContent(out, "property", "og:title", meta.title);
  out = setContent(out, "name", "twitter:title", meta.title);
  out = setContent(out, "name", "description", meta.description);
  out = setContent(out, "property", "og:description", meta.description);
  out = setContent(out, "name", "twitter:description", meta.description);
  out = setContent(out, "property", "og:url", canonical.toString());
  out = setContent(out, "property", "og:image", `${origin}/og-image.png`);
  out = setContent(out, "name", "twitter:image", `${origin}/og-image.png`);
  return out;
}
