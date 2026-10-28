import type { Screen } from "../../app/router";
import type { Country, CountryIndex } from "../../core/countries";
import { getCountryProfile, formatPopulation } from "../../core/countries/profiles";
import { createRandomSeed } from "../../core/game/random";
import type { GameModeId } from "../../core/gameModes";
import { MYSTERY_ATTEMPT_COUNTRIES } from "../../core/leaderboards";
import type { WorldCountryFeature } from "../../core/map";
import {
  MYSTERY_GUESS_PENALTY,
  MYSTERY_HINT_PENALTY,
  MYSTERY_MAX_GUESSES,
  MYSTERY_MAX_HINTS,
  MYSTERY_MAX_POINTS,
  createDailyMysteryTarget,
  createMysteryRound,
  createMysteryTargets,
  guessMystery,
  hintMystery,
  mysteryDailyNumber,
  mysteryDailyShareText,
  mysteryHintText,
  mysteryRoundPoints,
  mysteryShareSquare,
  revealMystery,
  type Comparison,
  type MysteryClues,
  type MysteryGuess,
  type MysteryRound,
  type MysteryStatus,
} from "../../core/mystery";
import { readMysteryDailyStats, readMysteryDay, saveMysteryDay } from "../../storage/mysteryDaily";
import { createCountryGuessInput } from "../components/countryGuessInput";
import { createWorldMapView } from "../dom/renderWorldMap";
import { el } from "../dom/createElement";
import { shouldAutoFocusTextInput } from "../dom/mobileKeyboard";
import { shellIcon } from "../shell/icons";
import { prefersReducedMotion, shellLayer, trapOverlay } from "../shell/layer";
import { shareResult, type ResultsMissedCountry } from "../shell/ResultsCard";
import type { ShellContext } from "../shell/types";
import { createResultsStage, createRunList, formatNumber, insertIntoResults, shellOrFallback } from "./practiceRun";
import { createBestBar, createRankedResults, readSingleBest, submitRankedAttempt, type PostRankedAttempt } from "./rankedAttempt";
import type { RankedSession } from "./RankedSession";
import { trackGameComplete } from "../../app/analytics";
import "../../styles/mystery.css";
import { shareLink } from "../../core/shareLink";

export interface MysteryScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly countryIndex: CountryIndex;
  readonly storage: Storage;
  readonly onGameModeChange: (mode: GameModeId) => void;
  readonly onHome: () => void;
  readonly onDailyChallenge?: () => void;
  /** Signed in: the server hides the countries and works out every clue. */
  readonly ranked?: RankedSession;
  /** Today's mystery: one country for everyone on `date` (YYYY-MM-DD), saved on this device with a streak. */
  readonly today?: { readonly date: string };
  /** Links between today's mystery and the five-country run. */
  readonly onToday?: () => void;
  readonly onPlayRun?: () => void;
}

export interface MysteryScreenServices {
  /** Posts a finished run's total (defaults to the leaderboard API). */
  readonly postAttempt?: PostRankedAttempt;
  /** Seed for a guest's first run (tests); later runs always get a fresh one. */
  readonly seed?: string;
}

/** What the screen knows of the current country; the answer arrives only once it's over when ranked. */
interface CountryState {
  readonly guesses: readonly MysteryGuess[];
  readonly hints: readonly string[];
  readonly status: MysteryStatus;
  readonly target: string | null;
  readonly points: number;
}

const MAX_RUN_POINTS = MYSTERY_ATTEMPT_COUNTRIES * MYSTERY_MAX_POINTS;
const HEAT = ["found", "hot", "warm", "mild", "cold"] as const;
type Heat = (typeof HEAT)[number];
const COMPASS_WORDS: Readonly<Record<string, string>> = { N: "north", NE: "north-east", E: "east", SE: "south-east", S: "south", SW: "south-west", W: "west", NW: "north-west" };
let howToCount = 0;

function heatOf(clues: MysteryClues): Heat {
  return clues.correct ? "found" : clues.proximity >= 90 ? "hot" : clues.proximity >= 75 ? "warm" : clues.proximity >= 55 ? "mild" : "cold";
}

function comparisonText(comparison: Comparison, kind: "population" | "area"): { readonly text: string; readonly label: string } {
  if (kind === "population") {
    return comparison === "higher" ? { text: "People ↑", label: "The mystery country has more people" }
      : comparison === "lower" ? { text: "People ↓", label: "The mystery country has fewer people" } : { text: "People ≈", label: "About as many people" };
  }
  return comparison === "higher" ? { text: "Size ↑", label: "The mystery country is bigger" }
    : comparison === "lower" ? { text: "Size ↓", label: "The mystery country is smaller" } : { text: "Size ≈", label: "About the same size" };
}

/** Copy the whole result (score line, squares, link) straight to the clipboard; share sheet as a fallback. */
async function copyShareText(text: string): Promise<"copied" | "shared" | "failed"> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    // Fall back to the share sheet below.
  }
  return shareResult({ title: "Locato Mystery country", text });
}

function openHowToPlay(): void {
  howToCount += 1;
  const titleId = `mystery-howto-${howToCount}`;
  const done = el("button", { className: "shell-btn shell-btn-primary", text: "Got it", attrs: { type: "button" } });
  const item = (title: string, text: string) => el("li", { children: [el("strong", { text: title }), el("span", { text })] });
  const surface = el("div", {
    className: "shell-dialog mystery-howto",
    attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" },
    children: [
      el("h2", { className: "shell-dialog-title", text: "How to play Mystery country", attrs: { id: titleId } }),
      el("p", { className: "shell-dialog-message", text: `Find the hidden country in ${MYSTERY_MAX_GUESSES} guesses. Type any country, or tap one on the map. Every guess tells you:` }),
      el("ul", {
        className: "mystery-howto-list",
        children: [
          item("Distance and direction", "How far the mystery country's centre is from your guess's, and which way to head. Directions follow the shortest path around the globe, so they can point over a pole."),
          item("Heat", "The closer you are, the warmer your guess glows on the map."),
          item("Continent and borders", "Whether it's on the same continent, and whether your guess borders it."),
          item("People and size", "Whether the mystery country has more or fewer people, and is bigger or smaller."),
          item("Coast and driving side", "Your first guess already tells you if it's landlocked and which side it drives on."),
        ],
      }),
      el("p", { className: "shell-dialog-message", text: `A country is worth up to ${MYSTERY_MAX_POINTS} points: each guess after the first costs ${MYSTERY_GUESS_PENALTY}, and each hint ${MYSTERY_HINT_PENALTY}.` }),
      el("div", { className: "shell-dialog-actions", children: [done] }),
    ],
  });
  const scrim = el("div", { className: "shell-scrim shell-dialog-scrim", attrs: { "data-open": "true" }, children: [surface] });
  shellLayer().append(scrim);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.release();
    scrim.remove();
  };
  const overlay = trapOverlay({ surface, onDismiss: close, initialFocus: done });
  done.addEventListener("click", close);
}

export function createMysteryScreen(options: MysteryScreenOptions, services: MysteryScreenServices = {}): Screen {
  const controller = new AbortController();
  const { signal } = controller;
  const shell = shellOrFallback(options.shell, options.onHome);
  const { countryIndex, ranked, today } = options;
  const country = (code: string): Country | undefined => countryIndex.byCode.get(code);
  const nameOf = (code: string): string => country(code)?.name ?? code;
  const totalCountries = today ? 1 : MYSTERY_ATTEMPT_COUNTRIES;

  let localTargets: readonly string[] = ranked || today ? [] : createMysteryTargets(services.seed ?? createRandomSeed());
  let index = 0;
  /** Guest and today play: the full round, answer included. Ranked play keeps only `state`. */
  let localRound: MysteryRound | null = null;
  let state: CountryState = { guesses: [], hints: [], status: "playing", target: null, points: 0 };
  const finished: CountryState[] = [];
  let busy = false;

  // ---- Map ---------------------------------------------------------------------------------
  const view = createWorldMapView(options.worldCountryFeatures, countryIndex, {
    // Tapping a country fills in its name; Enter (or Add) makes it the guess.
    onCountryClick: (countryId) => {
      const picked = countryIndex.byId[countryId];
      if (!picked || state.status !== "playing" || busy) return;
      guessInput.input.value = picked.name;
      view.showCountryLabel(countryId);
      setFeedback(`${picked.name}: press Enter or Add to guess it.`);
    },
  });
  view.element.classList.add("mystery-map");
  const pathByCode = new Map<string, SVGPathElement>();
  const dotByCode = new Map<string, SVGCircleElement>();
  for (const [countryId, path] of view.pathByCountryId) {
    const code = countryIndex.byId[countryId]?.code;
    if (!code) continue;
    pathByCode.set(code, path);
    const dot = view.missingDotByCountryId.get(countryId);
    if (dot) dotByCode.set(code, dot);
  }
  const legend = el("ul", {
    className: "mystery-legend",
    attrs: { "aria-label": "Map colours" },
    children: (["hot", "warm", "mild", "cold", "found"] as const).map((heat) => el("li", {
      children: [el("span", { className: `mystery-swatch is-${heat}`, attrs: { "aria-hidden": "true" } }), el("span", { text: heat === "found" ? "Found" : heat[0]!.toUpperCase() + heat.slice(1) })],
    })),
  });
  const mapShell = el("div", { className: "mystery-map-shell", children: [view.element, legend] });

  function paint(code: string, heat: Heat | "answer" | null): void {
    const path = pathByCode.get(code);
    const dot = dotByCode.get(code);
    for (const target of [path, dot]) target?.classList.remove(...HEAT.map((item) => `is-my-${item}`), "is-my-answer", "is-my-marked");
    if (!heat) return;
    path?.classList.add(`is-my-${heat}`);
    dot?.classList.add(`is-my-${heat}`, "is-my-marked");
    if (path) path.parentNode?.append(path);
  }

  // ---- Panel -------------------------------------------------------------------------------
  const todayLabel = today ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${today.date}T12:00:00Z`)) : "";
  const eyebrow = el("span", { className: "eyebrow mystery-eyebrow" });
  const howToButton = el("button", { className: "mystery-link", text: "How to play", attrs: { type: "button" }, on: { click: openHowToPlay } });
  const switchLink = today && options.onPlayRun
    ? el("button", { className: "mystery-link", text: "5-country run", attrs: { type: "button" }, on: { click: () => options.onPlayRun?.() } })
    : !today && options.onToday
      ? el("button", { className: "mystery-link mystery-today-link", text: "Today's mystery", attrs: { type: "button" }, on: { click: () => options.onToday?.() } })
      : null;
  const progressLabel = el("span", { className: "mystery-progress-label" });
  const scoreLabel = el("strong", { className: "mystery-running-score", text: "0 pts" });
  const progressDots = Array.from({ length: MYSTERY_ATTEMPT_COUNTRIES }, () => el("span", { className: "mystery-progress-dot" }));
  const progress = el("div", { className: "mystery-progress", children: [el("div", { children: [progressLabel, scoreLabel] }), el("div", { className: "mystery-progress-dots", children: progressDots })] });
  progress.hidden = totalCountries === 1;

  const guessInput = createCountryGuessInput({
    prefix: "mystery",
    countryIndex,
    label: "Guess a country",
    signal,
    exclude: () => new Set(state.guesses.map((guess) => guess.code)),
    onPick: (picked) => void submitGuess(picked.code),
    onEmpty: () => setFeedback("Type a country, or tap one on the map.", "warn"),
    onUnknown: (text, ambiguous) => setFeedback(ambiguous ? "Which one? Pick a country from the list." : `No country called “${text}”. Check the spelling.`, "warn"),
    onType: () => { if (feedback.dataset.tone === "warn") setFeedback(""); },
  });
  const { feedback } = guessInput;

  const meterLabel = el("span", { className: "mystery-meter-label" });
  const meterPips = el("div", { className: "mystery-meter-pips", attrs: { "aria-hidden": "true" } });
  const known = el("p", { className: "mystery-known" });
  const hintButton = el("button", { className: "mystery-hint", attrs: { type: "button" } });
  const hintNotes = el("ul", { className: "mystery-hint-notes" });
  const giveUpButton = el("button", { className: "mystery-link mystery-give-up", text: "Give up on this country", attrs: { type: "button" } });
  const guessList = el("ol", { className: "mystery-guesses", attrs: { "aria-label": "Your guesses, newest first" } });
  const playControls = el("div", {
    className: "mystery-play-controls",
    children: [
      guessInput.form,
      el("div", { className: "mystery-meter", children: [el("div", { className: "mystery-meter-head", children: [el("span", { text: "Guesses" }), meterLabel] }), meterPips] }),
      known,
      el("div", { className: "mystery-hints", children: [hintButton, hintNotes] }),
      giveUpButton,
    ],
  });
  const outcome = el("section", { className: "mystery-outcome", attrs: { "aria-live": "polite" } });
  outcome.hidden = true;
  const nextButton = el("button", { className: "primary-action mystery-next", attrs: { type: "button" } });

  const panel = el("aside", {
    className: "mystery-panel",
    children: [
      el("div", {
        className: "mystery-panel-title",
        children: [
          el("div", { className: "mystery-title-row", children: [eyebrow, el("div", { className: "mystery-title-links", children: [...(switchLink ? [switchLink] : []), howToButton] })] }),
          el("h1", { className: "mystery-title", text: "Which country is it?" }),
          el("p", { className: "mystery-detail", text: "Guess any country: each guess says how far away the mystery country is, which way, and how the two compare." }),
        ],
      }),
      progress,
      playControls,
      outcome,
      guessList,
    ],
  });

  // ---- Rendering ---------------------------------------------------------------------------
  function setFeedback(text: string, tone: "neutral" | "warn" | Heat = "neutral"): void {
    feedback.textContent = text;
    feedback.dataset.tone = tone;
  }

  function totalScore(): number {
    return finished.reduce((sum, item) => sum + item.points, 0);
  }

  function updateProgress(): void {
    const done = finished.length >= totalCountries;
    progressLabel.textContent = done ? "Run complete" : `Country ${index + 1} of ${MYSTERY_ATTEMPT_COUNTRIES}`;
    scoreLabel.textContent = `${formatNumber(totalScore())} pts`;
    progressDots.forEach((dot, position) => {
      dot.classList.toggle("is-complete", position < finished.length);
      dot.classList.toggle("is-active", !done && position === index);
    });
  }

  function clueChip(text: string, tone: "yes" | "no" | "neutral", label: string): HTMLElement {
    return el("span", { className: `mystery-chip is-${tone}`, text, attrs: { title: label, "aria-label": label } });
  }

  function guessRow(guess: MysteryGuess, position: number): HTMLElement {
    const { clues } = guess;
    const heat = heatOf(clues);
    const flag = country(guess.code)?.flagSrc;
    const arrow = el("span", { className: "mystery-arrow", attrs: { "aria-hidden": "true" }, children: [shellIcon(clues.correct ? "check" : "arrow-right", 16, 2.4)] });
    if (clues.bearing !== null) arrow.style.transform = `rotate(${clues.bearing - 90}deg)`;
    const population = comparisonText(clues.population, "population");
    const area = comparisonText(clues.area, "area");
    return el("li", {
      className: `mystery-guess is-${heat}`,
      children: [
        el("div", {
          className: "mystery-guess-main",
          children: [
            el("span", { className: "mystery-guess-index", text: String(position + 1) }),
            ...(flag ? [el("img", { className: "mystery-guess-flag", attrs: { src: flag, alt: "", width: "24", height: "16", loading: "lazy", decoding: "async" } })] : []),
            el("strong", { className: "mystery-guess-name", text: nameOf(guess.code) }),
            el("span", { className: "mystery-guess-distance", text: clues.correct ? "Found!" : `${formatNumber(clues.distanceKm)} km` }),
            el("span", {
              className: "mystery-guess-direction",
              attrs: { "aria-label": clues.direction ? `Head ${COMPASS_WORDS[clues.direction]}` : "This is it" },
              children: [arrow, el("span", { text: clues.direction ?? "" })],
            }),
            el("span", { className: "mystery-guess-proximity", text: `${clues.proximity}%` }),
          ],
        }),
        ...(clues.correct ? [] : [el("div", {
          className: "mystery-guess-clues",
          children: [
            clueChip(clues.sameContinent ? "Same continent" : "Other continent", clues.sameContinent ? "yes" : "no", clues.sameContinent ? "On the same continent" : "On another continent"),
            ...(clues.neighbour ? [clueChip("Borders it", "yes", "Your guess shares a border with the mystery country")] : []),
            clueChip(population.text, "neutral", population.label),
            clueChip(area.text, "neutral", area.label),
          ],
        })]),
      ],
    });
  }

  /** "It's landlocked and drives on the left": known from the first guess. */
  function knownFacts(): string {
    const first = state.guesses[0];
    const profile = first ? getCountryProfile(first.code) : null;
    if (!first || !profile || first.clues.correct) return "";
    const landlocked = first.clues.sameLandlocked ? profile.landlocked : !profile.landlocked;
    const side = first.clues.sameDrivingSide ? profile.drivingSide : profile.drivingSide === "left" ? "right" : "left";
    return `It's ${landlocked ? "landlocked" : "on the coast"} and drives on the ${side}.`;
  }

  function render(): void {
    guessList.replaceChildren(...state.guesses.map(guessRow).reverse());
    meterLabel.textContent = `${state.guesses.length} of ${MYSTERY_MAX_GUESSES}`;
    meterPips.replaceChildren(...Array.from({ length: MYSTERY_MAX_GUESSES }, (_, position) => {
      const guess = state.guesses[position];
      return el("span", { className: `mystery-pip${guess ? ` is-${heatOf(guess.clues)}` : ""}` });
    }));
    known.textContent = knownFacts();
    const used = state.hints.length;
    hintButton.replaceChildren(
      shellIcon("lightbulb", 17, 2),
      el("span", { className: "mystery-hint-copy", text: used >= MYSTERY_MAX_HINTS ? "No hints left" : `Hint ${used + 1} of ${MYSTERY_MAX_HINTS}: ${used === 0 ? "its region" : "its first letter"}` }),
      ...(used < MYSTERY_MAX_HINTS ? [el("span", { className: "mystery-hint-cost", text: `−${MYSTERY_HINT_PENALTY}` })] : []),
    );
    hintNotes.replaceChildren(...state.hints.map((text) => el("li", { text })));
    const playing = state.status === "playing";
    hintButton.disabled = busy || !playing || used >= MYSTERY_MAX_HINTS;
    giveUpButton.disabled = busy || !playing;
    guessInput.setState({ disabled: !playing, busy });
  }

  function setBusy(value: boolean): void {
    busy = value;
    render();
  }

  // ---- Countries ---------------------------------------------------------------------------
  function startCountry(): void {
    for (const code of pathByCode.keys()) paint(code, null);
    view.showCountryLabel(null);
    view.resetView({ animate: false });
    outcome.hidden = true;
    outcome.replaceChildren();
    playControls.hidden = false;
    guessInput.clear();
    setFeedback("");
    eyebrow.textContent = today ? `Today's mystery · ${todayLabel}` : `Mystery country · ${index + 1} of ${MYSTERY_ATTEMPT_COUNTRIES}`;
    if (ranked) {
      localRound = null;
      state = { guesses: [], hints: [], status: "playing", target: null, points: 0 };
    } else {
      const target = today ? createDailyMysteryTarget(today.date) : localTargets[index]!;
      localRound = (today ? readMysteryDay(options.storage, today.date, target) : null) ?? createMysteryRound(target);
      state = fromRound(localRound);
    }
    for (const guess of state.guesses) paint(guess.code, heatOf(guess.clues));
    render();
    updateProgress();
    if (state.status !== "playing") {
      endCountry(true);
      return;
    }
    if (shouldFocusInput()) guessInput.focus();
  }

  function fromRound(round: MysteryRound): CountryState {
    return {
      guesses: round.guesses,
      hints: Array.from({ length: round.hintsUsed }, (_, level) => mysteryHintText(round.target, level + 1)),
      status: round.status,
      target: round.status === "playing" ? null : round.target,
      points: mysteryRoundPoints(round),
    };
  }

  function shouldFocusInput(): boolean {
    try {
      return typeof window.matchMedia === "function" && shouldAutoFocusTextInput();
    } catch {
      return false;
    }
  }

  function saveToday(): void {
    if (today && localRound) saveMysteryDay(options.storage, today.date, localRound);
  }

  async function submitGuess(code: string): Promise<void> {
    if (busy || state.status !== "playing") return;
    if (state.guesses.some((guess) => guess.code === code)) {
      setFeedback(`You've already guessed ${nameOf(code)}.`, "warn");
      return;
    }
    if (ranked) {
      setBusy(true);
      try {
        const result = (await ranked.move({ type: "answer", countryCode: code })).result?.mystery;
        if (!result?.guess) throw new Error("Your guess couldn't be checked. Try again.");
        state = { ...state, guesses: [...state.guesses, result.guess], status: result.status, target: result.target ?? null, points: result.points };
      } catch (error) {
        if (!signal.aborted) {
          setBusy(false);
          setFeedback((error as Error).message, "warn");
        }
        return;
      }
      if (signal.aborted) return;
      busy = false;
    } else {
      const result = guessMystery(localRound!, code);
      if ("error" in result) {
        setFeedback(result.error === "unknown" ? `${nameOf(code)} isn't in the game.` : `You've already guessed ${nameOf(code)}.`, "warn");
        return;
      }
      localRound = result.round;
      state = fromRound(localRound);
      saveToday();
    }
    const guess = state.guesses[state.guesses.length - 1]!;
    paint(guess.code, heatOf(guess.clues));
    guessInput.clear();
    view.showCountryLabel(null);
    render();
    setFeedback(guess.clues.correct ? `${nameOf(guess.code)} — that's it!` : `${nameOf(guess.code)}: ${formatNumber(guess.clues.distanceKm)} km away, head ${COMPASS_WORDS[guess.clues.direction!]}.`, heatOf(guess.clues));
    if (state.status !== "playing") {
      endCountry(false);
      return;
    }
    guessInput.focus();
  }

  async function useHint(): Promise<void> {
    if (busy || state.status !== "playing" || state.hints.length >= MYSTERY_MAX_HINTS) return;
    if (ranked) {
      setBusy(true);
      try {
        const hint = (await ranked.move({ type: "hint" })).result?.mystery?.hint;
        if (!hint) throw new Error("The hint couldn't be loaded. Try again.");
        state = { ...state, hints: [...state.hints, hint.text] };
      } catch (error) {
        if (!signal.aborted) {
          setBusy(false);
          setFeedback((error as Error).message, "warn");
        }
        return;
      }
      if (signal.aborted) return;
      busy = false;
    } else {
      const result = hintMystery(localRound!);
      if ("error" in result) return;
      localRound = result.round;
      state = fromRound(localRound);
      saveToday();
    }
    render();
    setFeedback(state.hints[state.hints.length - 1]!);
  }

  async function giveUp(): Promise<void> {
    if (busy || state.status !== "playing") return;
    const confirmed = await shell.confirmLeave("This country won't score, and the answer will be shown.", { title: "Give up on this country?", confirmLabel: "Give up", cancelLabel: "Keep guessing", tone: "danger" });
    if (!confirmed || signal.aborted || busy || state.status !== "playing") return;
    if (ranked) {
      setBusy(true);
      try {
        const result = (await ranked.move({ type: "reveal" })).result?.mystery;
        if (!result?.target) throw new Error("The answer couldn't be loaded. Try again.");
        state = { ...state, status: result.status, target: result.target, points: 0 };
      } catch (error) {
        if (!signal.aborted) {
          setBusy(false);
          setFeedback((error as Error).message, "warn");
        }
        return;
      }
      if (signal.aborted) return;
      busy = false;
    } else {
      localRound = revealMystery(localRound!);
      state = fromRound(localRound);
      saveToday();
    }
    endCountry(false);
  }

  function endCountry(restored: boolean): void {
    finished.push(state);
    // Five-country runs are counted by their results card; Today's mystery ends here.
    if (today && !restored) trackGameComplete({ game: "mystery", mode: "daily" });
    const target = state.target;
    if (target) {
      paint(target, state.status === "solved" ? "found" : "answer");
      const id = country(target)?.id;
      if (id !== undefined) view.focusCountry(id, { animate: !restored && !prefersReducedMotion() });
    }
    const profile = target ? getCountryProfile(target) : null;
    const flag = target ? country(target)?.flagSrc : undefined;
    const title = state.status === "solved" ? `Found it in ${state.guesses.length}!` : state.status === "failed" ? "Out of guesses" : "Given up";
    const last = finished.length >= totalCountries;
    nextButton.textContent = last ? "See final score" : "Next country";
    outcome.dataset.status = state.status;
    outcome.replaceChildren(
      el("div", {
        className: "mystery-outcome-head",
        children: [el("strong", { className: "mystery-outcome-title", text: title }), el("span", { className: "mystery-outcome-points", text: state.points > 0 ? `+${state.points} points` : "No points" })],
      }),
      ...(target ? [el("div", {
        className: "mystery-answer",
        children: [
          ...(flag ? [el("img", { className: "mystery-answer-flag", attrs: { src: flag, alt: "", width: "54", height: "36", decoding: "async" } })] : []),
          el("div", {
            children: [
              el("span", { className: "mystery-answer-kicker", text: state.status === "solved" ? "The mystery country" : "It was" }),
              el("strong", { className: "mystery-answer-name", text: nameOf(target) }),
              ...(profile ? [el("span", { className: "mystery-answer-facts", text: `Capital ${profile.capital} · ${formatPopulation(profile.populationMillions)} people · ${profile.subregion}` })] : []),
            ],
          }),
        ],
      })] : []),
      today ? todaySummary() : nextButton,
    );
    playControls.hidden = true;
    outcome.hidden = false;
    render();
    updateProgress();
    if (!restored) (today ? outcome.querySelector<HTMLElement>(".mystery-share") ?? nextButton : nextButton).focus({ preventScroll: true });
  }

  function todaySummary(): HTMLElement {
    const stats = readMysteryDailyStats(options.storage, today!.date);
    const shareText = mysteryDailyShareText(localRound!, { number: mysteryDailyNumber(today!.date), url: shareLink({ game: "mystery", daily: "1" }) });
    const status = el("p", { className: "mystery-share-status", attrs: { role: "status" } });
    const shareButton = el("button", { className: "primary-action mystery-share", attrs: { type: "button" }, children: [shellIcon("copy", 17, 2), el("span", { text: "Share" })] });
    shareButton.addEventListener("click", () => {
      void copyShareText(shareText).then((result) => {
        status.textContent = result === "copied" ? "Copied — paste it anywhere." : result === "shared" ? "Thanks for sharing!" : "Couldn't copy. Select the text above instead.";
      });
    }, { signal });
    const nextDay = new Date(`${today!.date}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    const minutes = Math.max(0, Math.round((nextDay.getTime() - Date.now()) / 60_000));
    return el("div", {
      className: "mystery-today-summary",
      children: [
        el("dl", {
          className: "mystery-today-stats",
          children: [["Streak", `${stats.streak} day${stats.streak === 1 ? "" : "s"}`], ["Best streak", String(stats.bestStreak)], ["Played", String(stats.played)]]
            .map(([label, value]) => el("div", { children: [el("dt", { text: label! }), el("dd", { text: value! })] })),
        }),
        el("pre", { className: "mystery-share-preview", text: shareText, attrs: { "aria-label": "Your result to share" } }),
        el("p", { className: "mystery-today-next", text: `A new mystery in ${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m.` }),
        shareButton,
        ...(options.onPlayRun ? [el("button", { className: "mystery-link mystery-play-run", text: "Play a five-country run", attrs: { type: "button" }, on: { click: () => options.onPlayRun?.() } })] : []),
        status,
      ],
    });
  }

  function nextCountry(): void {
    if (state.status === "playing" || today) return;
    if (finished.length >= MYSTERY_ATTEMPT_COUNTRIES) {
      finishRun();
      return;
    }
    index += 1;
    startCountry();
  }

  function finishRun(): void {
    const total = totalScore();
    const previousBest = readSingleBest(options.storage, "mystery");
    const posting = submitRankedAttempt({ shell, mode: "mystery", total, storage: options.storage, ...(ranked ? { post: ranked.post } : services.postAttempt ? { post: services.postAttempt } : {}) });
    bar.refreshBest();
    const ratio = total / MAX_RUN_POINTS;
    const missed: ResultsMissedCountry[] = finished
      .filter((item) => item.status !== "solved" && item.target)
      .map((item) => ({ code: item.target!, name: nameOf(item.target!), ...(country(item.target!)?.flagSrc ? { flagSrc: country(item.target!)!.flagSrc } : {}) }));
    const shareLines = finished.map((item) => `${item.guesses.map((guess) => mysteryShareSquare(guess.clues)).join("") || "·"} ${item.points > 0 ? `+${item.points}` : "—"}`);
    const card = createRankedResults(shell, {
      mode: "mystery",
      title: total > previousBest && previousBest > 0 ? "A new best run!" : ratio >= 0.8 ? "A born detective" : ratio >= 0.55 ? "Sharp deductions" : "Run complete",
      total,
      stats: [
        { label: "Total score", value: formatNumber(total), note: `of ${formatNumber(MAX_RUN_POINTS)}` },
        { label: "Found", value: String(finished.filter((item) => item.status === "solved").length), note: `of ${MYSTERY_ATTEMPT_COUNTRIES}` },
        { label: "Your best", value: formatNumber(Math.max(previousBest, total)), note: total > previousBest ? "New best" : "On this device" },
      ],
      shareTitle: "Locato Mystery country",
      shareText: `Locato Mystery country ${total}/${MAX_RUN_POINTS}\n${shareLines.join("\n")}\n${shareLink({ game: "mystery" })}`,
      onTryAgain: () => void playAgain(),
      posting,
      ...(missed.length ? { missed, missedTitle: "Countries you missed" } : {}),
      tone: ratio >= 0.6 ? "celebrate" : "neutral",
    });
    insertIntoResults(card, createRunList("Your countries", finished.map((item, position) => ({
      label: item.target ? nameOf(item.target) : `Country ${position + 1}`,
      detail: item.status === "solved" ? `${item.guesses.length} guess${item.guesses.length === 1 ? "" : "es"}${item.hints.length ? ` · ${item.hints.length} hint${item.hints.length === 1 ? "" : "s"}` : ""}` : item.status === "failed" ? "Out of guesses" : "Given up",
      value: item.points > 0 ? `+${item.points}` : "0",
      tone: item.points >= 76 ? "good" : item.points >= 40 ? "ok" : "miss",
      ...(item.target && country(item.target) ? { flagSrc: country(item.target)!.flagSrc } : {}),
    }))));
    updateProgress();
    resultsStage.show(card);
  }

  async function playAgain(): Promise<void> {
    if (ranked) {
      try {
        await ranked.start();
      } catch (error) {
        if (!signal.aborted) setFeedback((error as Error).message, "warn");
        return;
      }
      if (signal.aborted) return;
    } else localTargets = createMysteryTargets(createRandomSeed());
    finished.splice(0, finished.length);
    index = 0;
    resultsStage.hide();
    startCountry();
  }

  hintButton.addEventListener("click", () => void useHint(), { signal });
  giveUpButton.addEventListener("click", () => void giveUp(), { signal });
  nextButton.addEventListener("click", nextCountry, { signal });

  // ---- Screen ------------------------------------------------------------------------------
  const layout = el("main", { className: "mystery-layout", children: [mapShell, panel] });
  const resultsStage = createResultsStage(layout);
  const element = el("section", { className: "game-screen mystery-screen gb-screen" });
  const bar = createBestBar(element, shell, {
    gameMode: "mystery",
    storage: options.storage,
    onHowToPlay: openHowToPlay,
    extraMenuItems: today
      ? options.onPlayRun ? [{ label: "Play a five-country run", icon: "compass", onSelect: () => options.onPlayRun?.() }] : []
      : [
          { label: "Restart run", icon: "rotate-ccw", onSelect: () => void playAgain() },
          ...(options.onToday ? [{ label: "Today's mystery", icon: "calendar-days" as const, onSelect: () => options.onToday?.() }] : []),
        ],
  });
  if (today) element.classList.add("is-today");
  element.append(bar.element, layout, resultsStage.element);

  startCountry();

  return {
    element,
    destroy: () => {
      controller.abort();
      bar.destroy();
    },
  };
}
