// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createVerifiedGameScreen } from "../src/ui/screens/VerifiedGameScreen";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { SESSION_COOKIE_NAME } from "../server/auth/cookies";
import { rankedWorld } from "../server/ranked/assets";
import { indexCountries, rawCountries } from "../src/core/countries";
import { answerFor } from "./helpers/privateGame";
import type { RankedState } from "../src/core/ranked";
import type { ShellContext } from "../src/ui/shell/types";

const screens: ReturnType<typeof createVerifiedGameScreen>[] = [];
afterEach(() => { for (const s of screens.splice(0)) s.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("plays through the real ranked UI, submits the server receipt, and records one game on retry", async () => {
  let now = 100_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const store = createMemoryUserStore();
  const service = new AuthService(store, { hash: async (p) => p, verify: async (p, h) => p === h }, { clock: () => now, sessionTtlMs: 3_600_000, ranked: { countries: indexCountries(rawCountries.filter((c) => ["FR", "BR"].includes(c.code))) } });
  const registration = await service.register({ email: "ui@test.local", password: "long-password", displayName: "tester" });
  if (!registration.ok) throw new Error(registration.error);
  let latest: RankedState | null = null;
  const fetcher = vi.fn(async (path: string, init: RequestInit) => {
    const request = new Request(`http://localhost${path}`, init);
    const get = request.headers.get.bind(request.headers);
    vi.spyOn(request.headers, "get").mockImplementation((name) => name === "cookie" ? `${SESSION_COOKIE_NAME}=${registration.session.id}` : get(name));
    const response = (await handleAuthRequest(request, new URL(request.url), service, { secure: false }, "http://localhost"))!;
    if (path.startsWith("/api/ranked/")) latest = await response.clone().json();
    return response;
  });
  vi.stubGlobal("fetch", fetcher);
  const shell: ShellContext = { signedIn: () => true, controls: document.createElement("div"), openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openCompete() {}, openAccount() {}, confirmLeave: async () => true };
  const screen = createVerifiedGameScreen({ mode: "flags", shell, world: rankedWorld() }); screens.push(screen); document.body.append(screen.element);
  const button = (text: string) => [...screen.element.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text)!;
  button("Start").click();
  await vi.waitFor(() => expect(screen.element.querySelector("input")).not.toBeNull());
  for (let index = 0; index < 2; index++) {
    now += 5000;
    const answer = answerFor(service.ranked, latest!);
    screen.element.querySelector<HTMLInputElement>("input")!.value = answer.answer!;
    button("Submit").click();
    await vi.waitFor(() => expect(latest!.index).toBe(index + 1));
  }
  await vi.waitFor(() => expect(screen.element.querySelector(".shell-results-sub")?.textContent).toContain("Posted to the leaderboard"));
  const body = JSON.parse(fetcher.mock.calls.find(([path]) => path === "/api/leaderboard")![1].body as string);
  expect(body).toEqual({ gameMode: "flags", variant: "", timeMs: 10_000, runId: latest!.runId });
  expect(service.getUserLeaderboardRank(registration.user.id, "flags", "")).toEqual({ rank: 1, timeMs: 10_000 });
  expect(store.getStats(registration.user.id).totalGames).toBe(1);
  service.submitLeaderboardAttempt(registration.user.id, body);
  expect(store.getStats(registration.user.id).totalGames).toBe(1);
});
