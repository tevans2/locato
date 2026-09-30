import { describe, expect, it } from "vitest";
import { buildRouteUrl, routeFromLocation, type AppRoute } from "../src/app/router";
import { gameModeOptions, isPromptGameModeId, isWorldMapGameModeId } from "../src/core/gameModes";

const parse = (url: string) => routeFromLocation(new URL(url, "https://locato.test"));

describe("shareable game routes", () => {
  it.each(gameModeOptions)("keeps $id selected after a refresh", ({ id }) => {
    const route: AppRoute = isPromptGameModeId(id)
      ? { type: "solo-game", categoryIds: [id], continueSaved: true }
      : isWorldMapGameModeId(id) ? { type: "country-guessing", mode: id } : { type: id };
    expect(parse(buildRouteUrl(route, { pathname: "/" }))).toEqual(route);
  });

  it("distinguishes a fresh shared game from resuming a saved run", () => {
    expect(parse("/?game=shapes")).toEqual({ type: "solo-game", categoryIds: ["shapes"], continueSaved: false });
    expect(parse("/?game=shapes&resume=1")).toEqual({ type: "solo-game", categoryIds: ["shapes"], continueSaved: true });
  });

  it("preserves mixed prompt categories and filters invalid category IDs", () => {
    const route: AppRoute = { type: "solo-game", categoryIds: ["flags", "capitals"], continueSaved: true };
    expect(parse(buildRouteUrl(route, { pathname: "/play" }))).toEqual(route);
    expect(parse("/?game=flags&categories=invalid,capitals")).toMatchObject({ categoryIds: ["capitals"] });
  });

  it("round-trips the selected flag source and ignores invalid values", () => {
    const route: AppRoute = { type: "solo-game", categoryIds: ["flags"], continueSaved: true, flagPool: "both" };
    expect(parse(buildRouteUrl(route, { pathname: "/" }))).toEqual(route);
    expect(parse("/?game=flags&flagPool=territories")).toMatchObject({ flagPool: "territories" });
    expect(parse("/?game=flags&flagPool=invalid")).toEqual({ type: "solo-game", categoryIds: ["flags"], continueSaved: false });
  });

  it.each<AppRoute>([
    { type: "multiplayer", joinCode: "ABC 123" },
    { type: "friends", username: "curious_explorer" },
    { type: "daily-challenge" },
    { type: "stats" },
    { type: "atlas" },
    { type: "friends" },
    { type: "multiplayer" },
    { type: "compete" },
    { type: "compete", mode: "flags", variant: "timer" },
    { type: "compete", tab: "leaderboards" },
    { type: "compete", tab: "leaderboards", mode: "puzzle", variant: "Europe" },
    { type: "multiplayer", create: true },
    { type: "multiplayer", create: true, invite: "u-42" },
    { type: "country-guessing", mode: "puzzle", run: "timed", continent: "Africa" },
    { type: "academy" },
    { type: "academy", groupId: "western-europe" },
    { type: "academy-lesson", lessonId: "review" },
    { type: "academy-lesson", lessonId: "lookalikes:FR" },
    { type: "academy-placement" },
    { type: "country-profile", code: "FR" },
  ])("preserves $type links", (route) => {
    expect(parse(buildRouteUrl(route, { pathname: "/" }))).toEqual(route);
  });

  it("handles unknown or empty routes without constructing invalid screens", () => {
    expect(parse("/?game=unknown")).toBeNull();
    expect(parse("/?view=unknown")).toBeNull();
    expect(parse("/?room=%20")).toBeNull();
    expect(parse("/?view=leaderboard&mode=unknown")).toEqual({ type: "compete", tab: "leaderboards" });
    expect(parse("/?country=france")).toBeNull();
    expect(parse("/?view=academy&group=Bad%20Id")).toEqual({ type: "academy" });
    expect(buildRouteUrl({ type: "landing" }, { pathname: "/" })).toBe("/");
  });

  it("keeps old leaderboard and flag links working as Compete and Atlas", () => {
    expect(parse("/?view=leaderboard")).toEqual({ type: "compete", tab: "leaderboards" });
    expect(parse("/?view=leaderboard&mode=capitals&variant=Europe")).toEqual({ type: "compete", tab: "leaderboards", mode: "capitals", variant: "Europe" });
    expect(parse("/?view=flags")).toEqual({ type: "atlas" });
    // Legacy route types still build the new URLs.
    expect(buildRouteUrl({ type: "leaderboard", mode: "flags" }, { pathname: "/" })).toBe("/?view=compete&mode=flags");
    expect(buildRouteUrl({ type: "flag-gallery" }, { pathname: "/" })).toBe("/?view=atlas");
  });

  it("opens Compete on Multiplayer unless the Leaderboards tab (or a board) is named", () => {
    expect(parse("/?view=compete")).toEqual({ type: "compete" });
    expect(parse("/?view=compete&tab=multiplayer")).toEqual({ type: "compete" });
    expect(parse("/?view=compete&tab=bogus")).toEqual({ type: "compete" });
    expect(parse("/?view=compete&tab=leaderboards")).toEqual({ type: "compete", tab: "leaderboards" });
    // Old board links carry only a mode; the screen reads a mode as the Leaderboards tab.
    expect(parse("/?view=compete&mode=flags")).toEqual({ type: "compete", mode: "flags" });
    expect(buildRouteUrl({ type: "compete", tab: "leaderboards", mode: "flags" }, { pathname: "/" })).toBe("/?view=compete&tab=leaderboards&mode=flags");
    expect(buildRouteUrl({ type: "compete" }, { pathname: "/" })).toBe("/?view=compete");
  });

  it("builds quick-create multiplayer links and validates the invite id", () => {
    expect(buildRouteUrl({ type: "multiplayer", create: true, invite: "u-42" }, { pathname: "/" })).toBe("/?view=multiplayer&create=1&invite=u-42");
    expect(parse("/?view=multiplayer&create=0")).toEqual({ type: "multiplayer" });
    expect(parse("/?view=multiplayer&create=1&invite=%3Cscript%3E")).toEqual({ type: "multiplayer", create: true });
    // A room code always wins: it's a join, not a create.
    expect(parse("/?room=ABCDE&view=multiplayer&create=1")).toEqual({ type: "multiplayer", joinCode: "ABCDE" });
  });

  it("carries the timed run type on game URLs", () => {
    // Timed runs never resume a save, so their URL has no resume flag.
    const solo: AppRoute = { type: "solo-game", categoryIds: ["capitals"], continueSaved: false, run: "timed" };
    expect(buildRouteUrl(solo, { pathname: "/" })).toBe("/?game=capitals&run=timed");
    expect(parse(buildRouteUrl(solo, { pathname: "/" }))).toEqual(solo);
    const map: AppRoute = { type: "country-guessing", mode: "puzzle", run: "timed" };
    expect(buildRouteUrl(map, { pathname: "/" })).toBe("/?game=puzzle&run=timed");
    expect(parse(buildRouteUrl(map, { pathname: "/" }))).toEqual(map);
    // Practice is the default and never written; unknown run values are ignored.
    expect(parse("/?game=puzzle&run=practice")).toEqual({ type: "country-guessing", mode: "puzzle" });
    expect(parse("/?game=flags&run=bogus")).toEqual({ type: "solo-game", categoryIds: ["flags"], continueSaved: false });
  });

  it("carries a ranked attempt on the score modes' URLs (and on flag colours' timed run)", () => {
    for (const mode of ["map-tap", "worldsplit", "flyover", "geoguessr", "streetview-country"] as const) {
      const ranked: AppRoute = { type: mode, run: "timed" };
      expect(buildRouteUrl(ranked, { pathname: "/" })).toBe(`/?game=${mode}&run=timed`);
      expect(parse(`/?game=${mode}&run=timed`)).toEqual(ranked);
      expect(parse(`/?game=${mode}`)).toEqual({ type: mode });
      expect(buildRouteUrl({ type: mode }, { pathname: "/" })).toBe(`/?game=${mode}`);
    }
    const flagColours: AppRoute = { type: "solo-game", categoryIds: ["flag-colors"], continueSaved: false, run: "timed" };
    expect(buildRouteUrl(flagColours, { pathname: "/" })).toBe("/?game=flag-colors&run=timed");
    expect(parse("/?game=flag-colors&run=timed")).toEqual(flagColours);
  });
});
