import type { Country, CountryId, CountryIndex } from "../../core/countries";
import { isPromptGameModeId, isStreetViewGameModeId, isWorldMapGameModeId, type GameModeId } from "../../core/gameModes";
import { streetViewCountryRounds, type StreetViewCountryRound, type StreetViewFrame } from "../../core/streetview";
import { submitCountryGuess } from "../../core/map";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createGameModeDropdown } from "../dom/gameModeDropdown";
import { createFeedbackView, showFeedback } from "../dom/renderFeedback";
import { createMobileMenu } from "../dom/mobileMenu";
import { bindKeyboardAwareInput, shouldAutoFocusTextInput } from "../dom/mobileKeyboard";

export interface StreetViewCountryScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onMultiplayer: () => void;
  readonly onDailyChallenge: () => void;
}

type RoundStatus = "playing" | "won" | "lost";

const ROUND_CACHE_TARGET_SIZE = 5;

function createLogo(): HTMLElement {
  return el("div", {
    className: "brand-lockup compact",
    children: [el("img", { className: "brand-logo", attrs: { src: "logo.svg", alt: "" } }), el("span", { className: "brand-name", text: "locato" })],
  });
}

function googleMapsEmbedApiKey(): string {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_GOOGLE_MAPS_EMBED_API_KEY?: string } }).env;
  return env?.VITE_GOOGLE_MAPS_EMBED_API_KEY?.trim() ?? "";
}

function eligibleRounds(countryIndex: CountryIndex): readonly StreetViewCountryRound[] {
  return streetViewCountryRounds.filter((round) => round.frames.length === 3 && countryIndex.byCode.has(round.countryCode));
}

let lastStreetViewCountryCode: string | null = null;

function chooseRound(countryIndex: CountryIndex): StreetViewCountryRound {
  const rounds = eligibleRounds(countryIndex);
  if (rounds.length === 0) throw new Error("No Street View country rounds match the country index.");

  const availableRounds = rounds.length > 1 ? rounds.filter((item) => item.countryCode !== lastStreetViewCountryCode) : rounds;
  const selected = availableRounds[Math.floor(Math.random() * availableRounds.length)]!;
  lastStreetViewCountryCode = selected.countryCode;
  return selected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStreetViewFrame(value: unknown): value is StreetViewFrame {
  if (!isRecord(value)) return false;
  return isFiniteNumber(value.lat) && isFiniteNumber(value.lng) && isFiniteNumber(value.heading) && (value.pitch === undefined || isFiniteNumber(value.pitch)) && (value.fov === undefined || isFiniteNumber(value.fov)) && typeof value.label === "string";
}

function isStreetViewRound(value: unknown, countryIndex: CountryIndex): value is StreetViewCountryRound {
  if (!isRecord(value) || typeof value.countryCode !== "string" || !Array.isArray(value.frames)) return false;
  return countryIndex.byCode.has(value.countryCode) && value.frames.length === 3 && value.frames.every(isStreetViewFrame);
}

function isStreetViewRoundList(value: unknown, countryIndex: CountryIndex): value is StreetViewCountryRound[] {
  return Array.isArray(value) && value.every((item) => isStreetViewRound(item, countryIndex));
}

async function fetchStreetViewRounds(countryIndex: CountryIndex, count: number, signal: AbortSignal): Promise<StreetViewCountryRound[]> {
  try {
    const response = await fetch(`/api/streetview-country/rounds?count=${encodeURIComponent(String(count))}`, { cache: "no-store", signal });
    if (response.ok) {
      const data: unknown = await response.json();
      if (isStreetViewRoundList(data, countryIndex)) return data;
    }
  } catch {
    // The Vite dev server can run without the Bun backend. In that case, the game silently uses bundled fallback rounds.
  }

  try {
    const response = await fetch("/api/streetview-country/round", { cache: "no-store", signal });
    if (!response.ok) return [];
    const data: unknown = await response.json();
    return isStreetViewRound(data, countryIndex) ? [data] : [];
  } catch {
    return [];
  }
}

function buildStreetViewEmbedUrl(apiKey: string, round: StreetViewCountryRound, attemptIndex: number): string {
  const frame = round.frames[attemptIndex] ?? round.frames[0]!;
  const params = new URLSearchParams({
    key: apiKey,
    location: `${frame.lat},${frame.lng}`,
    heading: String(frame.heading),
    pitch: String(frame.pitch ?? 0),
    fov: String(frame.fov ?? 90),
    radius: "1000",
    source: "outdoor",
  });
  return `https://www.google.com/maps/embed/v1/streetview?${params.toString()}`;
}

export function createStreetViewCountryScreen(options: StreetViewCountryScreenOptions): Screen {
  const controller = new AbortController();
  const apiKey = googleMapsEmbedApiKey();
  const maxAttempts = 3;
  const guessedCountryIds = new Set<CountryId>();
  const roundCache: StreetViewCountryRound[] = [];
  let status: RoundStatus = "playing";
  let attemptIndex = 0;
  let round = chooseRound(options.countryIndex);
  let loadingRound = false;
  let currentStreetViewUrl = "";
  let currentPreloadUrl = "";
  let cachePromise: Promise<void> | null = null;
  let streetViewFullscreen = false;

  function targetCountry(): Country {
    const country = options.countryIndex.byCode.get(round.countryCode);
    if (!country) throw new Error(`Unknown Street View country code: ${round.countryCode}`);
    return country;
  }

  const iframe = el("iframe", {
    className: "streetview-frame",
    attrs: {
      title: "Interactive Street View frame",
      loading: "lazy",
      referrerpolicy: "no-referrer-when-downgrade",
      allowfullscreen: "true",
    },
  });
  const preloadIframe = el("iframe", {
    className: "streetview-preload-frame",
    attrs: {
      title: "Preloaded Street View frame",
      tabindex: "-1",
      "aria-hidden": "true",
      referrerpolicy: "no-referrer-when-downgrade",
    },
  });
  const missingKeyPanel = el("div", {
    className: "streetview-missing-key",
    children: [
      el("strong", { text: "Google Maps Embed API key missing" }),
      el("p", { text: "Add VITE_GOOGLE_MAPS_EMBED_API_KEY to your local .env file, then restart Vite." }),
    ],
  });
  const frameNumber = el("strong", { className: "stat-value", text: "1 / 3" });
  const guessesLeft = el("strong", { className: "stat-value", text: "3" });
  const previousGuesses = el("strong", { className: "stat-value", text: "None" });
  const roundResult = el("strong", { className: "streetview-result", text: "" });
  const input = el("input", {
    attrs: {
      id: "streetview-guess-input",
      name: "streetviewGuess",
      type: "text",
      autocomplete: "off",
      autocapitalize: "words",
      spellcheck: "false",
      placeholder: "Type a country...",
    },
  });
  const submitButton = el("button", { className: "primary-action", text: "Guess", attrs: { type: "submit" } });
  const nextRoundButton = el("button", { className: "primary-action", text: "Next round", attrs: { type: "button" } });
  const fullscreenButton = el("button", { className: "ghost-action streetview-fullscreen-action", text: "Fullscreen", attrs: { type: "button", "aria-pressed": "false" } });
  const restartButton = el("button", { className: "ghost-action", text: "Restart country", attrs: { type: "button" } });
  const revealButton = el("button", { className: "ghost-action", text: "Reveal", attrs: { type: "button" } });
  const dailyButton = el("button", { className: "ghost-action nav-action daily-action", text: "Daily Challenge", attrs: { type: "button", "data-mobile-label": "Daily", "aria-label": "Open daily challenge" } });
  const multiplayerButton = el("button", { className: "ghost-action nav-action", text: "Multiplayer", attrs: { type: "button", "data-mobile-label": "Multi", "aria-label": "Open multiplayer" } });
  const mobileDailyNavButton = el("button", { className: "mobile-nav-item", text: "Daily Challenge", attrs: { type: "button" } });
  const mobileMultiplayerNavButton = el("button", { className: "mobile-nav-item", text: "Multiplayer", attrs: { type: "button" } });
  const mobileMenu = createMobileMenu(
    "Menu",
    [
      { title: "Play", items: [mobileDailyNavButton] },
      { title: "Compete", items: [mobileMultiplayerNavButton] },
    ],
    controller.signal,
  );
  const feedback = createFeedbackView();

  const gameModeDropdown = createGameModeDropdown({
    selectedMode: "streetview-country",
    signal: controller.signal,
    onChange: (gameMode) => {
      if (isStreetViewGameModeId(gameMode)) return;
      if (isPromptGameModeId(gameMode) || isWorldMapGameModeId(gameMode)) options.onGameModeChange(gameMode);
    },
  });

  const form = el("form", {
    className: "guess-form streetview-guess-form",
    children: [el("label", { text: "Your country guess", attrs: { for: "streetview-guess-input" } }), el("div", { className: "input-row", children: [input, submitButton] })],
  });

  const statsPanel = el("div", {
    className: "stats-panel streetview-stats",
    children: [
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Frame" }), frameNumber] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Guesses left" }), guessesLeft] }),
      el("div", { className: "stat-card previous-guesses-card", children: [el("span", { className: "stat-label", text: "Previous" }), previousGuesses] }),
    ],
  });

  const streetViewPanel = el("div", {
    className: "streetview-stage",
    children: [iframe, preloadIframe, missingKeyPanel],
  });

  const element = el("section", {
    className: "game-screen streetview-country-screen",
    children: [
      el("header", {
        className: "game-header",
        children: [
          el("div", { className: "game-header-left", children: [createLogo(), gameModeDropdown.element] }),
          el("div", { className: "game-header-actions", children: [dailyButton, multiplayerButton, mobileMenu.button, mobileMenu.sheet] }),
        ],
      }),
      el("div", {
        className: "streetview-layout",
        children: [
          streetViewPanel,
          el("aside", {
            className: "answer-panel streetview-panel",
            children: [
              el("div", { className: "panel-title", children: [el("h2", { text: "Guess the country" })] }),
              el("p", { className: "streetview-rules", text: "You get 3 interactive Street View frames from the same hidden country. A wrong answer loads the next frame." }),
              form,
              statsPanel,
              feedback.element,
              roundResult,
              el("div", { className: "actions", children: [fullscreenButton, nextRoundButton, restartButton, revealButton] }),
            ],
          }),
        ],
      }),
    ],
  });

  function previousGuessText(): string {
    const names = [...guessedCountryIds].map((countryId) => options.countryIndex.byId[countryId]?.name).filter((name): name is string => Boolean(name));
    return names.length > 0 ? names.join(", ") : "None";
  }

  function render(): void {
    const attemptsUsed = attemptIndex + 1;
    element.classList.toggle("is-streetview-fullscreen", streetViewFullscreen);
    fullscreenButton.textContent = streetViewFullscreen ? "Exit fullscreen" : "Fullscreen";
    fullscreenButton.setAttribute("aria-pressed", String(streetViewFullscreen));
    frameNumber.textContent = `${attemptsUsed} / ${maxAttempts}`;
    guessesLeft.textContent = String(Math.max(0, maxAttempts - guessedCountryIds.size));
    previousGuesses.textContent = previousGuessText();
    submitButton.disabled = status !== "playing" || !apiKey || loadingRound;
    input.disabled = status !== "playing" || !apiKey || loadingRound;
    restartButton.disabled = loadingRound;
    revealButton.disabled = status !== "playing" || loadingRound;
    nextRoundButton.hidden = status === "playing";
    nextRoundButton.textContent = loadingRound ? "Loading..." : "Next round";
    roundResult.textContent = status === "won" ? `Correct — ${targetCountry().name}.` : status === "lost" ? `Answer — ${targetCountry().name}.` : "";
    missingKeyPanel.hidden = Boolean(apiKey);
    iframe.hidden = !apiKey;
    if (apiKey) {
      const nextSrc = buildStreetViewEmbedUrl(apiKey, round, attemptIndex);
      if (nextSrc !== currentStreetViewUrl) {
        currentStreetViewUrl = nextSrc;
        iframe.setAttribute("src", nextSrc);
      }
    } else {
      currentStreetViewUrl = "";
      iframe.removeAttribute("src");
    }

    preloadNextRoundFrame();
  }

  function resetCurrentCountry(message?: string, tone: "neutral" | "good" | "bad" = "neutral"): void {
    guessedCountryIds.clear();
    status = "playing";
    attemptIndex = 0;
    input.value = "";
    render();
    if (message) showFeedback(feedback, message, tone);
    input.focus();
  }

  function preloadNextRoundFrame(): void {
    if (!apiKey || roundCache.length === 0) {
      preloadIframe.removeAttribute("src");
      currentPreloadUrl = "";
      return;
    }

    const nextUrl = buildStreetViewEmbedUrl(apiKey, roundCache[0]!, 0);
    if (nextUrl !== currentPreloadUrl) {
      currentPreloadUrl = nextUrl;
      preloadIframe.setAttribute("src", nextUrl);
    }
  }

  async function fillRoundCache(): Promise<void> {
    if (!apiKey || controller.signal.aborted) return;
    if (cachePromise) return cachePromise;

    const needed = ROUND_CACHE_TARGET_SIZE - roundCache.length;
    if (needed <= 0) {
      preloadNextRoundFrame();
      return;
    }

    cachePromise = fetchStreetViewRounds(options.countryIndex, needed, controller.signal)
      .then((rounds) => {
        for (const candidate of rounds) {
          if (roundCache.length >= ROUND_CACHE_TARGET_SIZE) break;
          roundCache.push(candidate);
        }
        preloadNextRoundFrame();
      })
      .finally(() => {
        cachePromise = null;
      });

    return cachePromise;
  }

  function warmRoundCache(): void {
    void fillRoundCache();
  }

  function takeCachedRound(): StreetViewCountryRound | null {
    const cached = roundCache.shift() ?? null;
    preloadNextRoundFrame();
    warmRoundCache();
    return cached;
  }

  function startNextRound(message = "Next country loaded.", tone: "neutral" | "good" | "bad" = "neutral"): void {
    const cachedRound = takeCachedRound();
    round = cachedRound ?? chooseRound(options.countryIndex);
    lastStreetViewCountryCode = round.countryCode;
    resetCurrentCountry(message, tone);
  }

  function handleGuess(): void {
    if (status !== "playing" || loadingRound) return;
    const guess = submitCountryGuess(options.countryIndex, input.value, guessedCountryIds);
    if (!guess) {
      showFeedback(feedback, "I couldn't match that to a country. Try a full country name.", "neutral");
      input.select();
      return;
    }

    guessedCountryIds.add(guess.id);
    input.value = "";

    if (guess.code === round.countryCode) {
      const countryName = targetCountry().name;
      startNextRound(`Correct — ${countryName}. Next country loaded.`, "good");
      return;
    }

    if (attemptIndex >= maxAttempts - 1) {
      status = "lost";
      render();
      showFeedback(feedback, `Not ${guess.name}. No guesses left.`, "bad");
      return;
    }

    attemptIndex += 1;
    render();
    showFeedback(feedback, `Not ${guess.name}. New frame loaded.`, "bad");
    input.focus();
  }

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      handleGuess();
    },
    { signal: controller.signal },
  );
  fullscreenButton.addEventListener(
    "click",
    () => {
      streetViewFullscreen = !streetViewFullscreen;
      render();
      if (streetViewFullscreen && shouldAutoFocusTextInput()) input.focus();
    },
    { signal: controller.signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (!streetViewFullscreen || event.key !== "Escape") return;
      streetViewFullscreen = false;
      render();
    },
    { signal: controller.signal },
  );
  nextRoundButton.addEventListener("click", () => startNextRound(), { signal: controller.signal });
  restartButton.addEventListener("click", () => resetCurrentCountry("Fresh attempt. Guess the country from the first frame."), { signal: controller.signal });
  revealButton.addEventListener(
    "click",
    () => {
      if (loadingRound) return;
      status = "lost";
      render();
      showFeedback(feedback, `Revealed: ${targetCountry().name}.`, "neutral");
    },
    { signal: controller.signal },
  );
  dailyButton.addEventListener("click", options.onDailyChallenge, { signal: controller.signal });
  multiplayerButton.addEventListener("click", options.onMultiplayer, { signal: controller.signal });
  mobileDailyNavButton.addEventListener("click", options.onDailyChallenge, { signal: controller.signal });
  mobileMultiplayerNavButton.addEventListener("click", options.onMultiplayer, { signal: controller.signal });
  bindKeyboardAwareInput(element, input, controller.signal);

  render();
  if (!apiKey) showFeedback(feedback, "Add your Google Maps Embed API key to enable Street View frames.", "neutral");
  warmRoundCache();
  queueMicrotask(() => input.focus());

  return { element, destroy: () => controller.abort() };
}
