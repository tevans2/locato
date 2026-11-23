import { emptyStreetViewHistory, type StreetViewHistory } from "../core/streetview";

const key = "locato:streetview-history:v1";

export function readStreetViewHistory(storage: Storage | null): StreetViewHistory {
  try {
    const history = JSON.parse(storage?.getItem(key) ?? "null") as Partial<StreetViewHistory> | null;
    return {
      countries: Array.isArray(history?.countries) ? history.countries.filter((code) => typeof code === "string").slice(-100) : [],
      locations: Array.isArray(history?.locations) ? history.locations.filter((location) => typeof location === "string").slice(-1000) : [],
    };
  } catch {
    return emptyStreetViewHistory;
  }
}

export function saveStreetViewHistory(storage: Storage | null, history: StreetViewHistory): void {
  try {
    storage?.setItem(key, JSON.stringify(history));
  } catch {
    // The run can still avoid repeats with in-memory history.
  }
}
