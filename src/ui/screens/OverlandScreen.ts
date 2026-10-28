import type { Screen } from "../../app/router";
import type { Country, CountryIndex } from "../../core/countries";
import { createRandomSeed } from "../../core/game/random";
import { scoreDailyOverlandRound } from "../../core/dailyChallenge";
import type { GameModeId } from "../../core/gameModes";
import { OVERLAND_ATTEMPT_ROUTES } from "../../core/leaderboards";
import type { WorldCountryFeature } from "../../core/map";
import {
  OVERLAND_EXTRA_GUESS_PENALTY,
  OVERLAND_HINT_LABELS,
  OVERLAND_HINT_PENALTY,
  OVERLAND_MAX_HINTS,
  OVERLAND_ROUTE_MAX_POINTS,
  OVERLAND_VERDICTS,
  createDailyOverlandRoute,
  createOverlandRound,
  createOverlandRoutes,
  exclaveNotesFor,
  guessOverland,
  hintOverland,
  isPerfectOverlandRound,
  overlandBestRoute,
  overlandDailyNumber,
  overlandDailyShareText,
  overlandGraph,
  overlandMissingCountries,
  overlandPlayerRoute,
  overlandRoundPoints,
  overlandShareLine,
  revealOverland,
  type OverlandGuessError,
  type OverlandRound,
  type OverlandRoute,
  type OverlandVerdict,
} from "../../core/overland";
import { fameTier } from "../../core/countries/fame";
import { shareResult, type ResultsMissedCountry } from "../shell/ResultsCard";
import { readOverlandDailyStats, readOverlandDay, saveOverlandDay } from "../../storage/overlandDaily";
import { createOverlandMap } from "../components/OverlandMap";
import { createCountryGuessInput } from "../components/countryGuessInput";
import { el } from "../dom/createElement";
import { shouldAutoFocusTextInput } from "../dom/mobileKeyboard";
import { shellIcon } from "../shell/icons";
import { shellLayer, trapOverlay } from "../shell/layer";
import type { ShellContext } from "../shell/types";
import { createDailyStageBar, createResultsStage, createRunList, formatNumber, insertIntoResults, shellOrFallback, type DailyStageProgress } from "./practiceRun";
import { createBestBar, createRankedResults, readSingleBest, submitRankedAttempt, type PostRankedAttempt } from "./rankedAttempt";
import type { RankedSession } from "./RankedSession";
import { trackGameComplete } from "../../app/analytics";
import "../../styles/overland.css";
import { shareLink } from "../../core/shareLink";

export interface OverlandScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly countryIndex: CountryIndex;
  readonly storage: Storage;
  readonly onGameModeChange: (mode: GameModeId) => void;
  readonly onHome: () => void;
  readonly onDailyChallenge?: () => void;
  /** Signed in: the server deals the routes and checks every guess, hint and give-up. */
  readonly ranked?: RankedSession;
  /** Round 8 of the daily challenge (or its practice): one route under the daily's FocusBar. */
  readonly dailyChallenge?: {
    readonly date: string;
    readonly title?: string;
    readonly practice?: boolean;
    readonly route: OverlandRoute;
    readonly progress?: DailyStageProgress;
    /** Called once when the route ends, before the answer shows, so refreshing can't replay it. */
    readonly onResult?: (round: OverlandRound) => void;
    readonly onComplete: (round: OverlandRound) => void;
  };
  /** Today's route: one route for everyone on `date` (YYYY-MM-DD), saved on this device with a streak. */
  readonly today?: { readonly date: string };
  /** Links between today's route and the five-route run. */
  readonly onTodaysRoute?: () => void;
  readonly onPlayRun?: () => void;
}

export interface OverlandScreenServices {
  /** Posts a finished run's total (defaults to the leaderboard API). */
  readonly postAttempt?: PostRankedAttempt;
  /** Seed for a guest's first run (tests); later runs always get a fresh one. */
  readonly seed?: string;
}

const MAX_POINTS = OVERLAND_ATTEMPT_ROUTES * OVERLAND_ROUTE_MAX_POINTS;
const LEGEND: readonly OverlandVerdict[] = ["route", "close", "detour", "off"];
/** Shortest routes listed under "Show all shortest routes"; any beyond this are counted. */
const MAX_LISTED_ROUTES = 8;
let howToCount = 0;

function guessErrorText(error: OverlandGuessError, name: string): string {
  if (error === "endpoint") return `${name} is one end of the route. Name the countries in between.`;
  if (error === "repeat") return `You've already named ${name}.`;
  if (error === "unknown") return `${name} isn't on the border map.`;
  return "This route is finished.";
}

/**
 * Share copies the whole result (grid, route and link) straight to the clipboard, Travle-style.
 * The system share sheet is only a fallback: its "Copy" often keeps just the link.
 */
async function copyShareText(text: string): Promise<"copied" | "shared" | "failed"> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    // Fall back to the share sheet below.
  }
  return shareResult({ title: "Locato Overland", text });
}

/** The rules, the colours and the scoring, as a dialog opened from the menu or the panel. */
function openHowToPlay(): void {
  howToCount += 1;
  const titleId = `overland-howto-${howToCount}`;
  const done = el("button", { className: "shell-btn shell-btn-primary", text: "Got it", attrs: { type: "button" } });
  const surface = el("div", {
    className: "shell-dialog overland-howto",
    attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" },
    children: [
      el("h2", { className: "shell-dialog-title", text: "How to play Overland", attrs: { id: titleId } }),
      el("p", { className: "shell-dialog-message", text: "Get from one country to the other by land. Name the countries in between, in any order. The route is done once your countries join the two ends across land borders, by any route." }),
      el("ul", {
        className: "overland-howto-legend",
        children: LEGEND.map((verdict) => el("li", {
          children: [
            el("span", { className: `overland-swatch is-${verdict}`, attrs: { "aria-hidden": "true" } }),
            el("strong", { text: OVERLAND_VERDICTS[verdict].label }),
            el("span", { text: OVERLAND_VERDICTS[verdict].description }),
          ],
        })),
      }),
      el("p", { className: "shell-dialog-message", text: `You get the shortest route's length plus a few spare guesses. A route is worth up to ${OVERLAND_ROUTE_MAX_POINTS} points: each extra guess costs ${OVERLAND_EXTRA_GUESS_PENALTY} and each hint ${OVERLAND_HINT_PENALTY}.` }),
      el("p", { className: "shell-dialog-message", text: "Islands have no land borders, so they never join a route. A few borders are surprising: Spain meets Morocco at Ceuta and Melilla, and Russia's Kaliningrad borders Poland and Lithuania." }),
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

export function createOverlandScreen(options: OverlandScreenOptions, services: OverlandScreenServices = {}): Screen {
  const controller = new AbortController();
  const { signal } = controller;
  const shell = shellOrFallback(options.shell, options.onHome);
  const graph = overlandGraph();
  const { countryIndex, ranked } = options;
  const country = (code: string): Country | undefined => countryIndex.byCode.get(code);
  const nameOf = (code: string): string => country(code)?.name ?? code;

  const daily = options.dailyChallenge;
  const today = options.today;
  const todayRoute = today ? createDailyOverlandRoute(today.date) : null;
  /** The daily round and today's route are one route; a run is five. */
  const totalRoutes = daily || today ? 1 : OVERLAND_ATTEMPT_ROUTES;
  let localRoutes: readonly OverlandRoute[] = ranked || daily || today ? [] : createOverlandRoutes(services.seed ?? createRandomSeed());
  let routeIndex = 0;
  let round: OverlandRound | null = null;
  const finished: { readonly round: OverlandRound; readonly points: number }[] = [];
  let busy = false;

  // ---- Map ---------------------------------------------------------------------------------
  const map = createOverlandMap(options.worldCountryFeatures, countryIndex);
  const legend = el("ul", {
    className: "overland-legend",
    attrs: { "aria-label": "Map colours" },
    children: [
      el("li", { children: [el("span", { className: "overland-swatch is-end", attrs: { "aria-hidden": "true" } }), el("span", { text: "Start · End" })] }),
      ...LEGEND.map((verdict) => el("li", { children: [el("span", { className: `overland-swatch is-${verdict}`, attrs: { "aria-hidden": "true" } }), el("span", { text: OVERLAND_VERDICTS[verdict].label })] })),
    ],
  });
  const mapShell = el("div", { className: "overland-map-shell", children: [map.element, legend] });

  // ---- Panel -------------------------------------------------------------------------------
  const eyebrow = el("span", { className: "eyebrow overland-eyebrow" });
  const startName = el("span", { className: "overland-end-name" });
  const endName = el("span", { className: "overland-end-name" });
  const startFlag = el("img", { className: "overland-end-flag", attrs: { alt: "", width: "30", height: "20", decoding: "async" } });
  const endFlag = el("img", { className: "overland-end-flag", attrs: { alt: "", width: "30", height: "20", decoding: "async" } });
  const routeTitle = el("h1", {
    className: "overland-route",
    children: [
      el("span", { className: "overland-end is-start", children: [startFlag, startName] }),
      el("span", { className: "overland-arrow", attrs: { "aria-hidden": "true" }, children: [shellIcon("arrow-right", 22, 2)] }),
      el("span", { className: "overland-end is-end", children: [endFlag, endName] }),
    ],
  });
  const routeDetail = el("p", { className: "overland-route-detail" });
  const howToButton = el("button", { className: "overland-link", text: "How to play", attrs: { type: "button" } });
  const switchLink = today && options.onPlayRun
    ? el("button", { className: "overland-link", text: "5-route run", attrs: { type: "button" }, on: { click: () => options.onPlayRun?.() } })
    : !daily && !today && options.onTodaysRoute
      ? el("button", { className: "overland-link overland-today-link", text: "Today's route", attrs: { type: "button" }, on: { click: () => options.onTodaysRoute?.() } })
      : null;

  const progressLabel = el("span", { className: "overland-progress-label" });
  const scoreLabel = el("strong", { className: "overland-running-score", text: "0 pts" });
  const progressDots = Array.from({ length: OVERLAND_ATTEMPT_ROUTES }, () => el("span", { className: "overland-progress-dot" }));
  const todayLabel = today ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${today.date}T12:00:00Z`)) : "";

  const guessInput = createCountryGuessInput({
    prefix: "overland",
    countryIndex,
    label: "Add a country to your route",
    signal,
    exclude: () => {
      const exclude = guessedCodes();
      if (round) for (const code of [round.route.start, round.route.end]) exclude.add(code);
      return exclude;
    },
    onPick: (picked) => void submitCountry(picked.code),
    onEmpty: () => setFeedback("Type a country to add it to your route.", "warn"),
    onUnknown: (text, ambiguous) => setFeedback(ambiguous ? "Which one? Pick a country from the list." : `No country called “${text}”. Check the spelling.`, "warn"),
    onType: () => { if (feedback.dataset.tone === "warn") setFeedback(""); },
  });
  const { form, feedback } = guessInput;

  const meterLabel = el("span", { className: "overland-meter-label" });
  const meterPips = el("div", { className: "overland-meter-pips", attrs: { "aria-hidden": "true" } });
  const meter = el("div", { className: "overland-meter", children: [el("div", { className: "overland-meter-head", children: [el("span", { text: "Guesses" }), meterLabel] }), meterPips] });
  const guessList = el("ol", { className: "overland-guesses", attrs: { "aria-label": "Your guesses" } });

  const hintButton = el("button", { className: "overland-hint", attrs: { type: "button" } });
  const hintNote = el("p", { className: "overland-hint-note" });
  const giveUpButton = el("button", { className: "overland-link overland-give-up", text: "Give up on this route", attrs: { type: "button" } });
  const playControls = el("div", { className: "overland-play-controls", children: [form, meter, guessList, el("div", { className: "overland-hints", children: [hintButton, hintNote] }), giveUpButton] });

  const outcome = el("section", { className: "overland-outcome", attrs: { "aria-live": "polite" } });
  outcome.hidden = true;
  const nextButton = el("button", { className: "primary-action overland-next", attrs: { type: "button" } });

  const progressSection = el("div", { className: "overland-progress", children: [el("div", { children: [progressLabel, scoreLabel] }), el("div", { className: "overland-progress-dots", children: progressDots })] });
  progressSection.hidden = totalRoutes === 1;
  const panel = el("aside", {
    className: "overland-panel",
    children: [
      el("div", { className: "overland-panel-title", children: [el("div", { className: "overland-title-row", children: [eyebrow, el("div", { className: "overland-title-links", children: [...(switchLink ? [switchLink] : []), howToButton] })] }), routeTitle, routeDetail] }),
      progressSection,
      playControls,
      outcome,
    ],
  });

  // ---- Rendering ---------------------------------------------------------------------------
  function totalScore(): number {
    return finished.reduce((sum, item) => sum + item.points, 0);
  }

  function updateProgress(): void {
    const done = finished.length === OVERLAND_ATTEMPT_ROUTES;
    progressLabel.textContent = done ? "Run complete" : `Route ${routeIndex + 1} of ${OVERLAND_ATTEMPT_ROUTES}`;
    scoreLabel.textContent = `${formatNumber(totalScore())} pts`;
    progressDots.forEach((dot, index) => {
      dot.classList.toggle("is-complete", index < finished.length);
      dot.classList.toggle("is-active", !done && index === routeIndex);
    });
  }

  function setFeedback(text: string, tone: "neutral" | "warn" | OverlandVerdict = "neutral"): void {
    feedback.textContent = text;
    feedback.dataset.tone = tone;
  }

  function guessedCodes(): Set<string> {
    return new Set(round?.guesses.map((guess) => guess.code) ?? []);
  }

  function renderGuesses(): void {
    if (!round) return;
    guessList.replaceChildren(...round.guesses.map((guess, index) => {
      const info = OVERLAND_VERDICTS[guess.verdict];
      const flag = country(guess.code)?.flagSrc;
      return el("li", {
        className: `overland-guess is-${guess.verdict}`,
        children: [
          el("span", { className: "overland-guess-index", text: String(index + 1) }),
          ...(flag ? [el("img", { className: "overland-guess-flag", attrs: { src: flag, alt: "", width: "24", height: "16", loading: "lazy", decoding: "async" } })] : []),
          el("span", { className: "overland-guess-name", text: nameOf(guess.code) }),
          el("span", { className: "overland-guess-verdict", children: [el("span", { className: `overland-swatch is-${guess.verdict}`, attrs: { "aria-hidden": "true" } }), el("span", { text: info.label })] }),
        ],
      });
    }));
    const used = round.guesses.length;
    meterLabel.textContent = `${used} of ${round.route.guessesAllowed}`;
    meterPips.replaceChildren(...Array.from({ length: round.route.guessesAllowed }, (_, index) => {
      const guess = round!.guesses[index];
      return el("span", { className: `overland-pip${guess ? ` is-${guess.verdict}` : ""}${index < round!.route.minimum ? " is-needed" : ""}` });
    }));
  }

  function renderHints(): void {
    if (!round) return;
    const used = round.hintsUsed;
    const playing = round.status === "playing";
    hintButton.replaceChildren(
      shellIcon("lightbulb", 17, 2),
      el("span", { className: "overland-hint-copy", text: used >= OVERLAND_MAX_HINTS ? "No hints left" : `Hint ${used + 1} of ${OVERLAND_MAX_HINTS}: ${OVERLAND_HINT_LABELS[used]!.toLowerCase()}` }),
      ...(used < OVERLAND_MAX_HINTS ? [el("span", { className: "overland-hint-cost", text: `−${OVERLAND_HINT_PENALTY}` })] : []),
    );
    hintButton.disabled = busy || !playing || used >= OVERLAND_MAX_HINTS;
    const guessed = guessedCodes();
    const waiting = round.outlined.filter((code) => !guessed.has(code));
    if (used === 0) hintNote.replaceChildren();
    else if (used >= 3 && waiting.length) {
      hintNote.replaceChildren(
        document.createTextNode("Still to find: "),
        ...waiting.map((code) => el("span", { className: "overland-initial", text: `${nameOf(code).charAt(0)}…`, attrs: { title: "First letter of a country you still need" } })),
      );
    } else hintNote.textContent = waiting.length ? `Dashed outline${waiting.length === 1 ? "" : "s"} on the map: ${waiting.length === 1 ? "a country" : "countries"} you still need.` : "";
  }

  function setBusy(value: boolean): void {
    busy = value;
    const playing = round?.status === "playing";
    guessInput.setState({ disabled: !playing, busy: value });
    giveUpButton.disabled = value || !playing;
    renderHints();
  }

  function routeChain(codes: readonly string[], found: ReadonlySet<string>): HTMLElement {
    const items: HTMLElement[] = [];
    codes.forEach((code, index) => {
      if (index > 0) items.push(el("span", { className: "overland-chain-arrow", text: "→", attrs: { "aria-hidden": "true" } }));
      const end = index === 0 || index === codes.length - 1;
      const flag = country(code)?.flagSrc;
      // Plain labels: opening the Atlas mid-run would end the run. Missed countries link there from the results.
      items.push(el("span", {
        className: `overland-chain-stop${end ? " is-end" : found.has(code) ? " is-found" : " is-missed"}`,
        ...(end || found.has(code) ? {} : { attrs: { title: "You didn't name this one" } }),
        children: [...(flag ? [el("img", { attrs: { src: flag, alt: "", width: "20", height: "14", loading: "lazy", decoding: "async" } })] : []), el("span", { text: nameOf(code) })],
      }));
    });
    return el("div", { className: "overland-chain", children: items });
  }

  function startRoute(): void {
    const route = daily?.route ?? todayRoute ?? (ranked ? ranked.state.question?.route ?? null : localRoutes[routeIndex] ?? null);
    if (!route) {
      setFeedback("This route couldn't be loaded. Restart the run to try again.", "warn");
      return;
    }
    round = createOverlandRound(route);
    eyebrow.textContent = daily ? `${daily.practice ? "Daily practice" : "Daily challenge"} · Overland` : today ? `Today's route · ${todayLabel}` : `Overland · Route ${routeIndex + 1}`;
    startName.textContent = nameOf(route.start);
    endName.textContent = nameOf(route.end);
    const startSrc = country(route.start)?.flagSrc;
    const endSrc = country(route.end)?.flagSrc;
    startFlag.hidden = !startSrc;
    endFlag.hidden = !endSrc;
    if (startSrc) startFlag.setAttribute("src", startSrc);
    if (endSrc) endFlag.setAttribute("src", endSrc);
    routeTitle.setAttribute("aria-label", `From ${nameOf(route.start)} to ${nameOf(route.end)}`);
    routeDetail.textContent = `Name the countries in between. The shortest route crosses ${route.minimum} ${route.minimum === 1 ? "country" : "countries"}.`;
    outcome.hidden = true;
    outcome.replaceChildren();
    playControls.hidden = false;
    guessInput.clear();
    setFeedback("");
    map.showRoute(route.start, route.end);
    renderGuesses();
    setBusy(false);
    updateProgress();
    const saved = today ? readOverlandDay(options.storage, today.date, route) : null;
    if (saved) {
      // Today's route resumes where it was left, or shows its result again once it's over.
      round = saved;
      for (const guess of saved.guesses) map.mark(guess.code, guess.verdict);
      map.setOutlined(saved.outlined);
      map.frame();
      renderGuesses();
      setBusy(false);
      if (saved.status !== "playing") {
        endRoute(overlandRoundPoints(saved), true);
        return;
      }
    }
    if (shouldFocusInput()) guessInput.focus();
  }

  function saveToday(): void {
    if (today && round) saveOverlandDay(options.storage, today.date, round);
  }

  function shouldFocusInput(): boolean {
    try {
      return typeof window.matchMedia === "function" && shouldAutoFocusTextInput();
    } catch {
      return false;
    }
  }

  function endRoute(points: number, restored = false): void {
    if (!round) return;
    const current = round;
    finished.push({ round: current, points });
    if (!restored) {
      saveToday();
      daily?.onResult?.(current);
      // Five-route runs are counted by their results card; Today's route ends here.
      if (today) trackGameComplete({ game: "overland", mode: "daily" });
    }
    // The daily scores on its own 10-point scale.
    const shownPoints = daily ? scoreDailyOverlandRound(current).points : points;
    const guessed = guessedCodes();
    const best = overlandBestRoute(graph, current);
    const yours = overlandPlayerRoute(graph, current);
    for (const code of best.slice(1, -1)) if (!guessed.has(code)) map.mark(code, "missed");
    map.setOutlined([]);
    map.setBordersVisible(true);
    map.frame({ animate: true });

    const perfect = isPerfectOverlandRound(current);
    const title = current.status === "solved" ? (perfect ? "Perfect route!" : "Route found") : current.status === "failed" ? "Out of guesses" : "Route revealed";
    const detail = current.status === "solved"
      ? perfect ? "Shortest possible, no hints." : `${current.guesses.length} guesses for a ${current.route.minimum}-country route${current.hintsUsed ? ` · ${current.hintsUsed} hint${current.hintsUsed === 1 ? "" : "s"}` : ""}.`
      : "Here's a shortest route.";
    const { start, end } = current.route;
    const shortestCount = graph.countShortestRoutes(start, end);
    const yoursIsShortest = yours !== null && yours.length === best.length;
    const chains: HTMLElement[] = [];
    if (yours) {
      const verdict = !yoursIsShortest ? "" : shortestCount === 1 ? " · the shortest possible" : ` · one of ${shortestCount} shortest`;
      chains.push(el("p", { className: "overland-chain-label", text: `Your route${verdict}` }), routeChain(yours, guessed));
      if (!yoursIsShortest) chains.push(el("p", { className: "overland-chain-label", text: shortestCount === 1 ? "Shortest route" : `A shortest route (1 of ${shortestCount})` }), routeChain(best, guessed));
    } else chains.push(el("p", { className: "overland-chain-label", text: shortestCount === 1 ? "Shortest route" : `A shortest route (1 of ${shortestCount})` }), routeChain(best, guessed));
    if (shortestCount > 1) chains.push(createAllRoutesToggle(current, best, guessed, shortestCount));
    const notes = exclaveNotesFor(yours ?? best);
    const last = finished.length >= totalRoutes;
    nextButton.textContent = daily ? (daily.practice ? "Continue practice" : "Continue daily challenge") : last ? "See final score" : "Next route";
    outcome.dataset.status = current.status;
    outcome.replaceChildren(
      el("div", {
        className: "overland-outcome-head",
        children: [el("strong", { className: "overland-outcome-title", text: title }), el("span", { className: "overland-outcome-points", text: shownPoints > 0 ? `+${shownPoints} ${daily ? "of 10" : "points"}` : "No points" })],
      }),
      el("p", { className: "overland-outcome-detail", text: detail }),
      ...chains,
      ...notes.map((note) => el("p", { className: "overland-note", text: note })),
      today ? todaySummary(current) : nextButton,
    );
    playControls.hidden = true;
    outcome.hidden = false;
    setBusy(false);
    updateProgress();
    if (!restored) (today ? outcome.querySelector<HTMLElement>(".overland-share") ?? nextButton : nextButton).focus({ preventScroll: true });
  }

  /** Today's route, once it's over: the streak, a share grid, and when the next route comes. */
  function todaySummary(current: OverlandRound): HTMLElement {
    const stats = readOverlandDailyStats(options.storage, today!.date);
    const shareText = overlandDailyShareText(current, {
      number: overlandDailyNumber(today!.date),
      startName: nameOf(current.route.start),
      endName: nameOf(current.route.end),
      url: shareLink({ game: "overland", daily: "1" }),
      away: overlandMissingCountries(graph, current).length,
    });
    const status = el("p", { className: "overland-share-status", attrs: { role: "status" } });
    const shareButton = el("button", { className: "primary-action overland-share", attrs: { type: "button" }, children: [shellIcon("copy", 17, 2), el("span", { text: "Share" })] });
    shareButton.addEventListener("click", () => {
      void copyShareText(shareText).then((outcome) => {
        status.textContent = outcome === "copied" ? "Copied — paste it anywhere." : outcome === "shared" ? "Thanks for sharing!" : "Couldn't copy. Select the text above instead.";
      });
    }, { signal });
    const nextDay = new Date(`${today!.date}T00:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    const minutes = Math.max(0, Math.round((nextDay.getTime() - Date.now()) / 60_000));
    return el("div", {
      className: "overland-today-summary",
      children: [
        el("dl", {
          className: "overland-today-stats",
          children: [
            ["Streak", `${stats.streak} day${stats.streak === 1 ? "" : "s"}`],
            ["Best streak", String(stats.bestStreak)],
            ["Played", String(stats.played)],
          ].map(([label, value]) => el("div", { children: [el("dt", { text: label! }), el("dd", { text: value! })] })),
        }),
        el("pre", { className: "overland-share-preview", text: shareText, attrs: { "aria-label": "Your result to share" } }),
        el("p", { className: "overland-today-next", text: `A new route in ${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m.` }),
        shareButton,
        ...(options.onPlayRun ? [el("button", { className: "overland-link overland-play-run", text: "Play a five-route run", attrs: { type: "button" }, on: { click: () => options.onPlayRun?.() } })] : []),
        status,
      ],
    });
  }

  /**
   * "Show all N shortest routes": lists them (the best-known first) and marks every country on
   * any of them on the map; hiding it puts the map back to the one route shown.
   */
  function createAllRoutesToggle(current: OverlandRound, best: readonly string[], guessed: ReadonlySet<string>, count: number): HTMLElement {
    const { start, end } = current.route;
    const listId = `overland-all-routes-${finished.length}`;
    const routes = graph.shortestRoutes(start, end, MAX_LISTED_ROUTES, fameTier);
    const extra = graph.routeCountries(start, end).filter((code) => !guessed.has(code) && !best.includes(code));
    const list = el("div", {
      className: "overland-all-routes",
      attrs: { id: listId },
      children: [
        ...routes.map((route) => routeChain(route, guessed)),
        ...(count > routes.length ? [el("p", { className: "overland-chain-label", text: `…and ${count - routes.length} more` })] : []),
      ],
    });
    list.hidden = true;
    const label = `Show all ${count} shortest routes`;
    const toggle = el("button", { className: "overland-link overland-all-toggle", text: label, attrs: { type: "button", "aria-expanded": "false", "aria-controls": listId } });
    toggle.addEventListener("click", () => {
      const open = list.hidden;
      list.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Hide the other routes" : label;
      for (const code of extra) open ? map.mark(code, "missed") : map.unmark(code);
      map.frame({ animate: true });
    }, { signal });
    return el("div", { className: "overland-all", children: [toggle, list] });
  }

  function finishRun(): void {
    const total = totalScore();
    const perfectRoutes = finished.filter((item) => isPerfectOverlandRound(item.round)).length;
    const previousBest = readSingleBest(options.storage, "overland");
    const posting = submitRankedAttempt({ shell, mode: "overland", total, storage: options.storage, ...(ranked ? { post: ranked.post } : services.postAttempt ? { post: services.postAttempt } : {}) });
    bestBar?.refreshBest();
    const ratio = total / MAX_POINTS;
    const missed: ResultsMissedCountry[] = [];
    for (const item of finished) {
      if (item.round.status === "solved") continue;
      const guessed = new Set(item.round.guesses.map((guess) => guess.code));
      for (const code of overlandBestRoute(graph, item.round).slice(1, -1)) {
        if (guessed.has(code) || missed.some((entry) => entry.code === code)) continue;
        const flagSrc = country(code)?.flagSrc;
        missed.push({ code, name: nameOf(code), ...(flagSrc ? { flagSrc } : {}) });
      }
    }
    const card = createRankedResults(shell, {
      mode: "overland",
      title: total > previousBest && previousBest > 0 ? "A new best run!" : ratio >= 0.9 ? "You know your borders" : ratio >= 0.65 ? "Well travelled" : "Run complete",
      total,
      stats: [
        { label: "Total score", value: formatNumber(total), note: `of ${formatNumber(MAX_POINTS)}` },
        { label: "Perfect routes", value: String(perfectRoutes), note: `of ${OVERLAND_ATTEMPT_ROUTES}` },
        { label: "Your best", value: formatNumber(Math.max(previousBest, total)), note: total > previousBest ? "New best" : "On this device" },
      ],
      shareTitle: "Locato Overland",
      shareText: `Locato Overland ${total}/${MAX_POINTS}\n${finished.map((item) => overlandShareLine(item.round)).join("\n")}\n${shareLink({ game: "overland" })}`,
      onTryAgain: () => void playAgain(),
      posting,
      ...(missed.length ? { missed, missedTitle: "Countries you missed" } : {}),
      tone: ratio >= 0.6 ? "celebrate" : "neutral",
    });
    const runList = createRunList("Your routes", finished.map((item) => ({
      label: `${nameOf(item.round.route.start)} → ${nameOf(item.round.route.end)}`,
      detail: item.round.status === "solved"
        ? `${item.round.guesses.length} guesses for ${item.round.route.minimum}${item.round.hintsUsed ? ` · ${item.round.hintsUsed} hint${item.round.hintsUsed === 1 ? "" : "s"}` : ""}`
        : item.round.status === "failed" ? "Out of guesses" : "Given up",
      value: item.points > 0 ? `+${item.points}` : "0",
      tone: item.points >= 90 ? "good" : item.points >= 50 ? "ok" : "miss",
    })));
    insertIntoResults(card, runList);
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
    } else localRoutes = createOverlandRoutes(createRandomSeed());
    finished.splice(0, finished.length);
    routeIndex = 0;
    resultsStage.hide();
    startRoute();
  }

  function nextRoute(): void {
    if (!round || round.status === "playing") return;
    if (daily) {
      daily.onComplete(round);
      return;
    }
    if (finished.length >= OVERLAND_ATTEMPT_ROUTES) {
      finishRun();
      return;
    }
    routeIndex += 1;
    startRoute();
  }

  // ---- Moves -------------------------------------------------------------------------------
  async function submitCountry(code: string): Promise<void> {
    if (!round || busy || round.status !== "playing") return;
    const local = guessOverland(graph, round, code);
    if ("error" in local) {
      setFeedback(guessErrorText(local.error, nameOf(code)), "warn");
      return;
    }
    let next = local.round;
    let points = overlandRoundPoints(next);
    if (ranked) {
      setBusy(true);
      try {
        const checked = (await ranked.move({ type: "answer", countryCode: code })).result?.overland;
        if (!checked?.guess) throw new Error("Your guess couldn't be checked. Try again.");
        // The server's verdict and route status are the record.
        next = { ...next, guesses: [...round.guesses, checked.guess], status: checked.status };
        points = checked.points;
      } catch (error) {
        if (!signal.aborted) {
          setBusy(false);
          setFeedback((error as Error).message, "warn");
        }
        return;
      }
      if (signal.aborted) return;
    }
    round = next;
    if (round.status === "playing") saveToday();
    const guess = next.guesses[next.guesses.length - 1]!;
    guessInput.clear();
    map.mark(guess.code, guess.verdict);
    map.frame({ animate: true });
    renderGuesses();
    setFeedback(`${nameOf(guess.code)}: ${OVERLAND_VERDICTS[guess.verdict].label}.`, guess.verdict);
    if (round.status !== "playing") {
      endRoute(points);
      return;
    }
    setBusy(false);
    guessInput.focus();
  }

  async function useHint(): Promise<void> {
    if (!round || busy || round.status !== "playing") return;
    const local = hintOverland(graph, round);
    if ("error" in local) return;
    let next = local.round;
    if (ranked) {
      setBusy(true);
      try {
        const hint = (await ranked.move({ type: "hint" })).result?.overland?.hint;
        if (!hint) throw new Error("The hint couldn't be loaded. Try again.");
        next = { ...next, hintsUsed: hint.level, outlined: hint.outlined };
      } catch (error) {
        if (!signal.aborted) {
          setBusy(false);
          setFeedback((error as Error).message, "warn");
        }
        return;
      }
      if (signal.aborted) return;
    }
    round = next;
    saveToday();
    map.setOutlined(round.outlined);
    map.frame({ animate: true });
    setBusy(false);
    setFeedback(round.hintsUsed >= OVERLAND_MAX_HINTS ? "Their first letters are under the hint." : round.hintsUsed === 1 ? "The next country on the route is outlined on the map." : "Every country you still need is outlined on the map.");
  }

  async function giveUp(): Promise<void> {
    if (!round || busy || round.status !== "playing") return;
    const confirmed = await shell.confirmLeave("This route won't score, and a shortest route will be shown.", { title: "Give up on this route?", confirmLabel: "Give up", cancelLabel: "Keep going", tone: "danger" });
    if (!confirmed || signal.aborted || !round || round.status !== "playing" || busy) return;
    if (ranked) {
      setBusy(true);
      try {
        await ranked.move({ type: "reveal" });
      } catch (error) {
        if (!signal.aborted) {
          setBusy(false);
          setFeedback((error as Error).message, "warn");
        }
        return;
      }
      if (signal.aborted) return;
    }
    round = revealOverland(round);
    endRoute(0);
  }

  hintButton.addEventListener("click", () => void useHint(), { signal });
  giveUpButton.addEventListener("click", () => void giveUp(), { signal });
  nextButton.addEventListener("click", nextRoute, { signal });
  howToButton.addEventListener("click", openHowToPlay, { signal });

  // ---- Screen ------------------------------------------------------------------------------
  const layout = el("main", { className: "overland-layout", children: [mapShell, panel] });
  const resultsStage = createResultsStage(layout);
  const element = el("section", { className: "game-screen overland-screen gb-screen" });
  const bar = daily
    ? createDailyStageBar(element, {
        stage: "Overland",
        ...(daily.title ? { title: daily.title } : {}),
        practice: daily.practice ?? false,
        ...(daily.progress ? { progress: daily.progress } : {}),
        onLeave: options.onHome,
      })
    : null;
  const bestBar = daily ? null : createBestBar(element, shell, {
    gameMode: "overland",
    storage: options.storage,
    onHowToPlay: openHowToPlay,
    extraMenuItems: today
      ? options.onPlayRun ? [{ label: "Play a five-route run", icon: "route", onSelect: () => options.onPlayRun?.() }] : []
      : [
          { label: "Restart run", icon: "rotate-ccw", onSelect: () => void playAgain() },
          ...(options.onTodaysRoute ? [{ label: "Today's route", icon: "calendar-days" as const, onSelect: () => options.onTodaysRoute?.() }] : []),
        ],
  });
  if (today) element.classList.add("is-today");
  element.append((bar ?? bestBar)!.element, layout, resultsStage.element);

  startRoute();

  return {
    element,
    destroy: () => {
      controller.abort();
      bestBar?.destroy();
      map.destroy();
    },
  };
}
