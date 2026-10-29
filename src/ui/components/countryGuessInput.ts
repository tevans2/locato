import type { Country, CountryIndex } from "../../core/countries";
import { resolveCountryName, suggestCountryNames } from "../../core/overland/names";
import { el } from "../dom/createElement";

/**
 * A "type a country" box for the guessing modes (Overland, Mystery country): matching countries
 * are offered while typing, picked with the arrow keys or a tap, and a typed name is resolved
 * with the usual aliases, codes and small typos. Classes and ids carry the mode's prefix
 * (`overland-input`, `#overland-guess-input`, `#overland-suggestions`, …) so each mode styles it.
 */

export interface CountryGuessInputOptions {
  /** Class and id prefix, e.g. "overland". */
  readonly prefix: string;
  readonly countryIndex: CountryIndex;
  readonly label: string;
  readonly placeholder?: string;
  /** Codes never to offer (already guessed, the ends of a route). */
  readonly exclude: () => ReadonlySet<string>;
  /** A country was chosen, from the list or by typing its name. */
  readonly onPick: (country: Country) => void;
  /** Enter with text naming no single country; `ambiguous` when several match ("Congo"). */
  readonly onUnknown: (text: string, ambiguous: boolean) => void;
  /** Enter with nothing typed. */
  readonly onEmpty: () => void;
  /** The text changed (e.g. to clear a warning). */
  readonly onType?: () => void;
  readonly signal: AbortSignal;
}

export interface CountryGuessInput {
  readonly form: HTMLFormElement;
  readonly input: HTMLInputElement;
  /** Status line under the box; the mode writes its feedback here. */
  readonly feedback: HTMLElement;
  /** Empty the box and close the list. */
  readonly clear: () => void;
  /**
   * `disabled` while nothing can be guessed; `busy` while a guess is being checked (read-only
   * rather than disabled, so the phone keyboard stays up).
   */
  readonly setState: (state: { readonly disabled: boolean; readonly busy: boolean }) => void;
  readonly focus: () => void;
}

export function createCountryGuessInput(options: CountryGuessInputOptions): CountryGuessInput {
  const { prefix, countryIndex, signal } = options;
  const inputId = `${prefix}-guess-input`;
  const listId = `${prefix}-suggestions`;
  let suggestions: readonly Country[] = [];
  let active = -1;

  const input = el("input", {
    className: `${prefix}-input`,
    attrs: {
      id: inputId, type: "text", autocomplete: "off", autocapitalize: "words", autocorrect: "off", spellcheck: "false", enterkeyhint: "done", maxlength: "60",
      placeholder: options.placeholder ?? "Type a country…", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId,
    },
  });
  const addButton = el("button", { className: `primary-action ${prefix}-add`, text: "Add", attrs: { type: "submit" } });
  const list = el("ul", { className: `${prefix}-suggestions`, attrs: { id: listId, role: "listbox", "aria-label": "Matching countries" } });
  list.hidden = true;
  const feedback = el("p", { className: `${prefix}-feedback`, attrs: { role: "status", "aria-live": "polite" } });
  const form = el("form", {
    className: `${prefix}-guess-form`,
    attrs: { novalidate: "" },
    children: [
      el("label", { className: `${prefix}-input-label`, text: options.label, attrs: { for: inputId } }),
      el("div", { className: `${prefix}-input-row`, children: [input, addButton, list] }),
      feedback,
    ],
  });

  function hide(): void {
    suggestions = [];
    active = -1;
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function render(): void {
    if (suggestions.length === 0) {
      hide();
      return;
    }
    list.replaceChildren(...suggestions.map((country, index) => {
      const option = el("li", {
        className: `${prefix}-suggestion${index === active ? " is-active" : ""}`,
        attrs: { id: `${listId}-${index}`, role: "option", "aria-selected": String(index === active) },
        children: [
          el("img", { attrs: { src: country.flagSrc, alt: "", width: "22", height: "15", loading: "lazy", decoding: "async" } }),
          el("span", { text: country.name }),
        ],
      });
      // Pointer down, not click: the input keeps focus, so the keyboard stays open on phones.
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        options.onPick(country);
      });
      option.addEventListener("mousedown", (event) => event.preventDefault());
      return option;
    }));
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", `${listId}-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }

  function update(): void {
    suggestions = suggestCountryNames(countryIndex, input.value, options.exclude());
    active = -1;
    render();
  }

  input.addEventListener("input", () => {
    update();
    options.onType?.();
  }, { signal });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      event.preventDefault();
      // Cycles through the list and back to the typed text.
      const step = event.key === "ArrowDown" ? 1 : -1;
      active = (active + step + suggestions.length + 1) % (suggestions.length + 1);
      if (active === suggestions.length) active = -1;
      render();
    } else if (event.key === "Escape" && !list.hidden) {
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  }, { signal });
  input.addEventListener("blur", () => hide(), { signal });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const picked = active >= 0 ? suggestions[active] : undefined;
    if (picked) {
      options.onPick(picked);
      return;
    }
    const text = input.value.trim();
    if (!text) {
      options.onEmpty();
      return;
    }
    const match = resolveCountryName(countryIndex, text);
    if (match) {
      options.onPick(match);
      return;
    }
    update();
    options.onUnknown(text, suggestions.length > 1);
  }, { signal });

  return {
    form,
    input,
    feedback,
    clear() {
      input.value = "";
      hide();
    },
    setState({ disabled, busy }) {
      input.disabled = disabled;
      input.readOnly = busy;
      addButton.disabled = disabled || busy;
    },
    focus() {
      // A screen built before it's mounted (its first round starts in the constructor) can't take
      // focus yet; App attaches it in the same task, so try again once that has happened.
      if (input.isConnected) input.focus({ preventScroll: true });
      else queueMicrotask(() => { if (input.isConnected && !input.disabled) input.focus({ preventScroll: true }); });
    },
  };
}
