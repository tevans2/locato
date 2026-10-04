import type { ShellContext } from "../shell/types";
import {
  FLYOVER_RUN_SECONDS,
  FLYOVER_SKIP_PENALTY_SECONDS,
  buildFlyoverCountries,
  pickNextTarget,
  startingPlane,
  type FlyoverCountry,
  type Rng,
  type PlaneInput,
} from "../../core/flyover";
import type { RankedSession } from "./RankedSession";
import type { WorldCountryFeature } from "../../core/map";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createFlyoverFlight, flyoverFlagSrc } from "../components/FlyoverFlight";
import { createResultsStage, createRunList, formatNumber, insertIntoResults, shellOrFallback } from "./practiceRun";
import { createBestBar, createRankedResults, readSingleBest, submitRankedAttempt, type PostRankedAttempt } from "./rankedAttempt";

export interface FlyoverScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly storage: Storage;
  readonly onHome: () => void;
  readonly ranked?: RankedSession;
}

export interface FlyoverScreenServices {
  readonly postAttempt?: PostRankedAttempt;
  readonly rng?: Rng;
  /** Milliseconds clock (defaults to performance.now). */
  readonly now?: () => number;
  readonly requestFrame?: (callback: () => void) => number;
  readonly cancelFrame?: (handle: number) => void;
}

interface Reached {
  readonly country: FlyoverCountry;
  /** Seconds it took to reach from the moment it was named. */
  readonly seconds: number;
}

export function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

function feedbackTitle(score: number): string {
  if (score >= 30) return "Frequent flyer";
  if (score >= 18) return "Smooth flying";
  if (score >= 9) return "A good flight";
  if (score >= 1) return "Wheels down";
  return "Lost in the clouds";
}

export function createFlyoverScreen(options: FlyoverScreenOptions, services: FlyoverScreenServices = {}): Screen {
  const controller = new AbortController();
  const { signal } = controller;
  const shell = shellOrFallback(options.shell, options.onHome);
  const rng = services.rng ?? Math.random;
  const now = services.now ?? (options.ranked ? () => options.ranked!.now() : () => performance.now());
  const animationNow = services.now ?? (() => performance.now());
  const requestFrame = services.requestFrame ?? ((callback: () => void) => requestAnimationFrame(callback));
  const cancelFrame = services.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));
  const countries = buildFlyoverCountries(options.worldCountryFeatures);

  type Phase = "ready" | "flying" | "done";
  let phase: Phase = "ready";
  const reached: Reached[] = [];
  const skipped: FlyoverCountry[] = [];
  const visitedCodes = new Set<string>();
  let controls: PlaneInput = { turn: 0, boost: false };
  let polling: ReturnType<typeof setInterval> | undefined;
  let requesting = false;
  let starting = false;

  // --- DOM ---------------------------------------------------------------------------------
  const scoreValue = el("strong", { className: "flyover-score-value", text: "0" });
  const scoreBox = el("div", { className: "flyover-score", children: [scoreValue, el("span", { text: "countries" })] });
  const startButton = el("button", { className: "primary-action flyover-start", text: "Take off", attrs: { type: "button" } });
  const readyOverlay = el("div", {
    className: "flyover-ready",
    children: [
      el("div", {
        className: "flyover-ready-card",
        children: [
          el("span", { className: "eyebrow", text: "Flyover" }),
          el("h1", { text: "Fly over the named country." }),
          el("p", { text: `Each country you touch scores a point and names the next. You have ${FLYOVER_RUN_SECONDS} seconds — your best flight goes on the leaderboard.` }),
          el("ul", {
            className: "flyover-howto",
            children: [
              el("li", { children: [el("kbd", { text: "←" }), el("kbd", { text: "→" }), el("span", { text: "steer (or A / D)" })] }),
              el("li", { children: [el("kbd", { text: "↑" }), el("span", { text: "hold to boost (or W / Shift)" })] }),
              el("li", { children: [el("span", { className: "flyover-howto-touch", text: "Touch" }), el("span", { text: "hold the map where you want to fly" })] }),
              el("li", { children: [el("kbd", { text: "S" }), el("span", { text: `skip a country (costs ${FLYOVER_SKIP_PENALTY_SECONDS} seconds)` })] }),
            ],
          }),
          startButton,
        ],
      }),
    ],
  });

  const flight = createFlyoverFlight({
    countries,
    hudRight: scoreBox,
    overlay: readyOverlay,
    skipLabel: `Skip · −${FLYOVER_SKIP_PENALTY_SECONDS}s`,
    flightSeconds: FLYOVER_RUN_SECONDS,
    now,
    animationNow,
    requestFrame,
    cancelFrame,
    signal,
    authoritative: Boolean(options.ranked),
    onInput: (input) => { controls = input; },
    onSteerWhileGrounded: () => {
      if (phase === "ready") start();
    },
    onReach: options.ranked ? () => {} : reach,
    onSkip: options.ranked ? () => void serverMove(true) : skip,
    onTimeUp: options.ranked ? () => void serverMove() : finish,
  });
  flight.reset(startingPlane(countries, rng));

  // --- Game --------------------------------------------------------------------------------
  function excluded(): Set<string> {
    const codes = new Set(visitedCodes);
    for (const country of skipped) codes.add(country.code);
    const target = flight.target();
    if (target) codes.add(target.code);
    return codes;
  }

  function nextTarget(): FlyoverCountry | null {
    const plane = flight.plane();
    return pickNextTarget(countries, [plane.x, plane.y], excluded(), rng);
  }

  function updateScore(): void {
    scoreValue.textContent = String(reached.length);
  }

  function reach(country: FlyoverCountry, seconds: number): void {
    reached.push({ country, seconds });
    visitedCodes.add(country.code);
    flight.markVisited(country.code);
    flight.showToast(`+1 ${country.name}`);
    updateScore();
    const next = nextTarget();
    flight.setTarget(next);
    if (!next) finish();
  }

  function skip(): void {
    const target = flight.target();
    if (phase !== "flying" || !target) return;
    skipped.push(target);
    flight.setEndsAt(flight.endsAt() - FLYOVER_SKIP_PENALTY_SECONDS * 1000);
    flight.showToast(`Skipped ${target.name} · −${FLYOVER_SKIP_PENALTY_SECONDS}s`);
    const next = nextTarget();
    flight.setTarget(next);
    if (!next || flight.endsAt() <= now()) finish();
  }

  async function serverMove(skipping = false): Promise<void> {
    if (!options.ranked || phase !== "flying" || requesting) return;
    requesting = true;
    const previous = flight.target();
    const before = options.ranked.state;
    const sentAt = animationNow();
    const input = controls;
    try {
      const state = await options.ranked.move(skipping ? { type: "skip" } : { type: "input", input });
      if (signal.aborted) return;
      for (const { code, seconds } of state.reaches ?? []) {
        if (visitedCodes.has(code)) continue;
        const country = countries.find((c) => c.code === code);
        if (!country) continue;
        reached.push({ country, seconds });
        visitedCodes.add(code); flight.markVisited(code); flight.showToast(`+1 ${country.name}`);
      }
      if (skipping && previous && state.index > before.index && state.score === before.score) {
        skipped.push(previous); flight.showToast(`Skipped ${previous.name} · −${FLYOVER_SKIP_PENALTY_SECONDS}s`);
      }
      updateScore();
      // HTTP snapshots are already in the past when they arrive. Half the round trip is an
      // estimate of their return journey; it affects presentation only, never scoring.
      if (state.plane) flight.setPlane(state.plane, (animationNow() - sentAt) / 2, input);
      if (state.endsAt) flight.setEndsAt(state.endsAt);
      flight.setTarget(countries.find((c) => c.name === state.question?.text) ?? null);
      if (state.status === "complete") finish();
    } catch (error) { if (!signal.aborted) flight.showToast((error as Error).message); }
    finally { requesting = false; }
  }

  async function start(): Promise<void> {
    if (phase !== "ready") return;
    if (starting) return;
    if (options.ranked) {
      starting = true; startButton.disabled = true;
      try {
        const state = await options.ranked.start();
        if (signal.aborted) return;
        phase = "flying"; readyOverlay.hidden = true;
        flight.reset(state.plane!); flight.setTarget(countries.find((c) => c.name === state.question?.text) ?? null); flight.fly(state.endsAt!);
        if (document.activeElement instanceof HTMLElement && element.contains(document.activeElement)) document.activeElement.blur();
        polling = setInterval(() => void serverMove(), 150);
      } catch (error) { if (!signal.aborted) flight.showToast((error as Error).message); }
      finally { starting = false; startButton.disabled = false; }
      return;
    }
    phase = "flying";
    readyOverlay.hidden = true;
    flight.setTarget(nextTarget());
    flight.fly(now() + FLYOVER_RUN_SECONDS * 1000);
    // Drop focus from Take off so Space (boost) can't press a button mid-flight.
    if (document.activeElement instanceof HTMLElement && element.contains(document.activeElement)) document.activeElement.blur();
  }

  function reset(): void {
    clearInterval(polling);
    phase = "ready";
    reached.splice(0);
    skipped.splice(0);
    visitedCodes.clear();
    readyOverlay.hidden = false;
    updateScore();
    resultsStage.hide();
    // The layout is visible again: reset measures it.
    flight.reset(startingPlane(countries, rng));
    startButton.focus();
  }

  function finish(): void {
    if (phase === "done") return;
    phase = "done";
    clearInterval(polling);
    flight.land();
    const score = reached.length;
    const fastest = reached.reduce<Reached | null>((best, item) => (!best || item.seconds < best.seconds ? item : best), null);
    const flags = reached.slice(0, 24).map((item) => flagEmoji(item.country.code)).join("");
    const shareText = `Locato Flyover ✈️ ${score} ${score === 1 ? "country" : "countries"} in ${FLYOVER_RUN_SECONDS}s\n${flags}${reached.length > 24 ? "…" : ""}\nlocato.quest`;
    const runList = createRunList("Your route", reached.map((item) => ({
      label: item.country.name,
      detail: item.country.continent,
      value: `${item.seconds.toFixed(1)}s`,
      tone: item.seconds <= 5 ? "good" : item.seconds <= 12 ? "ok" : "miss",
      flagSrc: flyoverFlagSrc(item.country.code),
      onClick: () => shell.openCountry(item.country.code),
      ariaLabel: `${item.country.name}, reached in ${item.seconds.toFixed(1)} seconds. Open in the Atlas`,
    })));
    const missed = skipped.map((country) => ({ code: country.code, name: country.name, flagSrc: flyoverFlagSrc(country.code) }));
    const stats = [
      { label: "Countries", value: formatNumber(score), note: `in ${FLYOVER_RUN_SECONDS} seconds` },
      ...(fastest ? [{ label: "Quickest find", value: `${fastest.seconds.toFixed(1)}s`, note: fastest.country.name }] : []),
    ];

    // Every finished flight counts: it posts, and the board keeps your best.
    const previousBest = readSingleBest(options.storage, "flyover");
    const posting = submitRankedAttempt({ shell, mode: "flyover", total: score, storage: options.storage, ...(options.ranked ? { post: options.ranked.post } : services.postAttempt ? { post: services.postAttempt } : {}) });
    bar.refreshBest();
    const isNewBest = score > previousBest;
    const card = createRankedResults(shell, {
      mode: "flyover",
      title: isNewBest && previousBest > 0 ? "A new best flight!" : feedbackTitle(score),
      total: score,
      stats: [...stats, { label: "Your best", value: formatNumber(Math.max(previousBest, score)), note: isNewBest ? "New best" : "On this device" }],
      ...(missed.length ? { missed, missedTitle: "Skipped — worth another look" } : {}),
      shareTitle: "Locato Flyover",
      shareText,
      onTryAgain: reset,
      posting,
      tone: score >= 10 ? "celebrate" : "neutral",
    });
    if (reached.length) insertIntoResults(card, runList);
    resultsStage.show(card);
  }

  startButton.addEventListener("click", start, { signal });

  // --- Mount -------------------------------------------------------------------------------
  const layout = el("main", { className: "flyover-layout", children: [flight.element] });
  const resultsStage = createResultsStage(layout);
  const element = el("section", { className: "game-screen flyover-screen gb-screen" });
  const bar = createBestBar(element, shell, {
    gameMode: "flyover",
    storage: options.storage,
    extraMenuItems: [{ label: "Restart flight", icon: "rotate-ccw", onSelect: reset }],
  });
  element.append(bar.element, layout, resultsStage.element);

  // Colours come from CSS once the element is in the document.
  requestFrame(() => {
    if (signal.aborted) return;
    flight.mount();
    if (phase === "ready") startButton.focus();
  });

  updateScore();

  return {
    element,
    destroy: () => {
      controller.abort();
      clearInterval(polling);
      flight.destroy();
      bar.destroy();
    },
  };
}
