import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderPageMeta } from "../server/pageMeta";
import { canonicalPath, isIndexable, robotsTxt, sitemapPaths, sitemapXml, structuredData } from "../server/seo";

const at = (search: string) => new URL(`http://internal:3000/${search}`);
const shell = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("canonical addresses", () => {
  it("keeps only the params that pick the page", () => {
    expect(canonicalPath(at("?game=flags&resume=1&run=timed&ref=share"))).toBe("/?game=flags");
    expect(canonicalPath(at("?game=overland&daily=1&ref=share"))).toBe("/?game=overland&daily=1");
    expect(canonicalPath(at("?game=flags&daily=1"))).toBe("/?game=flags");
    expect(canonicalPath(at("?country=FR"))).toBe("/?country=fr");
    expect(canonicalPath(at("?view=flags"))).toBe("/?view=atlas");
    expect(canonicalPath(at("?view=leaderboards&mode=capitals&variant=x"))).toBe("/?view=leaderboards&mode=capitals");
    expect(canonicalPath(at("?utm_source=reddit"))).toBe("/");
    expect(canonicalPath(at("?game=nope"))).toBe("/");
  });

  it("keeps invites, private pages and unknown countries out of search", () => {
    expect(isIndexable(at("?country=fr"))).toBe(true);
    expect(isIndexable(at("?game=flags&resume=1"))).toBe(true);
    expect(isIndexable(at("?room=ab12"))).toBe(false);
    expect(isIndexable(at("?friend=sam"))).toBe(false);
    expect(isIndexable(at("?view=stats"))).toBe(false);
    expect(isIndexable(at("?view=academy&lesson=placement"))).toBe(false);
    expect(isIndexable(at("?country=zz"))).toBe(false);
  });
});

describe("robots.txt and sitemap", () => {
  it("points crawlers at the sitemap and away from the API", () => {
    const robots = robotsTxt("https://locato.quest");
    expect(robots).toContain("Sitemap: https://locato.quest/sitemap.xml");
    expect(robots).toContain("Disallow: /api/");
  });

  it("lists every country and game once, all canonical", () => {
    const paths = sitemapPaths();
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/?country=jp");
    expect(paths).toContain("/?game=capitals");
    expect(paths.filter((path) => path.startsWith("/?country=")).length).toBeGreaterThan(190);
    for (const path of paths) expect(canonicalPath(new URL(path, "https://locato.quest"))).toBe(path);
    expect(sitemapXml("https://locato.quest")).toContain("<loc>https://locato.quest/?game=overland&amp;daily=1</loc>");
  });
});

describe("rendered shell", () => {
  it("gives a country page its own title, canonical, content and breadcrumbs", () => {
    const out = renderPageMeta(shell, at("?country=jp&ref=share"), "https://locato.quest");
    expect(out).toContain("<title>Japan: flag, capital, map and facts · Locato</title>");
    expect(out).toContain(`<link rel="canonical" href="https://locato.quest/?country=jp">`);
    expect(out).toContain(`<meta name="robots" content="index, follow, max-image-preview:large">`);
    expect(out).toMatch(/<main id="app"[^>]*><div class="seo-fallback">.*<h1>Japan<\/h1>.*Tokyo/s);
    expect(out).toContain(`"@type":"BreadcrumbList"`);
  });

  it("noindexes room invites and links every game from the home page", () => {
    expect(renderPageMeta(shell, at("?room=ab12"), "https://locato.quest")).toContain(`<meta name="robots" content="noindex, follow">`);
    const home = renderPageMeta(shell, at(""), "https://locato.quest");
    expect(home).toContain(`href="/?game=flags"`);
    expect(home).toContain(`"@type":"VideoGame"`);
  });

  it("can't be broken out of by the JSON-LD", () => {
    expect(structuredData(at("?country=fr"), "https://x</script>")).not.toContain("</script><");
  });
});
