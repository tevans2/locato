import { GAME_MODE_GROUPS, type GameModeCatalogueEntry } from "../src/core/gameModes";
import { countryPageTitle } from "../src/core/pageTitles";
import { allCountryProfiles, formatArea, formatPopulation, getCountryProfile, neighboursOf, type CountryProfile } from "../src/core/countries/profiles";

// Search engines see the app shell before any script runs. This module gives every URL the parts
// a crawler reads: a canonical address (the app's query-string routes carry lots of state that
// mustn't split one page into many), a robots verdict, some real content and links inside #app
// (the app replaces it on mount), structured data, robots.txt and a sitemap.

/** Views worth a search result. Personal or throwaway ones (stats, friends, rooms) are noindex. */
const INDEXABLE_VIEWS = new Set(["daily-challenge", "atlas", "academy", "multiplayer", "leaderboards"]);
const NOINDEX_VIEWS = new Set(["stats", "friends", "daily-practice"]);
const DAILY_GAMES = new Set(["overland", "mystery"]);

const GAME_MODES: readonly GameModeCatalogueEntry[] = GAME_MODE_GROUPS.flatMap((group) => group.modes);
const GAME_IDS = new Set<string>(GAME_MODES.map((mode) => mode.id));

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The country profile a URL opens, or null. */
export function countryFor(url: URL): CountryProfile | null {
  const code = url.searchParams.get("country")?.trim();
  return code && /^[a-z]{2}$/i.test(code) ? getCountryProfile(code) : null;
}

/**
 * The one address a page should be indexed under: only the params that pick the page survive,
 * so `?game=flags&resume=1&run=timed&ref=share` and `?game=flags` count as the same page.
 */
export function canonicalPath(url: URL): string {
  const params = url.searchParams;
  const out = new URLSearchParams();
  const country = countryFor(url);
  const game = params.get("game");
  const view = params.get("view") === "flags" ? "atlas" : params.get("view");
  if (country) out.set("country", country.code.toLowerCase());
  else if (params.has("country")) out.set("country", params.get("country")!.trim().toLowerCase());
  else if (game && GAME_IDS.has(game)) {
    out.set("game", game);
    if (DAILY_GAMES.has(game) && params.get("daily") === "1") out.set("daily", "1");
  } else if (view && INDEXABLE_VIEWS.has(view)) {
    out.set("view", view);
    const mode = params.get("mode");
    if (view === "leaderboards" && mode && GAME_IDS.has(mode)) out.set("mode", mode);
    const group = params.get("group")?.trim();
    if (view === "academy" && group && /^[a-z0-9-]{1,64}$/.test(group) && !params.has("lesson")) out.set("group", group);
  }
  const search = out.toString();
  return search ? `/?${search}` : "/";
}

/** False for invites, private pages and unknown countries: they stay out of search results. */
export function isIndexable(url: URL): boolean {
  const params = url.searchParams;
  if (params.has("room") || params.has("friend") || params.has("lesson") || params.get("create") === "1") return false;
  if (params.has("country") && !countryFor(url)) return false;
  const view = params.get("view");
  return !(view && NOINDEX_VIEWS.has(view));
}

export function robotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /auth/",
    "Disallow: /admin",
    // Room and friend links stay crawlable: link-preview bots (X's among them) obey robots.txt,
    // and those pages carry noindex instead.
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

/** Every page worth indexing, as canonical paths. */
export function sitemapPaths(): readonly string[] {
  return [
    "/",
    "/?view=daily-challenge",
    "/?game=overland&daily=1",
    "/?game=mystery&daily=1",
    ...GAME_MODES.map((mode) => `/?game=${mode.id}`),
    "/?view=atlas",
    "/?view=academy",
    "/?view=multiplayer",
    "/?view=leaderboards",
    ...allCountryProfiles().map((profile) => `/?country=${profile.code.toLowerCase()}`),
  ];
}

export function sitemapXml(origin: string): string {
  const urls = sitemapPaths().map((path) => `  <url><loc>${escapeHtml(origin + path)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

// ---- Page content for crawlers -------------------------------------------------------------

function trimTo(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function listSentence(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Title and description for a country page: the facts people search for. */
export function countryMeta(profile: CountryProfile): { title: string; description: string } {
  const population = profile.populationMillions === null ? "" : ` Population ${formatPopulation(profile.populationMillions)}.`;
  return {
    title: countryPageTitle(profile.name),
    description: trimTo(`${profile.name} is in ${profile.subregion || profile.continent}. Capital: ${profile.capital}.${population} ${profile.hook} Learn its flag and shape, then test yourself.`, 200),
  };
}

const NAV_LINKS: readonly [string, string][] = [
  ["/?view=daily-challenge", "Daily challenge"],
  ["/?view=atlas", "Atlas of every country"],
  ["/?view=academy", "Academy"],
  ["/?view=multiplayer", "Multiplayer"],
  ["/?view=leaderboards", "Leaderboards"],
];

function link(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
}

function gamesList(): string {
  const groups = GAME_MODE_GROUPS.map((group) => {
    const items = group.modes.map((mode) => `<li>${link(`/?game=${mode.id}`, mode.label)}: ${escapeHtml(mode.blurb)}</li>`).join("");
    return `<h2>${escapeHtml(group.label)} games</h2><p>${escapeHtml(group.tagline)}</p><ul>${items}</ul>`;
  });
  return groups.join("");
}

function countryLinks(profiles: readonly CountryProfile[]): string {
  return `<ul class="seo-columns">${profiles.map((p) => `<li>${link(`/?country=${p.code.toLowerCase()}`, p.name)}</li>`).join("")}</ul>`;
}

function countryBody(profile: CountryProfile): string {
  const facts: [string, string][] = [
    ["Capital", profile.capital],
    ["Region", profile.subregion ? `${profile.subregion} (${profile.continent})` : profile.continent],
    ["Population", formatPopulation(profile.populationMillions)],
    ["Area", formatArea(profile.areaKm2)],
    ["Languages", profile.languages.join(", ")],
    ["Currency", profile.currencies.map((c) => c.name).join(", ")],
    ["Drives on the", profile.drivingSide],
  ];
  if (profile.callingCode) facts.push(["Calling code", profile.callingCode]);
  if (profile.highestPoint) facts.push(["Highest point", `${profile.highestPoint.name}, ${profile.highestPoint.metres.toLocaleString("en-US")} m`]);
  const neighbours = neighboursOf(profile.code);
  const name = escapeHtml(profile.name);
  return [
    `<h1>${name}</h1>`,
    `<p>${escapeHtml(profile.hook)}</p>`,
    `<img src="/${escapeHtml(profile.flagSrc)}" alt="Flag of ${name}" width="240" height="160">`,
    `<h2>Flag of ${name}</h2><p>${escapeHtml(profile.flagNote)}</p>`,
    `<h2>${name} at a glance</h2><dl>${facts.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>`,
    `<h2>Facts about ${name}</h2><ul>${profile.funFacts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>`,
    profile.landmarks.length ? `<h2>Famous places</h2><p>${escapeHtml(listSentence(profile.landmarks))}.</p>` : "",
    neighbours.length
      ? `<h2>Countries bordering ${name}</h2>${countryLinks(neighbours)}`
      : `<h2>Borders</h2><p>${name} has no land borders with other countries.</p>`,
    `<h2>Test yourself</h2><ul><li>${link("/?game=flags", "Flags quiz")}</li><li>${link("/?game=shapes", "Country outlines quiz")}</li><li>${link("/?game=capital-recall", "Capitals quiz")}</li><li>${link("/?game=click-country", "Find it on the map")}</li></ul>`,
  ].join("");
}

/**
 * Plain HTML for #app: what crawlers (and anyone waiting on the script) see. It matches what
 * the app renders for that page, and links every page so a crawler can find them all.
 */
export function renderFallbackBody(url: URL, meta: { title: string; description: string }): string {
  const country = countryFor(url);
  const view = url.searchParams.get("view");
  let main: string;
  if (country) main = countryBody(country);
  else if (view === "atlas" || view === "flags") {
    main = `<h1>Atlas of every country</h1><p>Flags, capitals, maps and facts for all ${allCountryProfiles().length} countries.</p>${countryLinks([...allCountryProfiles()].sort((a, b) => a.name.localeCompare(b.name)))}`;
  } else main = `<h1>${escapeHtml(meta.title.replace(/ [·—|] Locato$/, ""))}</h1><p>${escapeHtml(meta.description)}</p>${gamesList()}`;
  const nav = `<nav aria-label="Locato">${link("/", "Locato")} · ${NAV_LINKS.map(([href, text]) => link(href, text)).join(" · ")}</nav>`;
  return `<div class="seo-fallback">${nav}${main}</div>`;
}

/** JSON-LD for the page, or "" when none fits. */
export function structuredData(url: URL, origin: string): string {
  const country = countryFor(url);
  let data: unknown;
  if (country) {
    data = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Locato", item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: "Atlas", item: `${origin}/?view=atlas` },
        { "@type": "ListItem", position: 3, name: country.name, item: `${origin}/?country=${country.code.toLowerCase()}` },
      ],
    };
  } else if (canonicalPath(url) === "/") {
    data = [
      { "@context": "https://schema.org", "@type": "WebSite", name: "Locato", url: `${origin}/` },
      {
        "@context": "https://schema.org",
        "@type": "VideoGame",
        name: "Locato",
        url: `${origin}/`,
        description: "A daily geography challenge plus flags, capitals, borders, maps, Street View and multiplayer games.",
        genre: ["Geography quiz", "Trivia", "Educational game"],
        gamePlatform: "Web browser",
        playMode: ["SinglePlayer", "MultiPlayer"],
        applicationCategory: "GameApplication",
        operatingSystem: "Any",
        image: `${origin}/og-image.png`,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ];
  } else return "";
  // `<` escaped so a value can never close the script tag.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}
