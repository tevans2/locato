export type LocatoTheme = "light" | "dark";

export const LOCATO_THEME_EVENT = "locato:theme-change";
const STORAGE_KEY = "locato.theme";

function storedTheme(storage?: Storage): LocatoTheme | null {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

export function currentTheme(): LocatoTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function initializeTheme(storage?: Storage): LocatoTheme {
  const theme = storedTheme(storage) ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function setTheme(theme: LocatoTheme, storage?: Storage): void {
  document.documentElement.dataset.theme = theme;
  try {
    storage?.setItem(STORAGE_KEY, theme);
  } catch {
    // Theme still applies for the current visit when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent<LocatoTheme>(LOCATO_THEME_EVENT, { detail: theme }));
}

export function toggleTheme(storage?: Storage): LocatoTheme {
  const theme: LocatoTheme = currentTheme() === "dark" ? "light" : "dark";
  setTheme(theme, storage);
  return theme;
}
