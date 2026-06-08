import type { Country, CountryId, CountryIndex } from "../../core/countries";
import { detectCountryGuess, type WorldCountryFeature } from "../../core/map";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createFeedbackView, showFeedback } from "../dom/renderFeedback";
import { createWorldMapView, setWorldMapMissingMarkersVisible, updateWorldMapView } from "../dom/renderWorldMap";

export interface CountryGuessingScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly storage: Storage;
  readonly onBackToSolo: () => void;
  readonly onMultiplayer: () => void;
}

type CountryGuessTimerMode = "off" | "count-up";

const COUNTRY_GUESS_TIMER_LAST_KEY = "locato:country-guessing:timer-last-ms:v1";
const COUNTRY_GUESS_TIMER_BEST_KEY = "locato:country-guessing:timer-best-ms:v1";

function readStoredTime(storage: Storage, key: string): number | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredTime(storage: Storage, key: string, elapsedMs: number): void {
  try {
    storage.setItem(key, String(Math.max(1, Math.round(elapsedMs))));
  } catch {
    // Ignore storage failures so the game still works in private or locked-down browsers.
  }
}

function formatElapsedTime(elapsedMs: number): string {
  const safeElapsedMs = Math.max(0, Math.floor(elapsedMs));
  const totalSeconds = Math.floor(safeElapsedMs / 1000);
  const tenths = Math.floor((safeElapsedMs % 1000) / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function formatStoredTime(elapsedMs: number | null): string {
  return elapsedMs === null ? "—" : formatElapsedTime(elapsedMs);
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
    attrs: { id: "guess-input", name: "guess", type: "text", autocomplete: "off", autocapitalize: "words", spellcheck: "false", placeholder: "e.g. Brazil, Japan, ZA..." },
  });
  const submitButton = el("button", { className: "primary-action", text: "Lock in", attrs: { type: "submit" } });
  const resetButton = el("button", { className: "ghost-action", text: "Restart", attrs: { type: "button" } });
  const timerModeSelect = el("select", {
    className: "country-guess-timer-select",
    attrs: { id: "country-timer-mode", name: "timerMode", "aria-label": "Country guessing timer mode" },
    children: [
      el("option", { text: "Practice", attrs: { value: "off" } }),
      el("option", { text: "Timer", attrs: { value: "count-up" } }),
    ],
  });
  const foundCount = el("strong", { className: "stat-value", text: "0" });
  const remainingCount = el("strong", { className: "stat-value", text: String(countryIndex.countries.length) });
  const lastCountryName = el("strong", { className: "stat-value", text: "None" });
  const timerElapsed = el("strong", { className: "stat-value", text: "—" });
  const timerLast = el("strong", { className: "stat-value", text: "—" });
  const timerBest = el("strong", { className: "stat-value", text: "—" });
  const timerModeCard = el("div", {
    className: "stat-card country-guess-mode-card",
    children: [el("label", { className: "stat-label", text: "Mode", attrs: { for: "country-timer-mode" } }), timerModeSelect],
  });
  const statsPanel = el("div", {
    className: "stats-panel country-guess-stats",
    children: [
      timerModeCard,
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Found" }), foundCount] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Remaining" }), remainingCount] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Last" }), lastCountryName] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Time" }), timerElapsed] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Previous" }), timerLast] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Best" }), timerBest] }),
    ],
  });
  const showMissingButton = el("button", { className: "ghost-action", text: "Show missing", attrs: { type: "button", "aria-pressed": "false" } });
  const soloButton = el("button", { className: "ghost-action", text: "Prompt game", attrs: { type: "button" } });
  const multiplayerButton = el("button", { className: "ghost-action", text: "Multiplayer", attrs: { type: "button" } });
  let showMissingCountries = false;
  let timerMode: CountryGuessTimerMode = "off";
  let timerStartedAt: number | null = null;
  let timerElapsedMs = 0;
  let timerIntervalId: number | null = null;
  let lastTimerMs = readStoredTime(options.storage, COUNTRY_GUESS_TIMER_LAST_KEY);
  let bestTimerMs = readStoredTime(options.storage, COUNTRY_GUESS_TIMER_BEST_KEY);

  function complete(): boolean {
    return guessedCountryIds.size >= countryIndex.countries.length;
  }

  function currentElapsedMs(): number {
    return timerStartedAt === null ? timerElapsedMs : Date.now() - timerStartedAt;
  }

  function renderTimer(): void {
    timerModeSelect.value = timerMode;
    statsPanel.classList.toggle("timer-is-active", timerMode === "count-up");
    timerElapsed.textContent = timerMode === "count-up" ? formatElapsedTime(currentElapsedMs()) : "—";
    timerLast.textContent = formatStoredTime(lastTimerMs);
    timerBest.textContent = formatStoredTime(bestTimerMs);
  }

  function clearTimerInterval(): void {
    if (timerIntervalId !== null) {
      window.clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  function startTimerIfNeeded(): void {
    if (timerMode !== "count-up" || timerStartedAt !== null || complete()) return;

    timerStartedAt = Date.now() - timerElapsedMs;
    timerIntervalId = window.setInterval(renderTimer, 100);
    renderTimer();
  }

  function stopTimer(): number {
    timerElapsedMs = currentElapsedMs();
    timerStartedAt = null;
    clearTimerInterval();
    renderTimer();
    return timerElapsedMs;
  }

  function resetTimer(): void {
    timerStartedAt = null;
    timerElapsedMs = 0;
    clearTimerInterval();
    renderTimer();
  }

  function render(): void {
    updateWorldMapView(map, guessedCountryIds, countryIndex.countries.length);
    const finished = complete();
    input.disabled = finished;
    submitButton.disabled = finished;
    foundCount.textContent = String(guessedCountryIds.size);
    remainingCount.textContent = String(Math.max(0, countryIndex.countries.length - guessedCountryIds.size));
    showMissingButton.textContent = showMissingCountries ? "Hide missing" : "Show missing";
    showMissingButton.setAttribute("aria-pressed", String(showMissingCountries));
    setWorldMapMissingMarkersVisible(map, showMissingCountries);
    renderTimer();
  }

  function resetGame(feedbackMessage: string): void {
    guessedCountryIds.clear();
    input.value = "";
    lastCountryName.textContent = "None";
    resetTimer();
    render();
    showFeedback(feedback, feedbackMessage, "neutral");
    input.focus();
  }

  function recordGuess(country: Country): void {
    startTimerIfNeeded();
    guessedCountryIds.add(country.id);
    lastCountryName.textContent = country.name;
    render();
    input.value = "";

    if (complete()) {
      if (timerMode === "count-up") {
        const finalTimeMs = stopTimer();
        lastTimerMs = finalTimeMs;
        writeStoredTime(options.storage, COUNTRY_GUESS_TIMER_LAST_KEY, finalTimeMs);
        const isNewBest = bestTimerMs === null || finalTimeMs < bestTimerMs;
        if (isNewBest) {
          bestTimerMs = finalTimeMs;
          writeStoredTime(options.storage, COUNTRY_GUESS_TIMER_BEST_KEY, finalTimeMs);
        }
        renderTimer();
        showFeedback(
          feedback,
          `World complete. All ${countryIndex.countries.length} countries found in ${formatElapsedTime(finalTimeMs)}${isNewBest ? " — new best time." : "."}`,
          "good",
        );
        return;
      }

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
    children: [el("label", { text: "Your guess", attrs: { for: "guess-input" } }), el("div", { className: "input-row", children: [input, submitButton] })],
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
  timerModeSelect.addEventListener(
    "change",
    () => {
      timerMode = timerModeSelect.value === "count-up" ? "count-up" : "off";
      resetGame(timerMode === "count-up" ? "Timer mode ready. The clock starts on your first correct country." : "Practice mode ready.");
    },
    { signal: controller.signal },
  );
  resetButton.addEventListener(
    "click",
    () => {
      resetGame(timerMode === "count-up" ? "Timer reset. Start with your first correct country." : "Fresh world map ready.");
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
              statsPanel,
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
    destroy: () => {
      clearTimerInterval();
      controller.abort();
    },
  };
}
