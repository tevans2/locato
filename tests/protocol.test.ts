import { describe, expect, it } from "vitest";
import { parseClientMessage, parseServerMessage, type PublicRoundState, type ServerMessage } from "../src/core/multiplayer";

describe("multiplayer public protocol", () => {
  it("does not expose answers in public round state", () => {
    const round: PublicRoundState = {
      roundNumber: 1,
      prompt: { kind: "image", value: "assets/flags/jp.svg" },
      startedAt: 1000,
      endsAt: null,
    };

    expect(Object.keys(round).sort()).toEqual(["endsAt", "prompt", "roundNumber", "startedAt"]);
  });

  it("rejects public round messages that include private country identity", () => {
    const message = parseServerMessage({
      type: "ROUND_STARTED",
      round: {
        roundNumber: 1,
        prompt: { kind: "image", value: "assets/flags/jp.svg" },
        startedAt: 1000,
        endsAt: null,
        countryName: "Japan",
      },
    });

    expect(message.ok).toBe(false);
  });

  it("normalizes safe client room inputs", () => {
    const message = parseClientMessage({ type: "JOIN_ROOM", roomCode: " pin42 ", playerName: "  Ada   Lovelace " });

    expect(message.ok).toBe(true);
    expect(message.ok ? message.message : null).toEqual({ type: "JOIN_ROOM", roomCode: "PIN42", playerName: "Ada Lovelace" });
  });

  it("requires at least one category to create a room", () => {
    expect(parseClientMessage({ type: "CREATE_ROOM", playerName: "Ada", categoryIds: [] }).ok).toBe(false);
    const message = parseClientMessage({ type: "CREATE_ROOM", playerName: "Ada", categoryIds: ["flags", "codes"] });
    expect(message.ok).toBe(true);
    expect(message.ok ? message.message : null).toEqual({ type: "CREATE_ROOM", playerName: "Ada", categoryIds: ["flags", "codes"] });
  });

  it("accepts bounded private room settings", () => {
    const message = parseClientMessage({ type: "CREATE_ROOM", playerName: "Ada", categoryIds: ["flags"], roundLimit: 15, roundDurationMs: 45_000 });

    expect(message.ok).toBe(true);
    expect(message.ok ? message.message : null).toEqual({ type: "CREATE_ROOM", playerName: "Ada", categoryIds: ["flags"], roundLimit: 15, roundDurationMs: 45_000 });
    expect(parseClientMessage({ type: "CREATE_ROOM", playerName: "Ada", categoryIds: ["flags"], roundLimit: 2 }).ok).toBe(false);
    expect(parseClientMessage({ type: "CREATE_ROOM", playerName: "Ada", categoryIds: ["flags"], roundDurationMs: 5000 }).ok).toBe(false);
  });

  it("accepts bounded room option updates", () => {
    const message = parseClientMessage({ type: "SET_ROOM_OPTIONS", categoryIds: [" flags ", "codes"], roundLimit: 10 });

    expect(message.ok).toBe(true);
    expect(message.ok ? message.message : null).toEqual({ type: "SET_ROOM_OPTIONS", categoryIds: ["flags", "codes"], roundLimit: 10 });
    expect(parseClientMessage({ type: "SET_ROOM_OPTIONS", categoryIds: [] }).ok).toBe(false);
    expect(parseClientMessage({ type: "SET_ROOM_OPTIONS", categoryIds: ["flags", "codes", "capitals", "shapes", "flag-colors", "pick-country", "spot-country", "extra", "too-many"] }).ok).toBe(false);
  });

  it("accepts skip votes as a client message", () => {
    const message = parseClientMessage({ type: "VOTE_SKIP" });
    expect(message.ok).toBe(true);
    expect(message.ok ? message.message : null).toEqual({ type: "VOTE_SKIP" });
  });

  it("accepts normalized chat messages", () => {
    const message = parseClientMessage({ type: "SEND_CHAT_MESSAGE", text: "  hello   room  " });
    expect(message.ok).toBe(true);
    expect(message.ok ? message.message : null).toEqual({ type: "SEND_CHAT_MESSAGE", text: "hello room" });
    expect(parseClientMessage({ type: "SEND_CHAT_MESSAGE", text: "   " }).ok).toBe(false);
  });

  it("reveals the answer only in round-ended messages", () => {
    const message: ServerMessage = {
      type: "ROUND_ENDED",
      answer: "Japan",
      results: [],
    };

    expect(message.answer).toBe("Japan");
  });
});
