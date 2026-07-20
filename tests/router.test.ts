import { describe, expect, it } from "vitest";
import { routeFromLocation, routeUrl, type AppRoute } from "../src/app/router";

function location(pathname: string, search = ""): Pick<Location, "pathname" | "search"> {
  return { pathname, search };
}

describe("shareable app routes", () => {
  const routes: readonly AppRoute[] = [
    { type: "landing" },
    { type: "daily-challenge" },
    { type: "solo-game", categoryIds: ["flags"] },
    { type: "country-guessing", mode: "click-country" },
    { type: "streetview-country" },
    { type: "map-tap" },
    { type: "multiplayer", joinCode: "ABCDE" },
    { type: "stats" },
    { type: "progress" },
    { type: "friends", username: "atlas-pal" },
    { type: "leaderboard", mode: "puzzle", variant: "Africa" },
  ];

  it.each(routes)("round-trips $type through a URL", (route) => {
    const url = new URL(routeUrl(route), "https://locato.test");
    expect(routeFromLocation(location(url.pathname, url.search))).toEqual(route);
  });

  it("keeps legacy room invite query links working", () => {
    expect(routeFromLocation(location("/", "?room=QWERT"))).toEqual({ type: "multiplayer", joinCode: "QWERT" });
  });

  it("falls back to the landing page for unknown routes", () => {
    expect(routeFromLocation(location("/somewhere-else"))).toEqual({ type: "landing" });
    expect(routeFromLocation(location("/play/%E0%A4%A"))).toEqual({ type: "landing" });
  });
});
