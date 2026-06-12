import { describe, expect, it } from "vitest";
import { SocialHub, type SocialConnection } from "../server/social/SocialHub";

function fakeConn(userId: string): SocialConnection & { sent: string[] } {
  const sent: string[] = [];
  return { userId, send: (data) => sent.push(data), sent };
}

function hubWith(friends: Record<string, string[]>): SocialHub {
  return new SocialHub((userId) => friends[userId] ?? []);
}

describe("SocialHub", () => {
  it("reports presence and notifies friends on connect and disconnect", () => {
    const hub = hubWith({ a: ["b"], b: ["a"] });
    const a = fakeConn("a");
    hub.attach(a);
    expect(hub.isOnline("a")).toBe(true);
    expect(JSON.parse(a.sent[0]!)).toEqual({ type: "PRESENCE_SNAPSHOT", onlineFriendIds: [] });

    const b = fakeConn("b");
    hub.attach(b);
    // b learns a is already online; a is told b just came online.
    expect(JSON.parse(b.sent[0]!)).toEqual({ type: "PRESENCE_SNAPSHOT", onlineFriendIds: ["a"] });
    expect(JSON.parse(a.sent[1]!)).toEqual({ type: "PRESENCE", userId: "b", online: true });

    hub.detach(b);
    expect(hub.isOnline("b")).toBe(false);
    expect(JSON.parse(a.sent[2]!)).toEqual({ type: "PRESENCE", userId: "b", online: false });
  });

  it("stays online until the last tab disconnects", () => {
    const hub = hubWith({ a: ["b"], b: ["a"] });
    const b = fakeConn("b");
    hub.attach(b);
    const a1 = fakeConn("a");
    const a2 = fakeConn("a");
    hub.attach(a1);
    hub.attach(a2); // a already online → no second online broadcast
    const bCount = b.sent.length;

    hub.detach(a1);
    expect(hub.isOnline("a")).toBe(true);
    expect(b.sent.length).toBe(bCount); // no offline event yet

    hub.detach(a2);
    expect(hub.isOnline("a")).toBe(false);
    expect(JSON.parse(b.sent.at(-1)!)).toEqual({ type: "PRESENCE", userId: "a", online: false });
  });

  it("delivers notify only to the target's own connections", () => {
    const hub = hubWith({});
    const a = fakeConn("a");
    hub.attach(a);
    const before = a.sent.length;
    hub.notify("a", { type: "FRIENDS_CHANGED" });
    expect(JSON.parse(a.sent.at(-1)!)).toEqual({ type: "FRIENDS_CHANGED" });
    hub.notify("ghost", { type: "FRIENDS_CHANGED" }); // offline target: no throw, no delivery
    expect(a.sent.length).toBe(before + 1);
  });
});
