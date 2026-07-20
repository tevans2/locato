import { describe, expect, it } from "vitest";
import { readSettings, saveSettings, SETTINGS_KEY } from "../src/storage/settings";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("game feel settings", () => {
  it("keeps haptics enabled when migrating an older settings save", () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ soundEnabled: true }));
    expect(readSettings(storage)).toMatchObject({ soundEnabled: true, hapticsEnabled: true });
  });

  it("persists sound and haptic choices", () => {
    const storage = new MemoryStorage();
    saveSettings(storage, { reducedMotion: false, showAutocomplete: false, soundEnabled: true, hapticsEnabled: false });
    expect(readSettings(storage)).toMatchObject({ soundEnabled: true, hapticsEnabled: false });
  });
});
