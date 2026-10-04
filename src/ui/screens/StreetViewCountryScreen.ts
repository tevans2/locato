import type { Country, CountryId, CountryIndex } from "../../core/countries";
import type { ShellContext } from "../shell/types";
import type { GameModeId } from "../../core/gameModes";
import { STREET_VIEW_ATTEMPT_COUNTRIES, STREET_VIEW_POINTS_BY_GUESS, streetViewCountryPoints } from "../../core/leaderboards";
import { streetViewCountryRounds, type StreetViewCountryRound, type StreetViewFrame } from "../../core/streetview";
import { submitCountryGuess } from "../../core/map";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createFeedbackView, showFeedback } from "../dom/renderFeedback";
import { bindKeyboardAwareInput, shouldAutoFocusTextInput } from "../dom/mobileKeyboard";
import { createDailyStageBar, createResultsStage, createRunList, insertIntoResults, shellOrFallback, type DailyStageProgress } from "./practiceRun";
import { scoreDailyRound } from "../../core/dailyChallenge";
import { createBestBar, createRankedResults, readSingleBest, submitRankedAttempt, type PostRankedAttempt } from "./rankedAttempt";
import type { RankedSession } from "./RankedSession";
import { createPrivateStreetView } from "../components/PrivateStreetView";

/** A practice run is this many countries; then the results screen. */
export const STREETVIEW_RUN_LENGTH = 5;

export interface StreetViewCountryScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly countryIndex: CountryIndex;
  readonly onGameModeChange: (gameMode: GameModeId) => void;
  readonly onHome: () => void;
  readonly onMultiplayer: () => void;
  readonly onDailyChallenge: () => void;
  /** Keeps the device best. */
  readonly storage?: Storage;
  readonly ranked?: RankedSession;
  readonly dailyChallenge?: {
    readonly date: string;
    readonly title?: string;
    readonly practice?: boolean;
    readonly onResult?: (result: { readonly missed: boolean; readonly wrongGuesses: number }) => void;
    readonly round: StreetViewCountryRound;
    readonly onComplete: (result: { readonly missed: boolean; readonly wrongGuesses: number }) => void;
    /** Where this stage sits in today's daily ("Round 9 of 10"), for the FocusBar. */
    readonly progress?: DailyStageProgress;
  };
}

/** Injectable pieces so the run flow is testable without a Google key or network. */
export interface StreetViewCountryScreenServices {
  readonly apiKey: string;
  readonly embedUrl: (apiKey: string, round: StreetViewCountryRound, attemptIndex: number) => string;
  readonly fetchRounds: (countryIndex: CountryIndex, count: number, signal: AbortSignal) => Promise<StreetViewCountryRound[]>;
  /** How long to wait for an iframe load event before showing it anyway. */
  readonly loadTimeoutMs: number;
  /** Posts a ranked attempt's total (defaults to the leaderboard API). */
  readonly postAttempt?: PostRankedAttempt;
}

interface RunRound {
  readonly code: string;
  readonly correct: boolean;
  readonly guesses: number;
}

type RoundStatus = "playing" | "won" | "lost";
type DailyStreetViewResult = { readonly missed: boolean; readonly wrongGuesses: number };

const ROUND_CACHE_TARGET_SIZE = 1;
const STREETVIEW_PRELOAD_SLOT_COUNT = 1;
const STREETVIEW_VISUAL_WARMUP_MS = 150;
const STREETVIEW_LOAD_TIMEOUT_MS = 1800;

interface StreetViewPreloadSlot {
  iframe: HTMLIFrameElement;
  url: string;
  ready: boolean;
  loadSequence: number;
  warmupTimer: number | null;
  loadTimeout: number | null;
}

function googleMapsEmbedApiKey(): string {
  return import.meta.env.VITE_GOOGLE_MAPS_EMBED_API_KEY?.trim() ?? "";
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

function createStreetViewIframe(title: string, className: string, hiddenFromAssistiveTech: boolean): HTMLIFrameElement {
  const attrs: Record<string, string> = {
    title,
    loading: "eager",
    referrerpolicy: "no-referrer-when-downgrade",
    allowfullscreen: "true",
  };

  if (hiddenFromAssistiveTech) {
    attrs.tabindex = "-1";
    attrs["aria-hidden"] = "true";
  }

  return el("iframe", { className, attrs });
}

function setStreetViewIframeActive(iframe: HTMLIFrameElement, isActive: boolean): void {
  iframe.classList.toggle("is-active", isActive);
  iframe.classList.toggle("is-buffer", !isActive);

  if (isActive) {
    iframe.removeAttribute("aria-hidden");
    iframe.removeAttribute("tabindex");
    return;
  }

  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("tabindex", "-1");
}

export function createStreetViewCountryScreen(options: StreetViewCountryScreenOptions, overrides: Partial<StreetViewCountryScreenServices> = {}): Screen {
  const services: StreetViewCountryScreenServices = {
    apiKey: googleMapsEmbedApiKey(),
    embedUrl: buildStreetViewEmbedUrl,
    fetchRounds: fetchStreetViewRounds,
    loadTimeoutMs: STREETVIEW_LOAD_TIMEOUT_MS,
    ...overrides,
  };
  const controller = new AbortController();
  const shell = shellOrFallback(options.shell, options.onHome);
  const apiKey = options.ranked ? "server-owned" : services.apiKey;
  const runRounds: RunRound[] = [];
  let runFinished = false;
  const isDailyChallenge = options.dailyChallenge !== undefined;
  // Outside the daily every run is scored ${STREET_VIEW_ATTEMPT_COUNTRIES} countries at 3/2/1/0 points by guesses used
  // (streetViewCountryPoints) and posts: a single-run mode, the board keeps your best.
  const scored = !isDailyChallenge;
  const runLength = scored ? STREET_VIEW_ATTEMPT_COUNTRIES : STREETVIEW_RUN_LENGTH;
  const maxAttempts = 3;
  const guessedCountryIds = new Set<CountryId>();
  const roundCache: StreetViewCountryRound[] = [];
  let status: RoundStatus = "playing";
  let attemptIndex = 0;
  const privateRound = (): StreetViewCountryRound => ({ countryCode: "", frames: Array.from({ length: 3 }, (_, i) => ({ lat: 0, lng: 0, heading: 0, label: `Frame ${i + 1}` })) });
  let round = options.ranked ? privateRound() : options.dailyChallenge?.round ?? chooseRound(options.countryIndex);
  let pendingDailyResult: DailyStreetViewResult | null = null;
  let dailyCompleted = false;
  let loadingRound = false;
  let activeStreetViewUrl = "";
  let desiredStreetViewUrl = "";
  let streetViewLoadSequence = 0;
  let cachePromise: Promise<void> | null = null;
  let streetViewFullscreen = false;

  function targetCountry(): Country {
    const country = options.countryIndex.byCode.get(round.countryCode);
    if (!country) throw new Error(`Unknown Street View country code: ${round.countryCode}`);
    return country;
  }

  const initialStreetViewFrame = createStreetViewIframe("Interactive Street View frame", "streetview-frame is-active", false);
  const streetViewIframes = [initialStreetViewFrame];
  const streetViewPreloadSlots: StreetViewPreloadSlot[] = Array.from({ length: STREETVIEW_PRELOAD_SLOT_COUNT }, (_, index) => {
    const iframe = createStreetViewIframe(`Preloaded Street View frame ${index + 1}`, "streetview-frame is-buffer", true);
    streetViewIframes.push(iframe);
    return { iframe, url: "", ready: false, loadSequence: 0, warmupTimer: null, loadTimeout: null };
  });
  let activeIframe = initialStreetViewFrame;
  const privateView = options.ranked ? createPrivateStreetView(options.ranked, controller.signal, () => attemptIndex) : null;
  const missingKeyPanel = el("div", {
    className: "streetview-missing-key",
    children: [
      el("strong", { text: "Street View isn’t set up here" }),
      el("p", { text: "This mode needs Google Street View, which isn’t available on this copy of Locato. These play right away:" }),
      el("div", {
        className: "streetview-missing-actions",
        children: isDailyChallenge
          ? [el("button", { className: "primary-action", text: "Skip this round", attrs: { type: "button" }, on: { click: () => { queueDailyStreetViewResult({ missed: true, wrongGuesses: 0 }); completeDailyStreetView(); } } })]
          : [
              el("button", { className: "primary-action", text: "Play Flags", attrs: { type: "button" }, on: { click: () => shell.openGame("flags") } }),
              el("button", { className: "ghost-action", text: "Play MapTap", attrs: { type: "button" }, on: { click: () => shell.openGame("map-tap") } }),
              el("button", { className: "ghost-action", text: "Try another game", attrs: { type: "button" }, on: { click: () => shell.openGamePicker({ current: "streetview-country" }) } }),
            ],
      }),
    ],
  });
  const runNumber = el("strong", { className: "stat-value", text: `1 / ${runLength}` });
  const pointsValue = el("strong", { className: "stat-value streetview-points", text: "0" });
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
  const revealButton = el("button", { className: "ghost-action", text: "Reveal", attrs: { type: "button" } });
  const feedback = createFeedbackView();
  const loadingOverlay = el("div", {
    className: "streetview-loader",
    attrs: { role: "status", "aria-live": "polite", "aria-atomic": "true", "aria-hidden": "true" },
    children: [
      el("div", {
        className: "streetview-loader-orbit",
        attrs: { "aria-hidden": "true" },
        children: [
          el("span", { className: "streetview-loader-ring" }),
          el("span", { className: "streetview-loader-ring is-delayed" }),
          el("span", { className: "streetview-loader-sweep" }),
          el("span", { className: "streetview-loader-pin" }),
        ],
      }),
      el("span", { className: "streetview-loader-status", text: "Loading Street View" }),
    ],
  });

  const form = el("form", {
    className: "guess-form streetview-guess-form",
    children: [el("label", { text: "Your country guess", attrs: { for: "streetview-guess-input" } }), el("div", { className: "input-row", children: [input, submitButton] })],
  });

  const statsPanel = el("div", {
    className: "stats-panel streetview-stats",
    children: [
      ...(isDailyChallenge ? [] : [el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Country" }), runNumber] })]),
      ...(scored ? [el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Points" }), pointsValue] })] : []),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Frame" }), frameNumber] }),
      el("div", { className: "stat-card", children: [el("span", { className: "stat-label", text: "Guesses left" }), guessesLeft] }),
      el("div", { className: "stat-card previous-guesses-card", children: [el("span", { className: "stat-label", text: "Previous" }), previousGuesses] }),
    ],
  });

  const streetViewPanel = el("div", {
    className: "streetview-stage",
    children: [...streetViewIframes, missingKeyPanel, loadingOverlay],
  });

  const answerPanel = el("aside", {
    className: "answer-panel streetview-panel",
    children: [
      el("div", { className: "panel-title", children: [el("span", { className: "eyebrow", text: isDailyChallenge ? `${options.dailyChallenge?.practice ? "Daily practice" : "Daily challenge"} · Street View` : "Street View country" }), el("h2", { text: "Guess the country" })] }),
      el("p", {
        className: "streetview-rules",
        text: isDailyChallenge
          ? "You get 3 interactive Street View frames from the same hidden country. A wrong answer loads the next frame."
          : scored
            ? `${runLength} countries, 3 frames each. ${STREET_VIEW_POINTS_BY_GUESS.join(" / ")} points for a first / second / third-guess answer, 0 if missed.`
            : `${runLength} countries, 3 Street View frames each. A wrong answer loads the next frame.`,
      }),
      form,
      statsPanel,
      feedback.element,
      roundResult,
      el("div", { className: "actions", children: [fullscreenButton, nextRoundButton, revealButton] }),
    ],
  });
  const layout = el("div", {
    className: "streetview-layout",
    children: [streetViewPanel, answerPanel],
  });
  const resultsStage = createResultsStage(layout);
  const element = el("section", { className: `game-screen streetview-country-screen gb-screen${apiKey ? "" : " is-unconfigured"}` });
  const bar = isDailyChallenge
    ? createDailyStageBar(element, {
        stage: "Street View",
        ...(options.dailyChallenge?.title ? { title: options.dailyChallenge.title } : {}),
        practice: options.dailyChallenge?.practice ?? false,
        ...(options.dailyChallenge?.progress ? { progress: options.dailyChallenge.progress } : {}),
        onLeave: options.onHome,
      })
    : createBestBar(element, shell, {
        gameMode: "streetview-country",
        storage: options.storage ?? shell.storage ?? null,
        extraMenuItems: apiKey ? [{ label: "Restart run", icon: "rotate-ccw", onSelect: () => restartRun() }] : [],
      });
  element.append(bar.element, layout, resultsStage.element);
  answerPanel.hidden = !apiKey;

  function previousGuessText(): string {
    const names = [...guessedCountryIds].map((countryId) => options.countryIndex.byId[countryId]?.name).filter((name): name is string => Boolean(name));
    return names.length > 0 ? names.join(", ") : "None";
  }

  function updateControls(): void {
    const attemptsUsed = attemptIndex + 1;
    const dailyResultReady = pendingDailyResult !== null && !dailyCompleted;
    element.classList.toggle("is-streetview-fullscreen", streetViewFullscreen);
    fullscreenButton.textContent = streetViewFullscreen ? "Exit" : "Fullscreen";
    fullscreenButton.setAttribute("aria-pressed", String(streetViewFullscreen));
    frameNumber.textContent = `${attemptsUsed} / ${maxAttempts}`;
    guessesLeft.textContent = String(Math.max(0, maxAttempts - guessedCountryIds.size));
    previousGuesses.textContent = previousGuessText();
    const showLoader = Boolean(apiKey && loadingRound);
    submitButton.disabled = status !== "playing" || !apiKey || loadingRound || dailyCompleted;
    input.disabled = status !== "playing" || !apiKey || loadingRound || dailyCompleted;
    runNumber.textContent = `${Math.min(runLength, runRounds.length + (status === "playing" ? 1 : 0))} / ${runLength}`;
    pointsValue.textContent = String(runPoints());
    revealButton.disabled = status !== "playing" || loadingRound || dailyCompleted;
    // Daily: the final guess / reveal queues the result and shows the answer; the stage only
    // completes when the player presses this button (so the answer is never skipped past).
    nextRoundButton.hidden = status === "playing" || (isDailyChallenge && !dailyResultReady);
    nextRoundButton.disabled = loadingRound || (isDailyChallenge && !dailyResultReady);
    const runComplete = runRounds.length >= runLength;
    nextRoundButton.textContent = isDailyChallenge
      ? dailyContinueLabel()
      : runComplete ? "See results" : loadingRound ? "Loading" : streetViewFullscreen ? "Next" : "Next country";
    roundResult.textContent = status === "won" ? `Correct — ${targetCountry().name}.` : status === "lost" ? `Answer — ${targetCountry().name}.` : "";
    missingKeyPanel.hidden = Boolean(apiKey);
    loadingOverlay.classList.toggle("is-active", showLoader);
    loadingOverlay.setAttribute("aria-hidden", String(!showLoader));
    streetViewPanel.classList.toggle("is-loading", showLoader);
    streetViewPanel.setAttribute("aria-busy", String(showLoader));
    for (const iframe of streetViewIframes) iframe.hidden = Boolean(options.ranked) || !apiKey;
  }

  function setStreetViewLoading(isLoading: boolean): void {
    if (loadingRound === isLoading) return;
    loadingRound = isLoading;
    updateControls();
  }

  function clearStreetViewPreloadSlot(slot: StreetViewPreloadSlot, removeSrc: boolean): void {
    if (slot.warmupTimer) {
      window.clearTimeout(slot.warmupTimer);
      slot.warmupTimer = null;
    }
    if (slot.loadTimeout) {
      window.clearTimeout(slot.loadTimeout);
      slot.loadTimeout = null;
    }

    slot.loadSequence += 1;
    slot.ready = false;
    slot.url = "";
    slot.iframe.onload = null;
    setStreetViewIframeActive(slot.iframe, false);
    if (removeSrc) slot.iframe.removeAttribute("src");
  }

  function restoreStreetViewPreloadSlotOwnership(): void {
    const inactiveIframes = streetViewIframes.filter((iframe) => iframe !== activeIframe);
    for (const [index, slot] of streetViewPreloadSlots.entries()) {
      const iframe = inactiveIframes[index];
      if (iframe) slot.iframe = iframe;
    }
  }

  function resetStreetViewFrames(): void {
    streetViewLoadSequence += 1;
    activeStreetViewUrl = "";
    desiredStreetViewUrl = "";
    activeIframe = initialStreetViewFrame;

    for (const iframe of streetViewIframes) {
      iframe.onload = null;
      iframe.removeAttribute("src");
      setStreetViewIframeActive(iframe, iframe === activeIframe);
    }

    restoreStreetViewPreloadSlotOwnership();
    for (const slot of streetViewPreloadSlots) clearStreetViewPreloadSlot(slot, false);
    setStreetViewLoading(false);
  }

  function findStreetViewPreloadSlot(url: string): StreetViewPreloadSlot | null {
    return streetViewPreloadSlots.find((slot) => slot.url === url) ?? null;
  }

  function upcomingStreetViewUrls(): string[] {
    if (!apiKey) return [];

    const urls: string[] = [];
    const addUrl = (url: string): void => {
      if (!url || url === activeStreetViewUrl || urls.includes(url)) return;
      urls.push(url);
    };

    if (status === "playing") {
      for (let nextAttemptIndex = attemptIndex + 1; nextAttemptIndex < maxAttempts; nextAttemptIndex += 1) {
        addUrl(services.embedUrl(apiKey, round, nextAttemptIndex));
      }
    }

    const nextCachedRound = roundCache[0];
    if (nextCachedRound) {
      for (let nextAttemptIndex = 0; nextAttemptIndex < maxAttempts; nextAttemptIndex += 1) {
        addUrl(services.embedUrl(apiKey, nextCachedRound, nextAttemptIndex));
      }
    }

    for (const cachedRound of roundCache.slice(1)) {
      addUrl(services.embedUrl(apiKey, cachedRound, 0));
    }

    return urls.slice(0, STREETVIEW_PRELOAD_SLOT_COUNT);
  }

  function protectedStreetViewUrls(extraUrl?: string): Set<string> {
    const urls = new Set(upcomingStreetViewUrls());
    if (desiredStreetViewUrl) urls.add(desiredStreetViewUrl);
    if (extraUrl) urls.add(extraUrl);
    return urls;
  }

  function chooseStreetViewPreloadSlot(url: string): StreetViewPreloadSlot | null {
    const existing = findStreetViewPreloadSlot(url);
    if (existing) return existing;

    const emptySlot = streetViewPreloadSlots.find((slot) => !slot.url);
    if (emptySlot) return emptySlot;

    // The visible frame takes priority over future ones. A background preload only takes a slot
    // holding nothing we still need (the desired frame is always protected); otherwise it waits
    // (null) rather than evicting the only slot while the visible frame is still loading. The
    // desired frame itself may take any slot that isn't already holding it.
    const protectedUrls = protectedStreetViewUrls(url);
    const reusableSlot = streetViewPreloadSlots.find((slot) => !protectedUrls.has(slot.url))
      ?? (url === desiredStreetViewUrl ? streetViewPreloadSlots.find((slot) => slot.url !== desiredStreetViewUrl) : undefined);
    if (!reusableSlot) return null;
    clearStreetViewPreloadSlot(reusableSlot, true);
    return reusableSlot;
  }

  function promoteStreetViewPreloadSlot(slot: StreetViewPreloadSlot): void {
    if (!slot.ready || !slot.url || slot.url !== desiredStreetViewUrl || controller.signal.aborted) return;

    const nextActiveIframe = slot.iframe;
    const previousActiveIframe = activeIframe;

    if (nextActiveIframe !== previousActiveIframe) {
      setStreetViewIframeActive(previousActiveIframe, false);
      setStreetViewIframeActive(nextActiveIframe, true);
      activeIframe = nextActiveIframe;
      slot.iframe = previousActiveIframe;
    }

    activeStreetViewUrl = slot.url;
    clearStreetViewPreloadSlot(slot, true);
    setStreetViewLoading(false);
    preloadUpcomingStreetViewFrames();
  }

  function loadStreetViewPreload(url: string): void {
    if (!apiKey || !url || url === activeStreetViewUrl) return;

    const slot = chooseStreetViewPreloadSlot(url);
    if (!slot) return;
    if (slot.url === url) {
      if (slot.ready && desiredStreetViewUrl === url) promoteStreetViewPreloadSlot(slot);
      return;
    }

    clearStreetViewPreloadSlot(slot, true);
    const loadSequence = ++streetViewLoadSequence;
    slot.loadSequence = loadSequence;
    slot.url = url;
    slot.ready = false;
    const finishLoading = (waitForVisualWarmup: boolean): void => {
      if (controller.signal.aborted || slot.loadSequence !== loadSequence || slot.url !== url) return;
      if (slot.loadTimeout) {
        window.clearTimeout(slot.loadTimeout);
        slot.loadTimeout = null;
      }

      const markReady = (): void => {
        if (controller.signal.aborted || slot.loadSequence !== loadSequence || slot.url !== url) return;
        slot.ready = true;
        if (desiredStreetViewUrl === url) promoteStreetViewPreloadSlot(slot);
      };

      // The Google iframe fires load before the panorama tiles have necessarily painted.
      // Keep it hidden for a short warm-up period so the promoted iframe is not a black screen.
      if (waitForVisualWarmup) {
        slot.warmupTimer = window.setTimeout(() => {
          slot.warmupTimer = null;
          markReady();
        }, STREETVIEW_VISUAL_WARMUP_MS);
      } else {
        markReady();
      }
    };

    slot.iframe.onload = () => {
      finishLoading(true);
    };
    slot.loadTimeout = window.setTimeout(() => {
      // Some embed failures never dispatch iframe load/error events. Show the iframe anyway so
      // the player is not trapped behind the loading overlay while Google retries or reports its
      // own API message.
      finishLoading(false);
    }, services.loadTimeoutMs);
    slot.iframe.setAttribute("src", url);
  }

  function preloadUpcomingStreetViewFrames(): void {
    if (!apiKey || controller.signal.aborted) return;
    for (const url of upcomingStreetViewUrls()) loadStreetViewPreload(url);
  }

  function showStreetViewUrl(url: string): void {
    if (url === activeStreetViewUrl) {
      desiredStreetViewUrl = url;
      setStreetViewLoading(false);
      preloadUpcomingStreetViewFrames();
      return;
    }

    desiredStreetViewUrl = url;
    setStreetViewLoading(true);

    const slot = findStreetViewPreloadSlot(url);
    if (slot?.ready) {
      promoteStreetViewPreloadSlot(slot);
      return;
    }

    loadStreetViewPreload(url);
    preloadUpcomingStreetViewFrames();
  }

  function renderStreetView(): void {
    if (privateView) {
      const stage = initialStreetViewFrame.parentElement;
      if (stage && privateView.element.parentElement !== stage) stage.prepend(privateView.element);
      for (const button of privateView.element.querySelectorAll<HTMLButtonElement>("button")) button.disabled = status !== "playing";
      if (status === "playing") void privateView.show({ lat: 0, lng: 0, heading: 0, label: "", countryCode: "" });
      return;
    }
    if (!apiKey) {
      resetStreetViewFrames();
      return;
    }

    const nextSrc = services.embedUrl(apiKey, round, attemptIndex);
    showStreetViewUrl(nextSrc);
    preloadUpcomingStreetViewFrames();
  }

  function render(): void {
    updateControls();
    renderStreetView();
  }

  function resetCurrentCountry(message?: string, tone: "neutral" | "good" | "bad" = "neutral"): void {
    guessedCountryIds.clear();
    status = "playing";
    attemptIndex = 0;
    pendingDailyResult = null;
    input.value = "";
    render();
    if (message) showFeedback(feedback, message, tone);
    input.focus();
  }

  async function fillRoundCache(): Promise<void> {
    if (options.ranked) return;
    if (isDailyChallenge || !apiKey || controller.signal.aborted) return;
    if (cachePromise) return cachePromise;

    const needed = ROUND_CACHE_TARGET_SIZE - roundCache.length;
    if (needed <= 0) {
      preloadUpcomingStreetViewFrames();
      return;
    }

    cachePromise = services.fetchRounds(options.countryIndex, needed, controller.signal)
      .then((rounds) => {
        for (const candidate of rounds) {
          if (roundCache.length >= ROUND_CACHE_TARGET_SIZE) break;
          roundCache.push(candidate);
        }
        preloadUpcomingStreetViewFrames();
      })
      .finally(() => {
        cachePromise = null;
      });

    return cachePromise;
  }

  function warmRoundCache(): void {
    if (!isDailyChallenge) void fillRoundCache();
  }

  function takeCachedRound(): StreetViewCountryRound | null {
    const cached = roundCache.shift() ?? null;
    warmRoundCache();
    return cached;
  }

  function startNextRound(message = "Next country loaded.", tone: "neutral" | "good" | "bad" = "neutral"): void {
    if (options.ranked) { round = privateRound(); resetCurrentCountry(message, tone); return; }
    const cachedRound = takeCachedRound();
    round = cachedRound ?? chooseRound(options.countryIndex);
    lastStreetViewCountryCode = round.countryCode;
    resetCurrentCountry(message, tone);
  }

  /** "Continue daily challenge" between stages; "See results" when this is the daily's last round. */
  function dailyContinueLabel(): string {
    const progress = options.dailyChallenge?.progress;
    const isLastStage = !progress || progress.round >= progress.total;
    if (isLastStage) return streetViewFullscreen ? "Results" : "See results";
    return streetViewFullscreen ? "Continue" : options.dailyChallenge?.practice ? "Continue practice" : "Continue daily challenge";
  }

  function queueDailyStreetViewResult(result: DailyStreetViewResult): void {
    if (!options.dailyChallenge || dailyCompleted) return;
    pendingDailyResult = result;
    options.dailyChallenge.onResult?.(result);
  }

  function completeDailyStreetView(): void {
    if (!options.dailyChallenge || dailyCompleted || !pendingDailyResult) return;
    dailyCompleted = true;
    options.dailyChallenge.onComplete(pendingDailyResult);
  }

  function recordRunRound(correct: boolean, guesses: number): void {
    if (isDailyChallenge || runFinished || runRounds.length >= runLength) return;
    runRounds.push({ code: round.countryCode, correct, guesses });
  }

  function roundPoints(item: RunRound): number {
    return streetViewCountryPoints(item.correct ? item.guesses : null);
  }

  function runPoints(): number {
    return runRounds.reduce((sum, item) => sum + roundPoints(item), 0);
  }

  function countryNameFor(code: string): string {
    return options.countryIndex.byCode.get(code)?.name ?? code;
  }

  function showResults(): void {
    if (runFinished) return;
    runFinished = true;
    streetViewFullscreen = false;
    updateControls();
    const correct = runRounds.filter((item) => item.correct).length;
    const guesses = runRounds.reduce((sum, item) => sum + item.guesses, 0);
    const countries = runRounds.map((item) => ({ code: item.code, name: countryNameFor(item.code), flagSrc: `/assets/flags/${item.code.toLowerCase()}.svg` }));
    const squares = runRounds.map((item) => (item.correct ? (item.guesses <= 1 ? "🟩" : "🟨") : "⬜")).join("");
    const runList = createRunList("Round by round", runRounds.map((item) => ({
      label: countryNameFor(item.code),
      detail: item.correct ? `Found with ${item.guesses} ${item.guesses === 1 ? "guess" : "guesses"}` : "Missed",
      value: `+${roundPoints(item)}`,
      tone: item.correct ? (item.guesses <= 1 ? "good" : "ok") : "miss",
      flagSrc: `/assets/flags/${item.code.toLowerCase()}.svg`,
      ariaLabel: `${countryNameFor(item.code)} in the Atlas`,
      onClick: () => shell.openCountry(item.code),
    })));
    // Every finished run counts: it posts, and the board keeps your best.
    const total = runPoints();
    const maximum = runLength * STREET_VIEW_POINTS_BY_GUESS[0];
    const storage = options.storage ?? shell.storage ?? null;
    const previousBest = readSingleBest(storage, "streetview-country");
    const posting = submitRankedAttempt({ shell, mode: "streetview-country", total, storage, ...(options.ranked ? { post: options.ranked.post } : services.postAttempt ? { post: services.postAttempt } : {}) });
    if ("refreshBest" in bar) bar.refreshBest();
    const isNewBest = total > previousBest;
    const card = createRankedResults(shell, {
      mode: "streetview-country",
      title: isNewBest && previousBest > 0 ? "A new best run!" : total === maximum ? "A perfect run!" : correct >= 3 ? "Well spotted" : "Run complete",
      total,
      stats: [
        { label: "Total score", value: String(total), note: `of ${maximum}` },
        { label: "Correct", value: `${correct}/${runLength}` },
        { label: "Guesses used", value: String(guesses), note: `of ${runLength * maxAttempts}` },
        { label: "Your best", value: String(Math.max(previousBest, total)), note: isNewBest ? "New best" : "On this device" },
      ],
      missed: countries,
      missedTitle: "The countries in this run",
      shareTitle: "Locato Street View",
      shareText: `Locato Street View ${total}/${maximum}\n${squares}\nlocato.quest`,
      onTryAgain: restartRun,
      posting,
      tone: correct >= 3 ? "celebrate" : "neutral",
    });
    insertIntoResults(card, runList);
    resultsStage.show(card);
  }

  async function restartRun(): Promise<void> {
    if (options.ranked) {
      loadingRound = true; render();
      try { await options.ranked.start(); } catch (error) { showFeedback(feedback, (error as Error).message, "bad"); return; }
      finally { loadingRound = false; }
      if (controller.signal.aborted) return;
    }
    runRounds.splice(0);
    runFinished = false;
    resultsStage.hide();
    startNextRound("New run. Five fresh countries.");
  }

  async function handleGuess(): Promise<void> {
    if (status !== "playing" || loadingRound) return;
    const guess = submitCountryGuess(options.countryIndex, input.value, guessedCountryIds);
    if (!guess) {
      showFeedback(feedback, "I couldn't match that to a country. Try a full country name.", "neutral");
      input.select();
      return;
    }

    guessedCountryIds.add(guess.id);
    input.value = "";

    if (options.ranked) {
      loadingRound = true; updateControls();
      try {
        const state = await options.ranked.move({ type: "answer", answer: guess.name });
        if (controller.signal.aborted) return;
        loadingRound = false;
        const detail = state.result;
        if (detail?.countryCode) {
          round = { ...round, countryCode: detail.countryCode };
          const correct = detail.kind === "correct";
          recordRunRound(correct, guessedCountryIds.size);
          if (!correct) { status = "lost"; render(); showFeedback(feedback, `Answer — ${targetCountry().name}.`, "bad"); }
          else if (runRounds.length >= runLength) { status = "won"; render(); showResults(); }
          else startNextRound(`Correct — ${targetCountry().name}. Next country loaded.`, "good");
        } else { attemptIndex++; render(); showFeedback(feedback, `Not ${guess.name}. New frame loaded.`, "bad"); }
      } catch (error) { loadingRound = false; guessedCountryIds.delete(guess.id); render(); showFeedback(feedback, (error as Error).message, "bad"); }
      return;
    }

    if (guess.code === round.countryCode) {
      const countryName = targetCountry().name;
      if (isDailyChallenge) {
        status = "won";
        queueDailyStreetViewResult({ missed: false, wrongGuesses: attemptIndex });
        render();
        showFeedback(feedback, `Correct — ${countryName}. +${scoreDailyRound(0, false, attemptIndex)} points.`, "good");
        return;
      }
      recordRunRound(true, guessedCountryIds.size);
      const earned = scored ? ` +${streetViewCountryPoints(guessedCountryIds.size)} ${streetViewCountryPoints(guessedCountryIds.size) === 1 ? "point" : "points"}.` : "";
      if (runRounds.length >= runLength) {
        status = "won";
        render();
        showResults();
        return;
      }
      startNextRound(`Correct — ${countryName}.${earned} Next country loaded.`, "good");
      return;
    }

    if (attemptIndex >= maxAttempts - 1) {
      const countryName = targetCountry().name;
      status = "lost";
      recordRunRound(false, guessedCountryIds.size);
      queueDailyStreetViewResult({ missed: true, wrongGuesses: maxAttempts });
      render();
      showFeedback(feedback, `Not ${guess.name}. Answer — ${countryName}.`, "bad");
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
  nextRoundButton.addEventListener("click", () => {
    if (isDailyChallenge) completeDailyStreetView();
    else if (runRounds.length >= runLength) showResults();
    else startNextRound();
  }, { signal: controller.signal });
  revealButton.addEventListener(
    "click",
    async () => {
      if (loadingRound) return;
      if (options.ranked) {
        loadingRound = true; updateControls();
        try {
          const state = await options.ranked.move({ type: "skip" });
          if (controller.signal.aborted) return;
          round = { ...round, countryCode: state.result!.countryCode! };
        } catch (error) { showFeedback(feedback, (error as Error).message, "bad"); return; }
        finally { loadingRound = false; }
      }
      status = "lost";
      recordRunRound(false, guessedCountryIds.size);
      queueDailyStreetViewResult({ missed: true, wrongGuesses: attemptIndex });
      render();
      showFeedback(feedback, `Revealed: ${targetCountry().name}.`, "neutral");
    },
    { signal: controller.signal },
  );
  bindKeyboardAwareInput(element, input, controller.signal);

  render();
  if (!apiKey) showFeedback(feedback, "Street View is unavailable right now. Try another game or use Reveal to continue.", "neutral");
  warmRoundCache();
  queueMicrotask(() => input.focus());

  return {
    element,
    destroy: () => {
      controller.abort();
      privateView?.destroy();
      resetStreetViewFrames();
    },
  };
}
