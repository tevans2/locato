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

  it.each<AppRoute>([
    { type: "multiplayer", joinCode: "ABC 123" },
    { type: "friends", username: "curious_explorer" },
    { type: "daily-challenge" },
    { type: "stats" },
    { type: "friends" },
    { type: "multiplayer" },
    { type: "leaderboard", mode: "flags", variant: "timer" },
  ])("preserves $type links", (route) => {
    expect(parse(buildRouteUrl(route, { pathname: "/" }))).toEqual(route);
  });

  it("handles unknown or empty routes without constructing invalid screens", () => {
    expect(parse("/?game=unknown")).toBeNull();
    expect(parse("/?view=unknown")).toBeNull();
    expect(parse("/?room=%20")).toBeNull();
    expect(parse("/?view=leaderboard&mode=unknown")).toEqual({ type: "leaderboard" });
    expect(buildRouteUrl({ type: "landing" }, { pathname: "/" })).toBe("/");
  });
});
