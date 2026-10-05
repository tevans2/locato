import { afterEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { SESSION_COOKIE_NAME } from "../server/auth/cookies";
import { indexCountries, rawCountries } from "../src/core/countries";
import { LEADERBOARD_MODES } from "../src/core/leaderboards";
import { RankedGames } from "../server/ranked/RankedGames";
import { rankedWorld } from "../server/ranked/assets";
import { streetImage } from "../server/ranked/GameAssets";
import { scoreWorldSplit, buildWorldSplitCountries, WORLD_SPLIT_ROUNDS } from "../src/core/worldsplit";
import { parseDailyRoundResults } from "../src/core/dailyChallenge";
import { answerFor, privateChallenge, stateOf } from "./helpers/privateGame";

const small = indexCountries(rawCountries.filter((c) => ["FR", "BR"].includes(c.code)));
const clock = () => ({ value: Date.parse("2026-10-04T12:00:00Z") });
const resolver = async (frame: { lat: number; lng: number }) => ({ ...frame, panoId: "private-panorama-id" });
const hasher = { hash: async (p: string) => p, verify: async (p: string, h: string) => p === h };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function harness(full = false) {
  const time = clock(), store = createMemoryUserStore();
  const service = new AuthService(store, hasher, { sessionTtlMs: 3_600_000, clock: () => time.value, ranked: { countries: full ? indexCountries(rawCountries) : small, resolvePanorama: resolver } });
  const registration = await service.register({ email: "tester@test.local", password: "a-long-password", displayName: "tester" });
  if (!registration.ok) throw new Error(registration.error);
  const user = registration.user, token = registration.session.id;
  async function request(path: string, body?: unknown, extra?: Record<string, string>) {
    const req = new Request(`http://localhost${path}`, { method: body === undefined ? "GET" : "POST", headers: { cookie: `${SESSION_COOKIE_NAME}=${token}`, "content-type": "application/json", ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return (await handleAuthRequest(req, new URL(req.url), service, { secure: false }, "http://localhost"))!;
  }
  return { time, store, service, user, request };
}

describe("ranked authority", () => {
  it.each(LEADERBOARD_MODES.filter((config) => config.mode !== "flyover"))("rejects invented final values for $mode", async (config) => {
    const { request, service, user } = await harness();
    const response = await request("/api/leaderboard", { gameMode: config.mode, variant: config.variants[0], ...(config.metric === "time" ? { timeMs: 60_000 } : { score: config.maxScore }) });
    expect(response.status).toBe(400);
    expect(service.getUserLeaderboardRank(user.id, config.mode, config.variants[0]!)).toBeNull();
  });

  it.each(LEADERBOARD_MODES)("completes an actual server-owned $mode run and protects its result", async (config) => {
    const { time, service, user, request } = await harness(config.mode === "streetview-country" || config.mode === "puzzle");
    const variant = config.mode === "puzzle" ? "Europe" : config.variants[0]!;
    const start = await request("/api/ranked/start", { gameMode: config.mode, variant });
    expect(start.status).toBe(200);
    let state = stateOf(await start.json());
    expect(state.question).not.toHaveProperty("countryCode");
    expect(state).not.toHaveProperty("queue");
    expect(state).not.toHaveProperty("seed");
    expect(service.ranked.consume(user.id, state.runId, config.mode, variant, 0)).toBeNull();
    while (state.status === "playing") {
      time.value += config.mode === "flyover" ? 90_000 : 5_000;
      const response = await request("/api/ranked/action", { runId: state.runId, questionId: state.question?.id, ...(config.mode === "flyover" ? { type: "poll" } : answerFor(service.ranked, state)) });
      expect(response.status).toBe(200);
      state = stateOf(await response.json());
    }
    const value = config.metric === "time" ? state.timeMs : state.score;
    const body = { gameMode: config.mode, variant, runId: state.runId, ...(config.metric === "time" ? { timeMs: value } : { score: value }) };
    expect(service.ranked.consume("another-player", state.runId, config.mode, variant, value)).toBeNull();
    expect(service.ranked.consume(user.id, state.runId, config.mode, "wrong-variant", value)).toBeNull();
    expect(service.ranked.consume(user.id, state.runId, config.mode, variant, Number(value) + 1)).toBeNull();
    const posted = await request("/api/leaderboard", body);
    expect(posted.status).toBe(200);
    expect(await posted.json()).toMatchObject({ accepted: true, rank: 1 });
    // Retries after a lost HTTP response preserve the original best and do not refresh its timestamp.
    expect((await request("/api/leaderboard", body)).status).toBe(200);
    expect(service.getUserLeaderboardRank(user.id, config.mode, variant)).toMatchObject(config.metric === "time" ? { timeMs: value } : { score: value });
    time.value += 300_001;
    expect((await request("/api/leaderboard", body)).status).toBe(400);
  });

  it("rejects stale challenges, other owners, and malformed flight controls without delaying valid guesses", async () => {
    const { time, service, user } = await harness();
    let state = stateOf(await service.startRankedGame(user.id, { gameMode: "flags", variant: "" }));
    const oldId = state.question!.id;
    const answer = answerFor(service.ranked, state);
    expect(state.startedAt).toBeNull();
    time.value += 5000;
    expect(await service.ranked.action("wrong-owner", { runId: state.runId, questionId: oldId, ...answer })).toHaveProperty("error");
    state = stateOf(await service.ranked.action(user.id, { runId: state.runId, questionId: oldId, ...answer }));
    time.value += 1;
    expect(await service.ranked.action(user.id, { runId: state.runId, questionId: oldId, ...answer })).toHaveProperty("error");
    state = stateOf(await service.ranked.action(user.id, { runId: state.runId, questionId: state.question!.id, ...answerFor(service.ranked, state) }));
    expect(state.status).toBe("complete");
    expect(state.timeMs).toBe(1);
    state = stateOf(await service.startRankedGame(user.id, { gameMode: "flyover", variant: "" }));
    for (const input of [{ turn: 0, speed: 1000 }, { turn: 0, radius: 100 }, { turn: 0, x: 0, y: 0 }, { turn: 9 }, { turn: 0, towards: Infinity }, { turn: 0, boost: 6 }]) {
      expect(await service.ranked.action(user.id, { runId: state.runId, type: "input", input })).toHaveProperty("error");
    }
    expect(await service.ranked.action(user.id, { runId: state.runId, type: "reach", x: 0, y: 0, score: 196 })).toHaveProperty("error");
  });

  it("starts timed games on a submitted guess, ignores idle partial input and hints, and uses server time", async () => {
    const { time, service, user } = await harness();
    let state = stateOf(await service.startRankedGame(user.id, { gameMode: "flags", variant: "" }));
    time.value += 60_000;
    state = stateOf(await service.ranked.action(user.id, { runId: state.runId, questionId: state.question!.id, type: "answer", answer: "Sout", auto: true }));
    expect(state.startedAt).toBeNull();
    state = stateOf(await service.ranked.action(user.id, { runId: state.runId, questionId: state.question!.id, type: "hint" }));
    expect(state.startedAt).toBeNull();
    state = stateOf(await service.ranked.action(user.id, { runId: state.runId, questionId: state.question!.id, type: "skip" }));
    expect(state.startedAt).toBeNull();
    const firstGuessAt = time.value;
    state = stateOf(await service.ranked.action(user.id, { runId: state.runId, questionId: state.question!.id, type: "answer", answer: "Not a country", startedAt: firstGuessAt - 1_000_000 }));
    expect(state.startedAt).toBe(firstGuessAt);
    for (let i = 0; i < 2; i++) {
      time.value += 5_000;
      state = stateOf(await service.ranked.action(user.id, { runId: state.runId, questionId: state.question!.id, ...answerFor(service.ranked, state) }));
    }
    expect(state.timeMs).toBe(10_000);
  });

  it("expires idle runs from creation even when their timer has never started", async () => {
    const { time, service, user } = await harness();
    const state = stateOf(await service.startRankedGame(user.id, { gameMode: "flags", variant: "" }));
    expect(state.startedAt).toBeNull();
    time.value += 2 * 60 * 60 * 1000 + 1;
    expect(await service.ranked.action(user.id, { runId: state.runId, type: "poll" })).toMatchObject({ error: "This game expired. Start a new game." });
  });

  it("keeps masked flag pixels and asset ownership on the server", async () => {
    const { time, service, user } = await harness();
    let state = stateOf(await service.startRankedGame(user.id, { gameMode: "flag-colors", variant: "" }));
    const url = new URL(state.question!.asset!, "http://localhost");
    expect(url.pathname).not.toMatch(/fr|br|flags/);
    const response = await service.ranked.asset(user.id, state.runId, state.question!.id, url);
    const png = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
    expect(png.data.every((b) => b === 0)).toBe(true);
    expect((await service.ranked.asset("other", state.runId, state.question!.id, url)).status).toBe(404);
    const oldId = state.question!.id;
    time.value += 5000;
    state = stateOf(await service.ranked.action(user.id, { runId: state.runId, questionId: oldId, ...answerFor(service.ranked, state) }));
    expect((await service.ranked.asset(user.id, state.runId, oldId, url)).status).toBe(404);
  });

  it("recomputes split scores instead of accepting claimed percentages or scores", async () => {
    const { time, service, user } = await harness();
    const state = stateOf(await service.startRankedGame(user.id, { gameMode: "worldsplit", variant: "" }));
    const line = [[500, 0], [500, 500]] as const;
    time.value += 5000;
    const next = stateOf(await service.ranked.action(user.id, { runId: state.runId, questionId: state.question!.id, type: "line", line, score: 500, sideAPercent: 50 }));
    expect(next.score).toBe(scoreWorldSplit(buildWorldSplitCountries(rankedWorld()), WORLD_SPLIT_ROUNDS[0]!, line).score);
    expect(next.score).toBeLessThanOrEqual(100);
  });

  it("does not leak future locations or pano identifiers in Street View JSON", async () => {
    const { service, user } = await harness();
    for (const mode of ["geoguessr", "streetview-country"]) {
      const state = stateOf(await service.startRankedGame(user.id, { gameMode: mode, variant: "" }));
      const json = JSON.stringify(state);
      for (const forbidden of ["panoId", '"lat"', '"lng"', "countryCode", "private-panorama-id", "maps.googleapis.com"]) expect(json).not.toContain(forbidden);
      expect(state.question!.frames!.every((frame) => /^\/api\/ranked\/[a-f0-9]{48}\/asset\/[a-f0-9]{48}\?frame=\d+$/.test(frame.asset))).toBe(true);
    }
  });

  it("rejects cross-site writes and oversized controls", async () => {
    const { request } = await harness();
    expect((await request("/api/ranked/start", { gameMode: "flags", variant: "" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await request("/api/ranked/action", { runId: "x", payload: "x".repeat(5000) })).status).toBe(413);
    expect((await request("/api/games", { mode: "multiplayer", categoryIds: ["flags"], score: 999, correctAnswers: 99, wrongAnswers: 0, bestStreak: 99, rank: 1, totalPlayers: 8 })).status).toBe(400);
  });

  it("cancels a run when preparing a private challenge fails", async () => {
    const time = clock(); let calls = 0;
    const games = new RankedGames({ clock: () => time.value, resolvePanorama: async (frame) => { if (++calls > 1) throw new Error("offline"); return resolver(frame); } });
    const state = stateOf(await games.start("player", { gameMode: "geoguessr", variant: "" }));
    time.value += 5000;
    expect(await games.action("player", { runId: state.runId, questionId: state.question!.id, ...answerFor(games, state) })).toHaveProperty("error");
    expect(await games.action("player", { runId: state.runId, type: "poll" })).toHaveProperty("error");
  });
});

it("scores and saves a themed daily on the server, with private review details and one attempt", async () => {
  const { time, service, store, user, request } = await harness(true);
  const date = "2026-10-04";
  let state = stateOf(await service.startRankedGame(user.id, { gameMode: "daily", variant: date }));
  const first = privateChallenge(service.ranked, state);
  expect(await service.startRankedGame("other", { gameMode: "daily", variant: "2026-99-99" })).toHaveProperty("error");
  time.value += 5000;
  state = stateOf(await service.ranked.action(user.id, { runId: state.runId, questionId: state.question!.id, type: "answer", answer: first.country!.name === "Brazil" ? "France" : "Brazil" }));
  expect(state.index).toBe(0);
  const resumed = stateOf(await service.startRankedGame(user.id, { gameMode: "daily", variant: date }));
  expect(resumed.runId).toBe(state.runId);
  const restartedServer = new AuthService(store, hasher, { sessionTtlMs: 3_600_000, clock: () => time.value });
  expect(await restartedServer.startRankedGame(user.id, { gameMode: "daily", variant: date })).toHaveProperty("error");
  while (state.status === "playing") {
    time.value += 5000;
    state = stateOf(await service.ranked.action(user.id, { runId: state.runId, questionId: state.question!.id, ...answerFor(service.ranked, state) }));
  }
  expect(state.total).toBe(10);
  expect(state.score).toBe(98);
  const result = await request("/api/daily", { runId: state.runId, score: 100, timeMs: 1, hintsUsed: 0 });
  expect(result.status).toBe(200);
  const saved = (await result.json()).result;
  expect(saved.score).toBe(98);
  expect(saved.timeMs).toBe(55_000);
  expect(parseDailyRoundResults(saved.rounds)).toEqual(saved.rounds);
  expect(saved.rounds[0]).toMatchObject({ points: 8, wrongGuesses: 1 });
  const publicBoard = await request(`/api/daily/leaderboard?date=${date}`);
  expect((await publicBoard.json()).entries[0].result).not.toHaveProperty("rounds");
  expect((await request("/api/daily", { runId: state.runId })).status).toBe(200);
  expect(await service.startRankedGame(user.id, { gameMode: "daily", variant: date })).toHaveProperty("error");
});

it("proxies only four bounded Street View directions, deduplicates fetches, and strips metadata", async () => {
  vi.stubEnv("GOOGLE_MAPS_STREETVIEW_STATIC_API_KEY", "test-private-key");
  // JPEG header, EXIF with a location marker, then SOS + entropy + EOI.
  const raw = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 6, 71, 80, 83, 33, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(raw, { headers: { "content-type": "image/jpeg" } }));
  const frame = { lat: 41.234567, lng: 11.987654, heading: 27, label: "private test view" };
  const url = new URL("http://localhost/api/game-assets/test?turn=90");
  const results = await Promise.all([streetImage(frame, url), streetImage(frame, url)]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await results[0]!.text()).not.toContain("GPS!");
  expect(results[0]!.headers.get("location")).toBeNull();
  expect(results[0]!.headers.get("cache-control")).toContain("no-store");
  expect((await streetImage(frame, new URL("http://localhost/api/game-assets/test?turn=91"))).status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
