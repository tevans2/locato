// Type-ahead country picker (ARIA combobox) for the atlas. Matches names, aliases and capitals.

import type { CountryIndex } from "../../../core/countries";
import type { CountryProfile } from "../../../core/countries/profiles";
import { el } from "../../dom/createElement";
import { profileIcon } from "./profileIcons";

export interface ProfileSearchOptions {
  readonly profiles: readonly CountryProfile[];
  readonly countryIndex: CountryIndex;
  readonly onSelect: (code: string) => void;
  readonly placeholder?: string;
  readonly label?: string;
  readonly maxResults?: number;
}

export interface ProfileSearch {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  readonly destroy: () => void;
}

export interface SearchEntry {
  readonly profile: CountryProfile;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly capitals: readonly string[];
}

export interface SearchMatch {
  readonly profile: CountryProfile;
  /** Set when the match came from an alias or capital rather than the name. */
  readonly via: string | null;
}

export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

let searchIdCounter = 0;

export function buildSearchEntries(profiles: readonly CountryProfile[], countryIndex: CountryIndex): readonly SearchEntry[] {
  return profiles.map((profile) => {
    const country = countryIndex.byCode.get(profile.code);
    const aliases = new Set([...(country?.aliases ?? []), profile.commonName, profile.officialName, profile.code, profile.cca3].map(normalizeSearch));
    const capitals = new Set([profile.capital, ...profile.capitals, ...(country?.capitalAliases ?? [])].map(normalizeSearch));
    const name = normalizeSearch(profile.name);
    aliases.delete(name);
    return { profile, name, aliases: [...aliases].filter(Boolean), capitals: [...capitals].filter(Boolean) };
  });
}

function scoreText(text: string, query: string): number {
  if (text === query) return 100;
  if (text.startsWith(query)) return 80;
  if (text.split(" ").some((word) => word.startsWith(query))) return 60;
  if (query.length >= 3 && text.includes(query)) return 40;
  return 0;
}

/** Ranked matches for a query; empty query returns nothing. */
export function searchCountries(entries: readonly SearchEntry[], rawQuery: string, limit: number): readonly SearchMatch[] {
  const query = normalizeSearch(rawQuery);
  if (!query) return [];
  const scored: { match: SearchMatch; score: number }[] = [];
  for (const entry of entries) {
    let best = scoreText(entry.name, query) + 5;
    let via: string | null = null;
    if (best <= 5) {
      best = 0;
      for (const alias of entry.aliases) {
        // Two-letter queries only hit ISO codes exactly, so "ch" doesn't pull every "...ch..." alias.
        const score = alias.length <= 3 ? (alias === query ? 90 : 0) : scoreText(alias, query);
        if (score > best) { best = score; via = null; }
      }
      for (const capital of entry.capitals) {
        const score = scoreText(capital, query) - 10;
        if (score > best) { best = score; via = `Capital: ${entry.profile.capital}`; }
      }
      if (best > 0 && via === null) via = aliasLabel(entry, query);
    }
    if (best > 0) scored.push({ match: { profile: entry.profile, via }, score: best });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.match.profile.name.localeCompare(b.match.profile.name))
    .slice(0, limit)
    .map((entry) => entry.match);
}

function aliasLabel(entry: SearchEntry, query: string): string | null {
  const alias = entry.aliases.find((a) => a === query || a.startsWith(query) || a.includes(query));
  if (!alias || alias.length <= 3) return null;
  return `Also “${alias.replace(/\b\w/g, (c) => c.toUpperCase())}”`;
}

export function createProfileSearch(options: ProfileSearchOptions): ProfileSearch {
  const entries = buildSearchEntries(options.profiles, options.countryIndex);
  const limit = options.maxResults ?? 8;
  const id = `cp-search-${++searchIdCounter}`;
  const listId = `${id}-list`;
  let matches: readonly SearchMatch[] = [];
  let active = -1;

  const input = el("input", {
    className: "cp-search-input",
    attrs: {
      id,
      type: "search",
      role: "combobox",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      "aria-autocomplete": "list",
      "aria-expanded": "false",
      "aria-controls": listId,
      placeholder: options.placeholder ?? "Search 196 countries…",
    },
  });
  const list = el("ul", { className: "cp-search-list", attrs: { id: listId, role: "listbox", "aria-label": "Matching countries" } });
  list.hidden = true;
  const status = el("span", { className: "cp-visually-hidden", attrs: { role: "status", "aria-live": "polite" } });

  const label = el("label", { className: "cp-visually-hidden", text: options.label ?? "Find a country", attrs: { for: id } });
  const field = el("div", { className: "cp-search-field", children: [profileIcon("search", "cp-icon cp-search-icon"), input] });
  const element = el("div", { className: "cp-search", children: [label, field, list, status] });

  function close(): void {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function choose(index: number): void {
    const match = matches[index];
    if (!match) return;
    close();
    input.value = "";
    options.onSelect(match.profile.code);
  }

  function setActive(index: number): void {
    active = matches.length === 0 ? -1 : (index + matches.length) % matches.length;
    [...list.children].forEach((child, i) => {
      child.classList.toggle("is-active", i === active);
      child.setAttribute("aria-selected", i === active ? "true" : "false");
    });
    const activeOption = list.children[active];
    if (activeOption) {
      input.setAttribute("aria-activedescendant", activeOption.id);
      (activeOption as HTMLElement).scrollIntoView?.({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function render(): void {
    matches = searchCountries(entries, input.value, limit);
    const query = normalizeSearch(input.value);
    if (!query) {
      close();
      list.replaceChildren();
      status.textContent = "";
      return;
    }
    list.replaceChildren(
      ...(matches.length
        ? matches.map((match, index) =>
            el("li", {
              className: "cp-search-option",
              attrs: { id: `${listId}-${index}`, role: "option", "aria-selected": "false", "data-code": match.profile.code },
              children: [
                el("img", { className: "cp-search-flag", attrs: { src: match.profile.flagSrc, alt: "", loading: "lazy", decoding: "async" } }),
                el("span", {
                  className: "cp-search-text",
                  children: [
                    el("span", { className: "cp-search-name", text: match.profile.name }),
                    el("span", { className: "cp-search-meta", text: match.via ?? match.profile.continent }),
                  ],
                }),
              ],
              on: {
                // mousedown (not click) so the input's blur doesn't close the list first.
                mousedown: (event) => { event.preventDefault(); choose(index); },
                mousemove: () => { if (active !== index) setActive(index); },
              },
            }),
          )
        : [el("li", { className: "cp-search-empty", attrs: { role: "presentation" }, text: `No country matches “${input.value.trim()}”` })]),
    );
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    status.textContent = matches.length ? `${matches.length} ${matches.length === 1 ? "country" : "countries"} found` : "No matches";
    setActive(matches.length ? 0 : -1);
  }

  input.addEventListener("input", render);
  input.addEventListener("focus", () => { if (input.value) render(); });
  input.addEventListener("blur", () => close());
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (list.hidden) render(); else setActive(active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(active - 1);
    } else if (event.key === "Enter") {
      if (active >= 0) { event.preventDefault(); choose(active); }
    } else if (event.key === "Escape") {
      if (!list.hidden) { event.preventDefault(); event.stopPropagation(); close(); } else input.value = "";
    }
  });

  return { element, input, destroy: () => close() };
}
