import { createMobileGameNav } from "../dom/mobileGameNav";
import {
  DEFAULT_WORLD_SPLIT_LINE,
  WORLD_SPLIT_MAX_ROUND_SCORE,
  WORLD_SPLIT_ROUNDS,
  buildWorldSplitCountries,
  extendSplitLineToMap,
  formatPopulationMillions,
  isCountryInWorldSplitRound,
  rotateSplitLine,
  scoreWorldSplit,
  shiftSplitLine,
  splitLineLength,
  worldSplitSideForPoint,
  type SplitLine,
  type WorldSplitResult,
} from "../../core/worldsplit";
import {
  MAP_VIEWBOX_HEIGHT,
  MAP_VIEWBOX_WIDTH,
  projectWorldMapPosition,
  type ProjectedPoint,
  type WorldCountryFeature,
  type WorldMapPolygon,
  type WorldMapPosition,
} from "../../core/map";
import type { GameModeId } from "../../core/gameModes";
import type { Screen } from "../../app/router";
import { createBrandLockup } from "../dom/createBrandLockup";
import { el } from "../dom/createElement";
import { createGameModeDropdown } from "../dom/gameModeDropdown";

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_DRAW_LENGTH = 24;
const BEST_SCORE_KEY = "locato:worldsplit:best-score:v1";

export interface WorldSplitScreenOptions {
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly storage: Storage;
  readonly onGameModeChange: (mode: GameModeId) => void;
  readonly onHome: () => void;
  readonly onDailyChallenge?: () => void;
  readonly onMultiplayer?: () => void;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tagName);
}

function formatPoint(point: WorldMapPosition): string {
  const [x, y] = projectWorldMapPosition(point);
  return `${x.toFixed(3)} ${y.toFixed(3)}`;
}

function polygonToPath(polygon: WorldMapPolygon): string {
  return polygon
    .map((ring) => ring.map((point, index) => `${index === 0 ? "M" : "L"} ${formatPoint(point)}`).join(" ") + " Z")
    .join(" ");
}

function geometryToPath(feature: WorldCountryFeature): string {
  if (feature.geometry.type === "Polygon") return polygonToPath(feature.geometry.coordinates);
  return feature.geometry.coordinates.map(polygonToPath).join(" ");
}

function pointerToMap(svg: SVGSVGElement, clientX: number, clientY: number): ProjectedPoint {
  const rect = svg.getBoundingClientRect();
  const relativeX = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const relativeY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  return [
    Math.min(MAP_VIEWBOX_WIDTH, Math.max(0, relativeX * MAP_VIEWBOX_WIDTH)),
    Math.min(MAP_VIEWBOX_HEIGHT, Math.max(0, relativeY * MAP_VIEWBOX_HEIGHT)),
  ];
}

function feedbackForScore(score: number): string {
  if (score === WORLD_SPLIT_MAX_ROUND_SCORE) return "Perfect split";
  if (score >= 96) return "Almost perfectly balanced";
  if (score >= 85) return "Excellent geographic instinct";
  if (score >= 65) return "Nicely judged";
  if (score >= 40) return "Close — try shifting the line";
  return "The population is more uneven than the map looks";
}

function readBestScore(storage: Storage): number {
  const value = Number.parseInt(storage.getItem(BEST_SCORE_KEY) ?? "0", 10);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function createWorldSplitScreen(options: WorldSplitScreenOptions): Screen {
  const controller = new AbortController();
  const mobileNav = createMobileGameNav(options, controller.signal);
  const countries = buildWorldSplitCountries(options.worldCountryFeatures);
  const countryByCode = new Map(countries.map((country) => [country.code, country]));
  const pathByCode = new Map<string, SVGPathElement>();
  const scores: number[] = [];
  let roundIndex = 0;
  let line: SplitLine | null = null;
  let submittedResult: WorldSplitResult | null = null;
  let activePointerId: number | null = null;
  let dragStart: ProjectedPoint | null = null;
  let finished = false;

  const gameModeDropdown = createGameModeDropdown({
    selectedMode: "worldsplit",
    signal: controller.signal,
    name: "worldsplit-game-mode",
    onChange: options.onGameModeChange,
  });

  const dailyButton = el("button", { className: "nav-action", text: "Daily challenge", attrs: { type: "button" } });
  const multiplayerButton = el("button", { className: "nav-action", text: "Multiplayer", attrs: { type: "button" } });
  dailyButton.hidden = !options.onDailyChallenge;
  multiplayerButton.hidden = !options.onMultiplayer;

  const svg = createSvgElement("svg");
  svg.classList.add("worldsplit-map");
  svg.setAttribute("viewBox", `0 0 ${MAP_VIEWBOX_WIDTH} ${MAP_VIEWBOX_HEIGHT}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "World map. Draw a straight line across the map to split the selected population.");
  svg.setAttribute("tabindex", "0");

  const ocean = createSvgElement("rect");
  ocean.classList.add("worldsplit-ocean");
  ocean.setAttribute("width", String(MAP_VIEWBOX_WIDTH));
  ocean.setAttribute("height", String(MAP_VIEWBOX_HEIGHT));
  svg.append(ocean);

  const graticule = createSvgElement("g");
  graticule.classList.add("worldsplit-graticule");
  for (let x = 125; x < MAP_VIEWBOX_WIDTH; x += 125) {
    const lineElement = createSvgElement("line");
    lineElement.setAttribute("x1", String(x));
    lineElement.setAttribute("x2", String(x));
    lineElement.setAttribute("y1", "0");
    lineElement.setAttribute("y2", String(MAP_VIEWBOX_HEIGHT));
    graticule.append(lineElement);
  }
  for (let y = 100; y < MAP_VIEWBOX_HEIGHT; y += 100) {
    const lineElement = createSvgElement("line");
    lineElement.setAttribute("x1", "0");
    lineElement.setAttribute("x2", String(MAP_VIEWBOX_WIDTH));
    lineElement.setAttribute("y1", String(y));
    lineElement.setAttribute("y2", String(y));
    graticule.append(lineElement);
  }
  svg.append(graticule);

  const countriesGroup = createSvgElement("g");
  countriesGroup.classList.add("worldsplit-countries");
  for (const feature of options.worldCountryFeatures) {
    const path = createSvgElement("path");
    path.classList.add("worldsplit-country");
    path.setAttribute("d", geometryToPath(feature));
    path.dataset.code = feature.code;
    const title = createSvgElement("title");
    title.textContent = feature.name;
    path.append(title);
    pathByCode.set(feature.code, path);
    countriesGroup.append(path);
  }
  svg.append(countriesGroup);

  const splitGlow = createSvgElement("line");
  splitGlow.classList.add("worldsplit-line-glow");
  const splitStroke = createSvgElement("line");
  splitStroke.classList.add("worldsplit-line");
  const startHandle = createSvgElement("circle");
  startHandle.classList.add("worldsplit-line-handle");
  startHandle.setAttribute("r", "7");
  const endHandle = createSvgElement("circle");
  endHandle.classList.add("worldsplit-line-handle");
  endHandle.setAttribute("r", "7");
  svg.append(splitGlow, splitStroke, startHandle, endHandle);

  const mapHint = el("div", {
    className: "worldsplit-map-hint",
    children: [el("strong", { text: "Draw across the map" }), el("span", { text: "Click and drag. The line extends forever." })],
  });
  const mapShell = el("div", {
    className: "worldsplit-map-shell",
    children: [svg, mapHint, el("div", { className: "worldsplit-map-label", text: "Countries are counted by their geographic centre" })],
  });

  const roundEyebrow = el("span", { className: "eyebrow worldsplit-eyebrow", text: "Worldsplit" });
  const roundTitle = el("h1");
  const roundDetail = el("p", { className: "worldsplit-round-detail" });
  const progressLabel = el("span", { className: "worldsplit-progress-label" });
  const scoreLabel = el("strong", { className: "worldsplit-running-score", text: "0 pts" });
  const progressDots = WORLD_SPLIT_ROUNDS.map(() => el("span", { className: "worldsplit-progress-dot" }));
  const statusText = el("p", { className: "worldsplit-status", text: "Draw a line to make your split." });

  const sideAValue = el("strong", { className: "worldsplit-side-value", text: "?" });
  const sideBValue = el("strong", { className: "worldsplit-side-value", text: "?" });
  const sideAPopulation = el("span", { className: "worldsplit-side-population", text: "Hidden until you lock" });
  const sideBPopulation = el("span", { className: "worldsplit-side-population", text: "Hidden until you lock" });
  const sideCards = el("div", {
    className: "worldsplit-side-cards",
    children: [
      el("div", {
        className: "worldsplit-side-card is-a",
        children: [el("span", { className: "worldsplit-side-name", text: "Side A" }), sideAValue, sideAPopulation],
      }),
      el("div", {
        className: "worldsplit-side-card is-b",
        children: [el("span", { className: "worldsplit-side-name", text: "Side B" }), sideBValue, sideBPopulation],
      }),
    ],
  });

  const rotateLeftButton = el("button", { className: "worldsplit-adjust-button", text: "↺ 5°", attrs: { type: "button", "aria-label": "Rotate line five degrees anticlockwise" } });
  const rotateRightButton = el("button", { className: "worldsplit-adjust-button", text: "5° ↻", attrs: { type: "button", "aria-label": "Rotate line five degrees clockwise" } });
  const shiftBackButton = el("button", { className: "worldsplit-adjust-button", text: "Toward B", attrs: { type: "button", "aria-label": "Shift line toward side B" } });
  const shiftForwardButton = el("button", { className: "worldsplit-adjust-button", text: "Toward A", attrs: { type: "button", "aria-label": "Shift line toward side A" } });
  const resetLineButton = el("button", { className: "worldsplit-reset-line", text: "Clear line", attrs: { type: "button" } });
  const adjustControls = el("div", {
    className: "worldsplit-adjustments",
    children: [
      el("div", { className: "worldsplit-adjust-row", children: [rotateLeftButton, rotateRightButton] }),
      el("div", { className: "worldsplit-adjust-row", children: [shiftBackButton, shiftForwardButton] }),
      resetLineButton,
    ],
  });

  const lockButton = el("button", { className: "primary-action worldsplit-primary", text: "Lock split", attrs: { type: "button" } });
  lockButton.disabled = true;
  const nextButton = el("button", { className: "primary-action worldsplit-primary", text: "Next round", attrs: { type: "button" } });
  nextButton.hidden = true;
  const copyButton = el("button", { className: "ghost-action worldsplit-copy", text: "Copy result", attrs: { type: "button" } });
  copyButton.hidden = true;
  const playAgainButton = el("button", { className: "primary-action worldsplit-primary", text: "Play again", attrs: { type: "button" } });
  playAgainButton.hidden = true;

  const resultCallout = el("div", { className: "worldsplit-result-callout" });
  resultCallout.hidden = true;

  const panel = el("aside", {
    className: "worldsplit-panel",
    children: [
      el("div", { className: "worldsplit-panel-title", children: [roundEyebrow, roundTitle, roundDetail] }),
      el("div", {
        className: "worldsplit-progress",
        children: [el("div", { children: [progressLabel, scoreLabel] }), el("div", { className: "worldsplit-progress-dots", children: progressDots })],
      }),
      statusText,
      sideCards,
      resultCallout,
      adjustControls,
      el("div", { className: "worldsplit-panel-actions", children: [lockButton, nextButton, playAgainButton, copyButton] }),
      el("p", { className: "worldsplit-data-note", text: "Population weights use rounded 2024 estimates so every round stays reproducible." }),
    ],
  });

  function currentRound() {
    return WORLD_SPLIT_ROUNDS[roundIndex]!;
  }

  function totalScore(): number {
    return scores.reduce((sum, score) => sum + score, 0);
  }

  function updateProgress(): void {
    progressLabel.textContent = finished ? "Run complete" : `Round ${roundIndex + 1} of ${WORLD_SPLIT_ROUNDS.length}`;
    scoreLabel.textContent = `${totalScore()} pts`;
    progressDots.forEach((dot, index) => {
      dot.classList.toggle("is-complete", index < scores.length);
      dot.classList.toggle("is-active", !finished && index === roundIndex);
    });
  }

  function setCountryClasses(): void {
    const round = currentRound();
    for (const [code, path] of pathByCode) {
      const country = countryByCode.get(code);
      const active = country ? isCountryInWorldSplitRound(country, round) : false;
      path.classList.toggle("is-outside", !active);
      path.classList.remove("is-side-a", "is-side-b");
      if (!active || !country || !line) continue;
      path.classList.add(worldSplitSideForPoint(country.point, line) === "a" ? "is-side-a" : "is-side-b");
    }
  }

  function renderLine(): void {
    const hasLine = line !== null && splitLineLength(line) >= MIN_DRAW_LENGTH;
    splitGlow.classList.toggle("is-hidden", !hasLine);
    splitStroke.classList.toggle("is-hidden", !hasLine);
    startHandle.classList.toggle("is-hidden", !hasLine);
    endHandle.classList.toggle("is-hidden", !hasLine);
    lockButton.disabled = !hasLine || submittedResult !== null || finished;
    resetLineButton.disabled = !hasLine || submittedResult !== null || finished;
    mapHint.classList.toggle("is-hidden", hasLine || submittedResult !== null || finished);

    if (hasLine && line) {
      const [extendedStart, extendedEnd] = extendSplitLineToMap(line);
      for (const lineElement of [splitGlow, splitStroke]) {
        lineElement.setAttribute("x1", extendedStart[0].toFixed(3));
        lineElement.setAttribute("y1", extendedStart[1].toFixed(3));
        lineElement.setAttribute("x2", extendedEnd[0].toFixed(3));
        lineElement.setAttribute("y2", extendedEnd[1].toFixed(3));
      }
      startHandle.setAttribute("cx", line[0][0].toFixed(3));
      startHandle.setAttribute("cy", line[0][1].toFixed(3));
      endHandle.setAttribute("cx", line[1][0].toFixed(3));
      endHandle.setAttribute("cy", line[1][1].toFixed(3));
      statusText.textContent = submittedResult ? statusText.textContent : "Fine-tune the line, then lock your split.";
    } else if (!submittedResult && !finished) {
      statusText.textContent = "Draw a line to make your split.";
    }

    setCountryClasses();
  }

  function setAdjustmentDisabled(disabled: boolean): void {
    rotateLeftButton.disabled = disabled;
    rotateRightButton.disabled = disabled;
    shiftBackButton.disabled = disabled;
    shiftForwardButton.disabled = disabled;
  }

  function renderRound(): void {
    const round = currentRound();
    finished = false;
    line = null;
    submittedResult = null;
    roundEyebrow.textContent = `Worldsplit · ${round.label}`;
    roundTitle.textContent = round.prompt;
    roundDetail.textContent = round.detail;
    sideAValue.textContent = "?";
    sideBValue.textContent = "?";
    sideAPopulation.textContent = "Hidden until you lock";
    sideBPopulation.textContent = "Hidden until you lock";
    resultCallout.hidden = true;
    resultCallout.replaceChildren();
    adjustControls.hidden = false;
    sideCards.hidden = false;
    lockButton.hidden = false;
    nextButton.hidden = true;
    playAgainButton.hidden = true;
    copyButton.hidden = true;
    setAdjustmentDisabled(false);
    svg.classList.remove("is-locked");
    updateProgress();
    renderLine();
  }

  function submitRound(): void {
    if (!line || splitLineLength(line) < MIN_DRAW_LENGTH || submittedResult || finished) return;
    submittedResult = scoreWorldSplit(countries, currentRound(), line);
    scores.push(submittedResult.score);
    sideAValue.textContent = `${submittedResult.sideAPercent.toFixed(1)}%`;
    sideBValue.textContent = `${submittedResult.sideBPercent.toFixed(1)}%`;
    sideAPopulation.textContent = `≈ ${formatPopulationMillions(submittedResult.sideAPopulationMillions)} people`;
    sideBPopulation.textContent = `≈ ${formatPopulationMillions(submittedResult.sideBPopulationMillions)} people`;
    statusText.textContent = feedbackForScore(submittedResult.score);
    resultCallout.hidden = false;
    resultCallout.replaceChildren(
      el("strong", { text: `+${submittedResult.score} points` }),
      el("span", { text: `${submittedResult.errorPercentagePoints.toFixed(1)} percentage points from a perfect half.` }),
    );
    lockButton.hidden = true;
    nextButton.hidden = false;
    nextButton.textContent = roundIndex === WORLD_SPLIT_ROUNDS.length - 1 ? "See final score" : "Next round";
    setAdjustmentDisabled(true);
    resetLineButton.disabled = true;
    svg.classList.add("is-locked");
    updateProgress();
    renderLine();
  }

  function finishGame(): void {
    finished = true;
    const score = totalScore();
    const maximum = WORLD_SPLIT_ROUNDS.length * WORLD_SPLIT_MAX_ROUND_SCORE;
    const previousBest = readBestScore(options.storage);
    const best = Math.max(previousBest, score);
    options.storage.setItem(BEST_SCORE_KEY, String(best));
    const newBest = score > previousBest;

    roundEyebrow.textContent = "Worldsplit complete";
    roundTitle.textContent = `${score} / ${maximum}`;
    roundDetail.textContent = newBest ? "New personal best. Your population instinct is sharp." : `Personal best: ${best} points.`;
    statusText.textContent = score >= 450 ? "You can read population patterns at a glance." : score >= 350 ? "A strong run across five different maps." : "Every line teaches you where people really live.";
    sideCards.hidden = true;
    resultCallout.hidden = false;
    resultCallout.replaceChildren(
      el("strong", { text: newBest ? "New best score" : "Run summary" }),
      el("span", { text: scores.map((roundScore, index) => `${WORLD_SPLIT_ROUNDS[index]!.label}: ${roundScore}`).join(" · ") }),
    );
    adjustControls.hidden = true;
    lockButton.hidden = true;
    nextButton.hidden = true;
    playAgainButton.hidden = false;
    copyButton.hidden = false;
    updateProgress();
  }

  function nextRound(): void {
    if (!submittedResult) return;
    if (roundIndex >= WORLD_SPLIT_ROUNDS.length - 1) {
      finishGame();
      return;
    }
    roundIndex += 1;
    renderRound();
  }

  function playAgain(): void {
    scores.splice(0, scores.length);
    roundIndex = 0;
    renderRound();
  }

  function ensureLine(): SplitLine {
    if (!line || splitLineLength(line) < MIN_DRAW_LENGTH) line = DEFAULT_WORLD_SPLIT_LINE;
    return line;
  }

  function applyLineAdjustment(adjust: (activeLine: SplitLine) => SplitLine): void {
    if (submittedResult || finished) return;
    line = adjust(ensureLine());
    renderLine();
  }

  function stopDrawing(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    activePointerId = null;
    dragStart = null;
    if (line && splitLineLength(line) < MIN_DRAW_LENGTH) line = null;
    renderLine();
  }

  svg.addEventListener("pointerdown", (event) => {
    if (submittedResult || finished || event.button !== 0) return;
    const start = pointerToMap(svg, event.clientX, event.clientY);
    activePointerId = event.pointerId;
    dragStart = start;
    line = [start, start];
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("is-drawing");
    renderLine();
  }, { signal: controller.signal });

  svg.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId || !dragStart || submittedResult || finished) return;
    line = [dragStart, pointerToMap(svg, event.clientX, event.clientY)];
    renderLine();
  }, { signal: controller.signal });

  svg.addEventListener("pointerup", (event) => {
    svg.classList.remove("is-drawing");
    stopDrawing(event);
  }, { signal: controller.signal });
  svg.addEventListener("pointercancel", (event) => {
    svg.classList.remove("is-drawing");
    stopDrawing(event);
  }, { signal: controller.signal });

  rotateLeftButton.addEventListener("click", () => applyLineAdjustment((activeLine) => rotateSplitLine(activeLine, -5)), { signal: controller.signal });
  rotateRightButton.addEventListener("click", () => applyLineAdjustment((activeLine) => rotateSplitLine(activeLine, 5)), { signal: controller.signal });
  shiftBackButton.addEventListener("click", () => applyLineAdjustment((activeLine) => shiftSplitLine(activeLine, -15)), { signal: controller.signal });
  shiftForwardButton.addEventListener("click", () => applyLineAdjustment((activeLine) => shiftSplitLine(activeLine, 15)), { signal: controller.signal });
  resetLineButton.addEventListener("click", () => {
    if (submittedResult || finished) return;
    line = null;
    renderLine();
  }, { signal: controller.signal });
  lockButton.addEventListener("click", submitRound, { signal: controller.signal });
  nextButton.addEventListener("click", nextRound, { signal: controller.signal });
  playAgainButton.addEventListener("click", playAgain, { signal: controller.signal });
  copyButton.addEventListener("click", () => {
    const maximum = WORLD_SPLIT_ROUNDS.length * WORLD_SPLIT_MAX_ROUND_SCORE;
    const text = `Worldsplit ${totalScore()}/${maximum}\n${scores.map((score) => score >= 90 ? "🟩" : score >= 70 ? "🟨" : score >= 50 ? "🟧" : "⬜").join("")}\nlocato.quest`;
    void navigator.clipboard?.writeText(text).then(() => {
      copyButton.textContent = "Copied";
      window.setTimeout(() => { copyButton.textContent = "Copy result"; }, 1600);
    }).catch(() => {
      copyButton.textContent = "Copy unavailable";
    });
  }, { signal: controller.signal });
  dailyButton.addEventListener("click", () => options.onDailyChallenge?.(), { signal: controller.signal });
  multiplayerButton.addEventListener("click", () => options.onMultiplayer?.(), { signal: controller.signal });

  const element = el("section", {
    className: "game-screen worldsplit-screen",
    children: [
      el("header", {
        className: "game-header",
        children: [
          el("div", { className: "game-header-left", children: [createBrandLockup(options.onHome), gameModeDropdown.element] }),
          el("div", { className: "game-header-actions", children: [dailyButton, multiplayerButton, mobileNav.button, mobileNav.sheet] }),
        ],
      }),
      el("main", { className: "worldsplit-layout", children: [mapShell, panel] }),
    ],
  });

  renderRound();

  return {
    element,
    destroy: () => controller.abort(),
  };
}
