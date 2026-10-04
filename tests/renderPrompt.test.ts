import { describe, expect, it } from "vitest";
import { promptImageClass } from "../src/ui/dom/renderPrompt";

describe("prompt image class", () => {
  it("styles an outline served from an opaque asset link as a country shape", () => {
    expect(promptImageClass("/api/game-assets/abc", "shape")).toBe("flag-image country-shape-image");
  });

  it("still recognises a raw outline path, and leaves flags alone", () => {
    expect(promptImageClass("assets/country-shapes/za.svg")).toBe("flag-image country-shape-image");
    expect(promptImageClass("/api/game-assets/abc")).toBe("flag-image");
  });
});
