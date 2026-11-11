import { GAME_MODE_GROUPS } from "../src/core/gameModes";
import { ACADEMY_TITLE, ATLAS_TITLE, DAILY_TITLE, MYSTERY_DAILY_TITLE, OVERLAND_DAILY_TITLE, gamePageTitle, LEADERBOARDS_TITLE, MULTIPLAYER_TITLE } from "../src/core/pageTitles";
import { PROFILE_COUNTRY_COUNT } from "../src/core/countries/profiles";
import { canonicalPath, countryFor, countryMeta, isIndexable, renderFallbackBody, structuredData } from "./seo";

// Link previews and search engines read the shell before the app runs, so the server fills in
// the page title, description and URL for each route (shared dailies, rooms, games, countries),
// plus the search parts from ./seo.ts.

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
    title: OVERLAND_DAILY_TITLE,
    description: "Link two countries by land, border by border. One route a day, the same for everyone. How short can you make it?",
  },
  mystery: {
    title: MYSTERY_DAILY_TITLE,
    description: "Find today's hidden country from distance clues. Everyone gets the same one. How few guesses do you need?",
  },
};

const VIEW_META: Record<string, PageMeta> = {
  atlas: {
    title: ATLAS_TITLE,
    description: `Browse all ${PROFILE_COUNTRY_COUNT} countries with their flags, capitals, outlines, populations and neighbours, then quiz yourself on them.`,
  },
  academy: {
    title: ACADEMY_TITLE,
    description: "Short lessons with spaced repetition that teach you the world's flags, capitals and countries, region by region.",
  },
  multiplayer: {
    title: MULTIPLAYER_TITLE,
    description: "Play live flag, map and capital quizzes against friends. Make a room, share the link, no sign-up needed.",
  },
  leaderboards: {
    title: LEADERBOARDS_TITLE,
    description: "Top scores for every Locato game: flags, capitals, outlines, map games and more.",
  },
};
VIEW_META.flags = VIEW_META.atlas!;

export function pageMetaFor(url: URL): PageMeta {
  const params = url.searchParams;
  const room = params.get("room")?.trim();
  if (room && /^[A-Za-z0-9]{3,12}$/.test(room)) {
    return { title: "Join my Locato game", description: `You're invited to a live multiplayer geography game. Tap to join room ${room.toUpperCase()}.` };
  }
  if (params.get("view") === "daily-challenge") {
    return {
      title: DAILY_TITLE,
      description: "Ten rounds of flags, maps, borders and Street View. The same puzzle for everyone today. Can you beat my score?",
    };
  }
  const country = countryFor(url);
  if (country) return countryMeta(country);
  const view = params.get("view");
  if (view && VIEW_META[view]) return VIEW_META[view]!;
  const game = params.get("game");
  if (game && params.get("daily") === "1" && DAILY_GAMES[game]) return DAILY_GAMES[game]!;
  const mode = game ? GAME_MODE_GROUPS.flatMap((group) => group.modes).find((entry) => entry.id === game) : undefined;
  if (mode) return { title: gamePageTitle(mode.label), description: `${mode.blurb} Play ${mode.label} free on Locato, with a new geography challenge every day. No sign-up needed.` };
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
  // Search: one canonical address per page, private pages kept out, content and links in #app.
  out = out.replace(/(<link rel="canonical" href=")[^"]*(")/, (_m, start: string, end: string) => `${start}${escapeAttribute(origin + canonicalPath(url))}${end}`);
  out = setContent(out, "name", "robots", isIndexable(url) ? "index, follow, max-image-preview:large" : "noindex, follow");
  out = out.replace("</head>", `${structuredData(url, origin)}</head>`);
  out = out.replace(/(<main id="app"[^>]*>)\s*(<\/main>)/, (_m, start: string, end: string) => `${start}${renderFallbackBody(url, meta)}${end}`);
  return out;
}
