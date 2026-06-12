import { describe, expect, it } from "vitest";
import { AuthService } from "../server/auth/AuthService";
import { createMemoryUserStore } from "../server/auth/memoryStore";
import { handleAuthRequest } from "../server/auth/routes";
import { parseCookieHeader, SESSION_COOKIE_NAME } from "../server/auth/cookies";
import type { PasswordHasher } from "../server/auth/types";
import type { SocialBridge, SocialServerMessage } from "../src/core/social/socialProtocol";

const fakeHasher: PasswordHasher = { hash: async (p) => `hashed:${p}`, verify: async (p, h) => h === `hashed:${p}` };
const COOKIE_OPTS = { secure: false };
const BASE_URL = "http://localhost:3000";

function createService() {
  const store = createMemoryUserStore();
  const service = new AuthService(store, fakeHasher, { sessionTtlMs: 3_600_000, clock: () => Date.now() });
  return { store, service };
}

async function makeUser(service: AuthService, username: string) {
  const r = await service.register({ email: `${username}@b.com`, password: "supersecret", displayName: username });
  if (!r.ok) throw new Error("register failed");
  return r.user;
}

function tokenFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected a Set-Cookie header.");
  const token = parseCookieHeader(setCookie)[SESSION_COOKIE_NAME];
  if (!token) throw new Error("Expected a session token.");
  return token;
}

function jsonRequest(path: string, method: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.cookie = `${SESSION_COOKIE_NAME}=${token}`;
  return new Request(`http://localhost${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

function route(service: AuthService, request: Request): Promise<Response | null> {
  return handleAuthRequest(request, new URL(request.url), service, COOKIE_OPTS, BASE_URL);
}

describe("friends service", () => {
  it("sends, accepts, and lists friends both ways", async () => {
    const { service } = createService();
    const alice = await makeUser(service, "alice");
    const bob = await makeUser(service, "bob");

    expect(service.sendFriendRequest(alice.id, "bob")).toBe("requested");
    expect(service.listFriendRequests(bob.id).incoming.map((r) => r.user.username)).toEqual(["alice"]);
    expect(service.listFriendRequests(alice.id).outgoing.map((r) => r.user.username)).toEqual(["bob"]);

    expect(service.acceptFriendRequest(bob.id, alice.id)).toBe(true);
    expect(service.areFriends(alice.id, bob.id)).toBe(true);
    expect(service.listFriends(alice.id).map((u) => u.username)).toEqual(["bob"]);
    expect(service.listFriends(bob.id).map((u) => u.username)).toEqual(["alice"]);
    expect(service.friendIds(alice.id)).toEqual([bob.id]);
    // No pending requests remain once accepted.
    expect(service.listFriendRequests(bob.id).incoming).toHaveLength(0);
  });

  it("auto-accepts a mutual request", async () => {
    const { service } = createService();
    const amy = await makeUser(service, "amy");
    const ben = await makeUser(service, "ben");
    expect(service.sendFriendRequest(amy.id, "ben")).toBe("requested");
    expect(service.sendFriendRequest(ben.id, "amy")).toBe("accepted");
    expect(service.areFriends(amy.id, ben.id)).toBe(true);
  });

  it("rejects self, duplicate, and unknown targets", async () => {
    const { service } = createService();
    const cara = await makeUser(service, "cara");
    await makeUser(service, "dora");
    expect(service.sendFriendRequest(cara.id, "cara")).toBe("self");
    expect(service.sendFriendRequest(cara.id, "ghost")).toBe("not-found");
    expect(service.sendFriendRequest(cara.id, "dora")).toBe("requested");
    expect(service.sendFriendRequest(cara.id, "dora")).toBe("exists");
  });

  it("removes the relationship on decline and on unfriend", async () => {
    const { service } = createService();
    const evan = await makeUser(service, "evan");
    const finn = await makeUser(service, "finn");

    service.sendFriendRequest(evan.id, "finn");
    expect(service.removeFriendship(finn.id, evan.id)).toBe(true); // finn declines
    expect(service.listFriendRequests(finn.id).incoming).toHaveLength(0);

    service.sendFriendRequest(evan.id, "finn");
    service.acceptFriendRequest(finn.id, evan.id);
    expect(service.areFriends(evan.id, finn.id)).toBe(true);
    expect(service.removeFriendship(evan.id, finn.id)).toBe(true); // unfriend
    expect(service.areFriends(evan.id, finn.id)).toBe(false);
  });

  it("cascades friendships when a user is deleted", async () => {
    const { service, store } = createService();
    const gwen = await makeUser(service, "gwen");
    const hank = await makeUser(service, "hank");
    service.sendFriendRequest(gwen.id, "hank");
    service.acceptFriendRequest(hank.id, gwen.id);
    store.deleteUser(gwen.id);
    expect(service.listFriends(hank.id)).toHaveLength(0);
    expect(service.friendIds(hank.id)).toHaveLength(0);
  });

  it("searches users by username, excluding self, with a public projection", async () => {
    const { service } = createService();
    const ivan = await makeUser(service, "ivan");
    await makeUser(service, "ivana");
    await makeUser(service, "boris");
    const results = service.searchUsers(ivan.id, "iva");
    expect(results.map((u) => u.username)).toEqual(["ivana"]);
    expect(results[0]).not.toHaveProperty("email");
    expect(results[0]).not.toHaveProperty("passwordHash");
  });
});

describe("friends routes", () => {
  it("adds and lists friends over HTTP, never leaking email", async () => {
    const { service } = createService();
    const aliceReg = await route(service, jsonRequest("/auth/register", "POST", { email: "alice@b.com", password: "supersecret", displayName: "alice" }));
    const aliceToken = tokenFrom(aliceReg!);
    await route(service, jsonRequest("/auth/register", "POST", { email: "bob@b.com", password: "supersecret", displayName: "bob" }));

    const send = await route(service, jsonRequest("/api/friends/requests", "POST", { username: "bob" }, aliceToken));
    expect(send?.status).toBe(200);
    expect((await send!.json()).status).toBe("requested");

    const list = await route(service, jsonRequest("/api/friends", "GET", undefined, aliceToken));
    const body = (await list!.json()) as { friends: unknown[]; outgoing: { user: Record<string, unknown> }[] };
    expect(body.outgoing[0]?.user.username).toBe("bob");
    expect(body.outgoing[0]?.user).not.toHaveProperty("email");
    expect(body.friends).toHaveLength(0);
  });

  it("rejects adding yourself and requires auth", async () => {
    const { service } = createService();
    const reg = await route(service, jsonRequest("/auth/register", "POST", { email: "solo@b.com", password: "supersecret", displayName: "solo" }));
    const token = tokenFrom(reg!);
    expect((await route(service, jsonRequest("/api/friends/requests", "POST", { username: "solo" }, token)))?.status).toBe(400);
    expect((await route(service, jsonRequest("/api/friends", "GET")))?.status).toBe(401);
  });

  it("invites an online friend and rejects non-friends", async () => {
    const { service } = createService();
    const alice = await service.register({ email: "alice@b.com", password: "supersecret", displayName: "alice" });
    const bob = await service.register({ email: "bob@b.com", password: "supersecret", displayName: "bob" });
    const carol = await service.register({ email: "carol@b.com", password: "supersecret", displayName: "carol" });
    if (!alice.ok || !bob.ok || !carol.ok) throw new Error("registration failed");
    service.sendFriendRequest(alice.user.id, "bob");
    service.acceptFriendRequest(bob.user.id, alice.user.id);

    const sent: { userId: string; message: SocialServerMessage }[] = [];
    const social: SocialBridge = { isOnline: () => true, notify: (userId, message) => sent.push({ userId, message }) };
    const routeWith = (request: Request) => handleAuthRequest(request, new URL(request.url), service, COOKIE_OPTS, BASE_URL, null, social);

    const ok = await routeWith(jsonRequest("/api/friends/invite", "POST", { userId: bob.user.id, roomCode: "ABCD" }, alice.session.id));
    expect(ok?.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: bob.user.id, message: { type: "GAME_INVITE", roomCode: "ABCD" } });

    const denied = await routeWith(jsonRequest("/api/friends/invite", "POST", { userId: carol.user.id, roomCode: "ABCD" }, alice.session.id));
    expect(denied?.status).toBe(403);
  });
});
