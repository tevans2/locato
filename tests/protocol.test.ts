import { describe, expect, it } from "vitest";
import type { PublicRoundState, ServerMessage } from "../src/core/multiplayer";

describe("multiplayer public protocol", () => {
  it("does not expose answers in public round state", () => {
    const round: PublicRoundState = {
      roundNumber: 1,
      flagSrc: "assets/flags/jp.svg",
      startedAt: 1000,
      endsAt: null,
    };

    expect(Object.keys(round).sort()).toEqual(["endsAt", "flagSrc", "roundNumber", "startedAt"]);
  });

  it("reveals country identity only in round-ended messages", () => {
    const message: ServerMessage = {
      type: "ROUND_ENDED",
      countryCode: "JP",
      countryName: "Japan",
      results: [],
    };

    expect(message.countryName).toBe("Japan");
  });
});
