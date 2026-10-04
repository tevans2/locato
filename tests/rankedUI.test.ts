// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createRankedGameScreen } from "../src/ui/screens/RankedGameScreen";
import type { Screen } from "../src/app/router";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { SESSION_COOKIE_NAME } from "../server/auth/cookies";
import { rankedWorld } from "../server/ranked/assets";
import { indexCountries, rawCountries } from "../src/core/countries";
import { answerFor, privateChallenge } from "./helpers/privateGame";
import type { RankedState } from "../src/core/ranked";
import type { GameModeId } from "../src/core/gameModes";
import type { ShellContext } from "../src/ui/shell/types";
import * as globe from "../src/ui/components/MapTapGlobe";
import * as geoMap from "../src/ui/components/GeoGuessMap";
import * as mapTap from "../src/core/maptap";

const screens: Screen[] = [];
afterEach(() => { for (const s of screens.splice(0)) s.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); localStorage.clear(); });

async function setup(mode: GameModeId, full = false) {
  let now = 100_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const countries = indexCountries(rawCountries.filter((c) => full || ["FR", "BR"].includes(c.code)));
  const store = createMemoryUserStore();
  const service = new AuthService(store, { hash: async (p) => p, verify: async (p, h) => p === h }, { clock: () => now, sessionTtlMs: 3_600_000, ranked: { countries, resolvePanorama: async (p) => ({ ...p, panoId: "private-panorama" }) } });
  const registration = await service.register({ email: "ui@test.local", password: "long-password", displayName: "tester" });
  if (!registration.ok) throw new Error(registration.error);
  let latest: RankedState | null = null;
  const fetcher = vi.fn(async (path: string, init: RequestInit) => {
    const request = new Request(`http://localhost${path}`, init);
    const get = request.headers.get.bind(request.headers);
    vi.spyOn(request.headers, "get").mockImplementation((name) => name === "cookie" ? `${SESSION_COOKIE_NAME}=${registration.session.id}` : get(name));
    const response = (await handleAuthRequest(request, new URL(request.url), service, { secure: false }, "http://localhost"))!;
    if (path.startsWith("/api/ranked/") && response.ok) latest = await response.clone().json();
    return response;
  });
  vi.stubGlobal("fetch", fetcher);
  const shell: ShellContext = { signedIn: () => true, controls: document.createElement("div"), openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openLeaderboards() {}, openAccount() {}, confirmLeave: async () => true };
  const screen = await createRankedGameScreen({ mode, shell, world: rankedWorld(), storage: localStorage, countryIndex: countries, getAuthUser: () => registration.user }); screens.push(screen); document.body.append(screen.element);
  expect(screen.element.querySelector(".verified-content")).toBeNull();
  const $ = <T extends Element = HTMLElement>(selector: string) => screen.element.querySelector<T>(selector)!;
  const button = (text: string) => [...screen.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
  const advance = (ms = 5000) => { now += ms; };
  const posted = () => vi.waitFor(() => expect($(".shell-results-sub")?.textContent).toContain("Posted to the leaderboard"));
  return { screen, $, button, fetcher, service, store, user: registration.user, countries, advance, state: () => latest!, answer: () => answerFor(service.ranked, latest!), posted };
}

it.each(["flags", "flag-colors", "shapes", "codes", "capitals", "capital-recall"] as const)("uses the original %s form and posts only its completed server receipt", async (mode) => {
  const ui = await setup(mode);
  expect(ui.screen.element.classList.contains("solo-game-screen")).toBe(true);
  expect(ui.$(".play-layout > .flag-card")).not.toBeNull();
  expect(ui.$(".play-layout > .answer-panel .guess-form")).not.toBeNull();
  for (let index = 0; index < 2; index++) {
    ui.advance();
    ui.$<HTMLInputElement>("#guess-input").value = ui.answer().answer!;
    ui.button("Enter").click(); ui.button("Enter").click(); // A double Enter must not answer the next clue.
    await vi.waitFor(() => expect(ui.state().index).toBe(index + 1));
  }
  await ui.posted();
  const body = JSON.parse(ui.fetcher.mock.calls.find(([path]) => path === "/api/leaderboard")![1].body as string);
  expect(body).toEqual({ gameMode: mode, variant: "", timeMs: 10_000, runId: ui.state().runId });
  expect(ui.service.getUserLeaderboardRank(ui.user.id, mode, "")).toEqual({ rank: 1, timeMs: 10_000 });
  expect(ui.store.getStats(ui.user.id).totalGames).toBe(1);
  ui.service.submitLeaderboardAttempt(ui.user.id, body);
  expect(ui.store.getStats(ui.user.id).totalGames).toBe(1);
});

it("keeps Hint and Pass working without exposing the upcoming answer", async () => {
  const ui = await setup("flags");
  const original = ui.state().question!.id;
  ui.advance(); ui.button("Hint").click();
  await vi.waitFor(() => expect(ui.state().hints).toBe(1));
  expect(ui.state().question).not.toHaveProperty("countryCode");
  ui.advance(); ui.button("Pass").click();
  await vi.waitFor(() => expect(ui.state().question!.id).not.toBe(original));
  expect(ui.state().index).toBe(0);
  expect(ui.state().hints).toBe(0);
  for (let i = 0; i < 2; i++) {
    ui.advance(); ui.$<HTMLInputElement>("#guess-input").value = ui.answer().answer!; ui.button("Enter").click();
    await vi.waitFor(() => expect(ui.state().index).toBe(i + 1));
  }
  await ui.posted();
  ui.$<HTMLButtonElement>(".shell-results-primary").click();
  await vi.waitFor(() => expect(ui.state().runId).not.toBe(JSON.parse(ui.fetcher.mock.calls.find(([p]) => p === "/api/leaderboard")![1].body as string).runId));
  expect(ui.$<HTMLInputElement>("#guess-input").disabled).toBe(false);
});

it.each(["name-all", "spot-country", "click-country"] as const)("keeps the original %s map and completes with server-accepted guesses", async (mode) => {
  const ui = await setup(mode);
  expect(ui.$(".answer-panel")).not.toBeNull();
  expect(ui.$(".world-map-svg")).not.toBeNull();
  for (let i = 0; i < 2; i++) {
    ui.advance();
    if (mode === "click-country") {
      const code = privateChallenge(ui.service.ranked, ui.state()).country!.code;
      ui.$(`.world-map-country[data-country-id='${ui.countries.byCode.get(code)!.id}']`).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    } else {
      ui.$<HTMLInputElement>("#guess-input").value = ui.answer().answer!;
      ui.$<HTMLFormElement>(".guess-form").dispatchEvent(new Event("submit", { cancelable: true }));
    }
    await vi.waitFor(() => expect(ui.state().index).toBe(i + 1));
    if (mode === "spot-country" && i === 0) await vi.waitFor(() => expect(ui.$<HTMLInputElement>("#guess-input").disabled).toBe(false));
  }
  await ui.posted();
});

it("uses the original Worldsplit controls, round review and recap", async () => {
  const ui = await setup("worldsplit");
  for (let i = 0; i < 5; i++) {
    ui.advance(); ui.$<HTMLButtonElement>(".worldsplit-adjust-button").click();
    const [lock, next] = [...ui.screen.element.querySelectorAll<HTMLButtonElement>(".worldsplit-primary")];
    lock!.click(); lock!.click();
    await vi.waitFor(() => expect(ui.$(".worldsplit-result-callout strong")?.textContent).toMatch(/\+\d+ points/));
    next!.click();
  }
  await ui.posted();
  expect(ui.screen.element.querySelectorAll(".gb-run-row")).toHaveLength(5);
});

it("uses MapTap's globe, per-pin review and ten-target results, including a fresh restart", async () => {
  let choose: (p: { lat: number; lng: number }) => void = () => {};
  vi.spyOn(globe, "createMapTapGlobe").mockImplementation((options) => { choose = options.onGuess; return { element: document.createElement("div"), reset() {}, reveal() {}, revealMultiplayer() {}, setAcceptingGuesses() {}, destroy() {} }; });
  vi.spyOn(mapTap, "fetchWikipediaSummary").mockResolvedValue(null);
  const ui = await setup("map-tap");
  expect(ui.$(".maptap-play-panel")).not.toBeNull();
  for (let i = 0; i < 10; i++) {
    await vi.waitFor(() => expect(ui.$(".maptap-status")?.textContent).not.toContain("Loading"));
    ui.advance(); const answer = ui.answer(); choose({ lat: answer.lat!, lng: answer.lng! });
    await vi.waitFor(() => expect(ui.$<HTMLElement>(".maptap-result-panel").hidden).toBe(false));
    ui.$<HTMLButtonElement>(".maptap-result-panel .primary-action").click();
  }
  await ui.posted();
  expect(ui.service.getUserLeaderboardRank(ui.user.id, "map-tap", "")).toMatchObject({ score: 50_000 });
  const runId = ui.state().runId;
  ui.$<HTMLButtonElement>(".shell-results-primary").click();
  await vi.waitFor(() => expect(ui.state().runId).not.toBe(runId));
  expect(ui.state().index).toBe(0);
});

it("uses GeoGuessr's original panorama, pin controls and five-round recap with private imagery", async () => {
  let choose: (p: { lat: number; lng: number }) => void = () => {};
  vi.spyOn(geoMap, "createGeoGuessMap").mockImplementation((options) => { choose = options.onGuessChange; return { element: document.createElement("div"), reset() {}, reveal() {}, setAcceptingGuesses() {}, resize() {}, destroy() {} }; });
  const ui = await setup("geoguessr");
  for (let i = 0; i < 5; i++) {
    await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe("playing"));
    expect(ui.$(".geo-panorama .private-street-image").getAttribute("src")).toMatch(/^\/api\/ranked\//);
    ui.advance(); const answer = ui.answer(); choose({ lat: answer.lat!, lng: answer.lng! }); ui.$<HTMLButtonElement>(".geo-lock").click();
    await vi.waitFor(() => expect(ui.screen.element.dataset.phase).toBe("result"));
    ui.$<HTMLButtonElement>(".geo-result-card .geo-primary").click();
  }
  await ui.posted();
  expect(ui.service.getUserLeaderboardRank(ui.user.id, "geoguessr", "")).toMatchObject({ score: 25_000 });
  expect(ui.screen.element.querySelectorAll(".geo-recap-row")).toHaveLength(5);
});

it("uses Street View's original side panel and country guesses without location-bearing embeds", async () => {
  const ui = await setup("streetview-country", true);
  expect(ui.$(".streetview-layout > .streetview-panel .streetview-guess-form")).not.toBeNull();
  for (let i = 0; i < 5; i++) {
    await vi.waitFor(() => expect(ui.$<HTMLInputElement>("#streetview-guess-input").disabled).toBe(false));
    expect(ui.$(".private-street-image").getAttribute("src")).toMatch(/^\/api\/ranked\//);
    expect([...ui.screen.element.querySelectorAll("iframe")].every((frame) => !frame.getAttribute("src"))).toBe(true);
    ui.advance(); ui.$<HTMLInputElement>("#streetview-guess-input").value = ui.countries.byCode.get(ui.answer().answer!)!.name;
    ui.$<HTMLFormElement>(".streetview-guess-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(ui.state().index).toBe(i + 1));
  }
  await ui.posted();
  expect(ui.service.getUserLeaderboardRank(ui.user.id, "streetview-country", "")).toMatchObject({ score: 15 });
});

it("keeps Flyover's Take off screen and ends at the server deadline", async () => {
  const ui = await setup("flyover");
  expect(ui.fetcher.mock.calls.some(([path]) => path === "/api/ranked/start")).toBe(false);
  expect(ui.$(".flyover-ready")).not.toBeNull();
  ui.button("Take off").click();
  await vi.waitFor(() => expect(ui.state()?.mode).toBe("flyover"));
  ui.advance(90_000);
  await ui.posted();
  expect(ui.service.getUserLeaderboardRank(ui.user.id, "flyover", "")).toMatchObject({ score: 0 });
});

it("keeps the puzzle tray and accuracy check, and refuses to post misplaced pieces", async () => {
  const ui = await setup("puzzle");
  const board = ui.$<SVGSVGElement>(".puzzle-board-svg");
  expect(board).not.toBeNull();
  Object.assign(board, {
    getScreenCTM: () => ({ inverse: () => ({}) }),
    createSVGPoint: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }),
  });
  const piece = ui.$<SVGPathElement>(".puzzle-country-piece");
  const nums = [...piece.getAttribute("d")!.matchAll(/-?\d+(?:\.\d+)?/g)].map(([n]) => Number(n));
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const drop = (target: Element, dx: number) => {
    ui.advance();
    target.dispatchEvent(new PointerEvent("pointerdown", { clientX: x + dx, clientY: y, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: x + dx, clientY: y }));
    window.dispatchEvent(new PointerEvent("pointerup"));
  };
  drop(ui.$(".puzzle-piece-card"), 40);
  await vi.waitFor(() => expect(ui.state().result?.kind).toBe("placement"));
  ui.advance(); ui.button("Check accuracy").click();
  await vi.waitFor(() => expect(ui.$(".feedback")?.textContent).toContain("outside the correct position"));
  expect(ui.state().status).toBe("playing");
  expect(ui.fetcher.mock.calls.some(([p]) => p === "/api/leaderboard")).toBe(false);
  // Reposition the visible piece from its current centre to its correct one.
  ui.advance();
  piece.dispatchEvent(new PointerEvent("pointerdown", { clientX: x + 40, clientY: y, bubbles: true }));
  window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y }));
  window.dispatchEvent(new PointerEvent("pointerup"));
  await vi.waitFor(() => expect(ui.fetcher.mock.calls.filter(([p]) => p === "/api/ranked/action")).toHaveLength(3));
  ui.advance(); ui.button("Check accuracy").click();
  await ui.posted();
  expect(ui.state().status).toBe("complete");
});
