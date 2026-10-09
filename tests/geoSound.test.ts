// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_KEY } from "../src/storage/settings";
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });
function audioContext() {
  const parameter = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const oscillators: Array<{ stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const sources: Array<{ stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  const filters: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
  const buffer = vi.fn((size: number) => ({ getChannelData: () => new Float32Array(size) }));
  const gains: Array<{ gain: ReturnType<typeof parameter> }> = [];
  class Audio {
    state = "running"; currentTime = 0; destination = {}; sampleRate = 44100;
    createBuffer(_channels: number, size: number) { return buffer(size); }
    createBufferSource() { const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }; sources.push(source); return source; }
    createBiquadFilter() { const filter = { type: "bandpass", frequency: parameter(), Q: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() }; filters.push(filter); return filter; }
    createGain() { const node = { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() }; gains.push(node); return node; }
    createOscillator() { const node = { frequency: parameter(), type: "sine", connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }; oscillators.push(node); return node; }
  }
  vi.stubGlobal("AudioContext", Audio);
  return { oscillators, gains, sources, filters, buffer };
}
describe("GeoGuessr sound cues", () => {
  it("silences already scheduled audio immediately and persists mute", async () => {
    const api = audioContext();
    const sfx = await import("../src/ui/dom/sfx");
    const stop = sfx.playGeoSound("score", 5000);
    expect(api.oscillators.length).toBeGreaterThan(0);
    sfx.setSoundEnabled(false);
    expect(api.gains[0]!.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).soundEnabled).toBe(false);
    const count = api.oscillators.length;
    sfx.playGeoSound("finish");
    expect(api.oscillators).toHaveLength(count);
    stop();
    for (const oscillator of api.oscillators) expect(oscillator.disconnect).toHaveBeenCalled();
    for (const node of [...api.sources, ...api.filters]) expect(node.disconnect).toHaveBeenCalled();
  });
  it("reuses its texture buffer and cancels every layer of each cue", async () => {
    const api = audioContext();
    const sfx = await import("../src/ui/dom/sfx");
    const stop = (["pin", "submit", "countdown", "go", "score", "finish"] as const).map(cue => sfx.playGeoSound(cue, 5000));
    expect(api.buffer).toHaveBeenCalledOnce();
    expect(api.sources).toHaveLength(6);
    stop.forEach(cancel => cancel());
    for (const node of [...api.sources, ...api.oscillators]) {
      expect(node.stop).toHaveBeenCalledTimes(2);
      expect(node.disconnect).toHaveBeenCalled();
    }
  });
  it("honors an existing muted preference before creating audio nodes", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ soundEnabled: false }));
    const api = audioContext();
    const sfx = await import("../src/ui/dom/sfx");
    sfx.playGeoSound("pin");
    expect(api.gains).toHaveLength(0);
  });
  it("keeps gameplay usable when the browser cannot create an audio context", async () => {
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("Unavailable"); } });
    const sfx = await import("../src/ui/dom/sfx");
    expect(() => { sfx.unlockSound(); sfx.playGeoSound("pin")(); }).not.toThrow();
  });
});
