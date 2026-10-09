// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadStreetImage } from "../src/ui/components/loadStreetImage";
let controller: AbortController;
beforeEach(() => { controller = new AbortController(); });
afterEach(() => { controller.abort(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe("Street View image readiness", () => {
  it("does not reveal a frame until its bytes have decoded", async () => {
    const image = document.createElement("img");
    let decoded!: () => void;
    vi.spyOn(image, "decode").mockImplementation(() => new Promise(resolve => { decoded = resolve; }));
    const done = vi.fn();
    const pending = loadStreetImage(image, "/test-scene.jpg", controller.signal).then(done);
    await Promise.resolve();
    expect(image.getAttribute("src")).toBe("/test-scene.jpg");
    expect(done).not.toHaveBeenCalled();
    decoded(); await pending;
    expect(done).toHaveBeenCalledOnce();
  });
  it("rejects failed imagery so the screen can show Retry instead of a black frame", async () => {
    const image = document.createElement("img");
    vi.spyOn(image, "decode").mockRejectedValue(new Error("Bad image"));
    await expect(loadStreetImage(image, "/broken.jpg", controller.signal)).rejects.toThrow("Bad image");
  });
  it("cancels a pending decode on navigation", async () => {
    const image = document.createElement("img");
    vi.spyOn(image, "decode").mockReturnValue(new Promise(() => {}));
    const pending = expect(loadStreetImage(image, "/slow.jpg", controller.signal)).rejects.toThrow("cancelled");
    controller.abort(); await pending;
  });
  it("times out stalled imagery rather than leaving the loader indefinitely", async () => {
    vi.useFakeTimers();
    const image = document.createElement("img");
    vi.spyOn(image, "decode").mockReturnValue(new Promise(() => {}));
    const pending = expect(loadStreetImage(image, "/slow.jpg", controller.signal)).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(20000); await pending;
  });
});
