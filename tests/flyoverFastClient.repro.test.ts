// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { SESSION_COOKIE_NAME } from "../server/auth/cookies";

afterEach(() => {
  (window as any).flyoverFastClient?.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("the delivered standalone client cannot post its altered flight through the authenticated player's real leaderboard handler and restores the original screen", async () => {
  let time = 100_000;
  let frames: FrameRequestCallback[] = [];
  let timer: (() => void) | undefined;
  let nextTick = Infinity;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("location", new URL("http://localhost:3000/?game=flyover"));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("setInterval", (callback: () => void, ms: number) => { timer = callback; nextTick = time + ms; return 1; });
  vi.stubGlobal("clearInterval", () => { timer = undefined; });
  const store = createMemoryUserStore();
  const service = new AuthService(store, {
    hash: async (password) => `test:${password}`,
    verify: async (password, hash) => hash === `test:${password}`,
  }, { sessionTtlMs: 3_600_000, clock: () => time });
  const registered = await service.register({ email: "fast-client@example.test", password: "test-password", displayName: "fast_client" });
  if (!registered.ok) throw new Error("Could not register test player");
  const token = registered.session.id;
  const user = registered.user;
  const world = JSON.parse(readFileSync(resolve("public/assets/world-map.json"), "utf8"));
  const fetchMap = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/assets/world-map.json") return new Response(JSON.stringify(world), { status: 200 });
    if (!["/auth/me", "/api/leaderboard"].includes(url)) throw new Error(`Unexpected network request: ${url}`);
    const headers = new Headers(init?.headers);
    const request = new Request(`http://localhost:3000${url}`, { ...init, headers });
    // Happy DOM strips forbidden request headers; emulate the browser's session cookie at the server boundary.
    const getHeader = request.headers.get.bind(request.headers);
    vi.spyOn(request.headers, "get").mockImplementation((name) => name.toLowerCase() === "cookie"
      ? `${SESSION_COOKIE_NAME}=${token}`
      : getHeader(name));
    const response = await handleAuthRequest(request, new URL(request.url), service, { secure: false }, "http://localhost:3000");
    if (!response) throw new Error("Request was not handled");
    return response;
  });
  vi.stubGlobal("fetch", fetchMap);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  class Context {
    constructor(readonly canvas: HTMLCanvasElement) {}
    arc(..._args: number[]) {}
    rotate(_angle: number) {}
  }
  vi.stubGlobal("CanvasRenderingContext2D", Context);
  class Path { moveTo() {} lineTo() {} closePath() {} }
  vi.stubGlobal("Path2D", Path);
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    if (!contexts.has(this)) contexts.set(this, new Proxy(new Context(this), {
      get(target, property) { return Reflect.has(target, property) ? Reflect.get(target, property) : () => undefined; },
    }) as unknown as CanvasRenderingContext2D);
    return contexts.get(this)!;
  } as unknown as HTMLCanvasElement["getContext"]);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON() {} });
  document.body.innerHTML = '<div id="app"><section class="flyover-screen"><div class="flyover-stage"></div></section></div>';
  const original = document.querySelector(".flyover-screen");
  const originalArc = Context.prototype.arc;
  const originalRotate = Context.prototype.rotate;
  const originalSend = WebSocket.prototype.send;
  new Function(readFileSync(resolve("scripts/flyover-fast-client.js"), "utf8"))();
  await vi.waitFor(() => {
    if (errors.mock.calls.length) throw errors.mock.calls[0]?.[1];
    expect((window as any).flyoverFastClient).toBeDefined();
  });
  const api = (window as any).flyoverFastClient;
  expect(api.settings).toMatchObject({ speed: expect.any(Number), touchRadius: 6.6, durationSeconds: 90 });
  document.querySelector<HTMLButtonElement>(".flyover-start")!.click();
  for (let elapsed = 0; elapsed < 90_100; elapsed += 1000 / 60) {
    time += 1000 / 60;
    const run = frames;
    frames = [];
    for (const frame of run) frame(time);
    if (timer && time + 1e-6 >= nextTick) { nextTick += 50; timer(); }
  }
  await vi.waitFor(() => expect(api.status().posting?.failed).toBe(true));
  expect(errors).not.toHaveBeenCalled();
  expect(api.status().lastScore).toBeGreaterThanOrEqual(150);
  expect(api.status().currentScore).toBe(api.status().lastScore);
  const posts = fetchMap.mock.calls.filter(([url]) => url === "/api/leaderboard");
  expect(posts).toHaveLength(1);
  expect(posts[0]![1]?.method).toBe("POST");
  expect(JSON.parse(posts[0]![1]!.body as string)).toEqual({ gameMode: "flyover", variant: "", score: api.status().lastScore });
  expect(service.getUserLeaderboardRank(user.id, "flyover", "")).toBeNull();
  expect(document.querySelector(".shell-results-sub")?.textContent).toContain("Couldn't post");
  console.log(JSON.stringify({ deliveredScriptScore: api.status().lastScore, clockSeconds: 90, leaderboardRequests: posts.length, serverAccepted: false }));
  api.restore();
  expect(document.querySelector("#app > .flyover-screen")).toBe(original);
  expect(Context.prototype.arc).toBe(originalArc);
  expect(Context.prototype.rotate).toBe(originalRotate);
  expect(WebSocket.prototype.send).toBe(originalSend);
}, 20_000);

it("requires a signed-in session before replacing the original screen", async () => {
  vi.stubGlobal("location", new URL("http://localhost:3000/?game=flyover"));
  const fetchAuth = vi.fn(async () => new Response(JSON.stringify({ error: "Not authenticated." }), { status: 401 }));
  vi.stubGlobal("fetch", fetchAuth);
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  document.body.innerHTML = '<div id="app"><section class="flyover-screen"><div class="flyover-stage"></div></section></div>';
  const original = document.querySelector(".flyover-screen");
  new Function(readFileSync(resolve("scripts/flyover-fast-client.js"), "utf8"))();
  await vi.waitFor(() => expect(errors).toHaveBeenCalled());
  expect(String(errors.mock.calls[0]?.[1])).toContain("Sign in to Locato");
  expect(fetchAuth).toHaveBeenCalledExactlyOnceWith("/auth/me");
  expect(document.querySelector("#app > .flyover-screen")).toBe(original);
});
