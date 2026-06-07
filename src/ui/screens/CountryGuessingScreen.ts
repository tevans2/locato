import type { Country, CountryId, CountryIndex } from "../../core/countries";
import { detectCountryGuess, type WorldCountryFeature } from "../../core/map";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createFeedbackView, showFeedback } from "../dom/renderFeedback";
import { createWorldMapView, setWorldMapMissingMarkersVisible, updateWorldMapView } from "../dom/renderWorldMap";

export interface CountryGuessingScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly onBackToSolo: () => void;
  readonly onMultiplayer: () => void;
}

function createLogo(): HTMLElement {
  return el("div", {
    className: "brand-lockup compact",
    children: [el("img", { className: "brand-logo", attrs: { src: "logo.svg", alt: "" } }), el("span", { className: "brand-name", text: "locato" })],
  });
}

export function createCountryGuessingScreen(options: CountryGuessingScreenOptions): Screen {
  const controller = new AbortController();
  const guessedCountryIds = new Set<CountryId>();
  const { countryIndex } = options;
  const map = createWorldMapView(options.worldCountryFeatures, countryIndex);
  const feedback = createFeedbackView();
  const input = el("input", {
    attrs: { id: "guess-input", name: "guess", type: "text", autocomplete: "off", autocapitalize: "words", spellcheck: "false", placeholder: "Type a country name..." },
  });
  const submitButton = el("button", { className: "primary-action", text: "Check", attrs: { type: "submit" } });
  const resetButton = el("button", { className: "ghost-action", text: "Restart", attrs: { type: "button" } });
  const showMissingButton = el("button", { className: "ghost-action", text: "Show missing", attrs: { type: "button", "aria-pressed": "false" } });
  const soloButton = el("button", { className: "ghost-action", text: "Prompt game", attrs: { type: "button" } });
  const multiplayerButton = el("button", { className: "ghost-action", text: "Multiplayer", attrs: { type: "button" } });
  const lastCountryName = el("strong", { text: "None yet" });
  let showMissingCountries = false;

  function complete(): boolean {
    return guessedCountryIds.size >= countryIndex.countries.length;
  }

  function render(): void {
    updateWorldMapView(map, guessedCountryIds, countryIndex.countries.length);
    const finished = complete();
    input.disabled = finished;
    submitButton.disabled = finished;
    showMissingButton.textContent = showMissingCountries ? "Hide missing" : "Show missing";
    showMissingButton.setAttribute("aria-pressed", String(showMissingCountries));
    setWorldMapMissingMarkersVisible(map, showMissingCountries);
  }

  function recordGuess(country: Country): void {
    guessedCountryIds.add(country.id);
    lastCountryName.textContent = country.name;
    render();
    input.value = "";

    if (complete()) {
      showFeedback(feedback, `World complete. All ${countryIndex.countries.length} countries found.`, "good");
      return;
    }

    showFeedback(feedback, `${country.name} found.`, "good");
  }

  function checkInput(showMiss = false): void {
    const country = detectCountryGuess(countryIndex, input.value, guessedCountryIds);
    if (country) {
      recordGuess(country);
      return;
    }

    if (showMiss && input.value.trim()) {
      showFeedback(feedback, "No new country detected yet.", "neutral");
      input.select();
    }
  }

  const form = el("form", {
    className: "guess-form country-guess-form",
    children: [el("label", { text: "Country", attrs: { for: "guess-input" } }), el("div", { className: "input-row", children: [input, submitButton] })],
  });

  input.addEventListener("input", () => checkInput(), { signal: controller.signal });
  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      checkInput(true);
    },
    { signal: controller.signal },
  );
  showMissingButton.addEventListener(
    "click",
    () => {
      showMissingCountries = !showMissingCountries;
      render();
    },
    { signal: controller.signal },
  );
  resetButton.addEventListener(
    "click",
    () => {
      guessedCountryIds.clear();
      input.value = "";
      lastCountryName.textContent = "None yet";
      render();
      showFeedback(feedback, "Fresh world map ready.", "neutral");
      input.focus();
    },
    { signal: controller.signal },
  );
  soloButton.addEventListener("click", options.onBackToSolo, { signal: controller.signal });
  multiplayerButton.addEventListener("click", options.onMultiplayer, { signal: controller.signal });

  const element = el("section", {
    className: "game-screen country-guess-screen",
    children: [
      el("header", {
        className: "game-header",
        children: [
          createLogo(),
          el("div", {
            className: "mode-controls",
            children: [el("div", { className: "mode-select-row", children: [soloButton, multiplayerButton] })],
          }),
        ],
      }),
      el("div", {
        className: "country-guess-layout",
        children: [
          map.element,
          el("aside", {
            className: "answer-panel country-guess-panel",
            children: [
              form,
              el("div", {
                className: "country-guess-summary",
                children: [
                  el("span", { text: "Last" }),
                  lastCountryName,
                ],
              }),
              feedback.element,
              el("div", { className: "actions", children: [showMissingButton, resetButton] }),
            ],
          }),
        ],
      }),
    ],
  });

  render();
  showFeedback(feedback, "Start typing country names. Matches highlight instantly on the map.", "neutral");
  queueMicrotask(() => input.focus());

  return {
    element,
    destroy: () => controller.abort(),
  };
}
