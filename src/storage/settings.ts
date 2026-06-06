export const SETTINGS_KEY = "flagrush:settings:v1";

export interface Settings {
  readonly reducedMotion: boolean;
  readonly soundEnabled: boolean;
  readonly showAutocomplete: boolean;
}

export const defaultSettings: Settings = {
  reducedMotion: false,
  soundEnabled: false,
  showAutocomplete: false,
};

export function readSettings(storage: Storage): Settings {
  const raw = storage.getItem(SETTINGS_KEY);
  if (!raw) return defaultSettings;

  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      reducedMotion: Boolean(parsed.reducedMotion),
      soundEnabled: Boolean(parsed.soundEnabled),
      showAutocomplete: Boolean(parsed.showAutocomplete),
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(storage: Storage, settings: Settings): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
