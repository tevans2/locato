import type { RunType, ShellContext } from "../shell/types";
import {
  FLYOVER_HINT_AFTER_SECONDS,
  FLYOVER_RUN_SECONDS,
  FLYOVER_SKIP_PENALTY_SECONDS,
  buildFlyoverCountries,
  countryUnderPoint,
  headingTowards,
  pickNextTarget,
  planeTouchesCountry,
  startingPlane,
  stepPlane,
  wrappedDeltaX,
  type FlyoverCountry,
  type PlaneState,
  type Rng,
} from "../../core/flyover";
import { MAP_VIEWBOX_HEIGHT, MAP_VIEWBOX_WIDTH, type WorldCountryFeature } from "../../core/map";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createResultsCard } from "../shell/ResultsCard";
import { shellIcon } from "../shell/icons";
import { createPracticeBar, createResultsStage, createRunList, formatNumber, insertIntoResults, recordLocalBest, shellOrFallback } from "./practiceRun";
import { createRankedBar, createRankedResults, rankedCrossLink, submitRankedAttempt, type PostRankedAttempt } from "./rankedAttempt";
import "../../styles/flyover.css";

const BEST_SCORE_KEY = "locato:flyover:best-score:v1";
/** Lucide "plane" (ISC licence): drawn on the canvas, nose towards the icon's top-right corner. */
const PLANE_PATH = "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z";
const PLANE_SIZE = 34;
const TRAIL_LENGTH = 70;
const MINIMAP_WIDTH = 176;
const MINIMAP_HEIGHT = 88;
const TURN_KEYS_LEFT = new Set(["ArrowLeft", "a", "A"]);
const TURN_KEYS_RIGHT = new Set(["ArrowRight", "d", "D"]);
const BOOST_KEYS = new Set(["ArrowUp", "w", "W", "Shift", " "]);

export interface FlyoverScreenOptions {
  /** Navigation shell (docs/navigation.md). */
  readonly shell?: ShellContext;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly storage: Storage;
  readonly onHome: () => void;
  /** "timed" (`&run=timed`): a ranked attempt whose country count posts to the Flyover board. */
  readonly run?: RunType;
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

interface Palette {
  sea: string;
  seaEdge: string;
  land: string;
  over: string;
  visited: string;
  border: string;
  plane: string;
  planeEdge: string;
  hint: string;
}

function flagSrc(code: string): string {
  return `/assets/flags/${code.toLowerCase()}.svg`;
}

function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function buildPath(country: FlyoverCountry): Path2D | null {
  if (typeof Path2D === "undefined") return null;
  const path = new Path2D();
  for (const polygon of country.polygons) {
    for (const ring of polygon) {
      ring.forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
      path.closePath();
    }
  }
  return path;
}

function readPalette(element: HTMLElement): Palette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    sea: token("--flyover-sea", "#c9e0df"),
    seaEdge: token("--flyover-sea-edge", "#b3cfcd"),
    land: token("--flyover-land", "#f7f5eb"),
    over: token("--flyover-over", "#eef1dc"),
    visited: token("--flyover-visited", "#bbcf91"),
    border: token("--flyover-border", "rgba(30, 40, 30, .35)"),
    plane: token("--flyover-plane", "#b9734d"),
    planeEdge: token("--flyover-plane-edge", "#ffffff"),
    hint: token("--flyover-hint", "#31583f"),
  };
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
  const ranked = options.run === "timed";
  const shell = shellOrFallback(options.shell, options.onHome);
  const rng = services.rng ?? Math.random;
  const now = services.now ?? (() => performance.now());
  const requestFrame = services.requestFrame ?? ((callback: () => void) => requestAnimationFrame(callback));
  const cancelFrame = services.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));
  const countries = buildFlyoverCountries(options.worldCountryFeatures);
  const paths = new Map<string, Path2D | null>(countries.map((country) => [country.code, buildPath(country)]));

  type Phase = "ready" | "flying" | "done";
  let phase: Phase = "ready";
  let plane: PlaneState = startingPlane(countries, rng);
  let target: FlyoverCountry | null = null;
  let targetSince = 0;
  let runEndsAt = 0;
  let lastFrameAt = 0;
  let frameHandle: number | null = null;
  let over: FlyoverCountry | null = null;
  let overCheckCountdown = 0;
  let flashUntil = 0;
  let trail: { x: number; y: number }[] = [];
  const reached: Reached[] = [];
  const skipped: FlyoverCountry[] = [];
  const visitedCodes = new Set<string>();
  const heldKeys = new Set<string>();
  let pointerSteer: { id: number; x: number; y: number } | null = null;
  let boostHeld = false;

  // --- DOM ---------------------------------------------------------------------------------
  const canvas = el("canvas", { className: "flyover-canvas", attrs: { role: "img", tabindex: "0", "aria-label": "World map seen from the plane. Steer with the arrow keys, or hold the map in the direction you want to fly." } });
  const ctx = canvas.getContext?.("2d") ?? null;
  const minimap = el("canvas", { className: "flyover-minimap", attrs: { "aria-hidden": "true", width: String(MINIMAP_WIDTH * 2), height: String(MINIMAP_HEIGHT * 2) } });
  const minimapCtx = minimap.getContext?.("2d") ?? null;
  let minimapBase: HTMLCanvasElement | null = null;

  const targetFlag = el("img", { className: "flyover-target-flag", attrs: { alt: "", width: "36", height: "24", decoding: "async" } });
  const targetName = el("strong", { className: "flyover-target-name", text: "…" });
  const targetCard = el("div", {
    className: "flyover-target",
    attrs: { role: "status", "aria-live": "polite" },
    children: [el("span", { className: "flyover-target-label", text: "Fly to" }), el("span", { className: "flyover-target-row", children: [targetFlag, targetName] })],
  });
  const clockValue = el("strong", { className: "flyover-clock-value", text: formatClock(FLYOVER_RUN_SECONDS) });
  const clock = el("div", { className: "flyover-clock", children: [shellIcon("timer", 16, 2), clockValue] });
  const scoreValue = el("strong", { className: "flyover-score-value", text: "0" });
  const scoreBox = el("div", { className: "flyover-score", children: [scoreValue, el("span", { text: "countries" })] });
  const overLabel = el("div", { className: "flyover-over", text: "Over the ocean" });
  const toast = el("div", { className: "flyover-toast", attrs: { "aria-hidden": "true" } });
  const skipButton = el("button", { className: "flyover-skip", text: `Skip · −${FLYOVER_SKIP_PENALTY_SECONDS}s`, attrs: { type: "button" } });
  const boostButton = el("button", { className: "flyover-boost", text: "Boost", attrs: { type: "button", "aria-label": "Hold to fly faster" } });

  const startButton = el("button", { className: "primary-action flyover-start", text: "Take off", attrs: { type: "button" } });
  const readyOverlay = el("div", {
    className: "flyover-ready",
    children: [
      el("div", {
        className: "flyover-ready-card",
        children: [
          el("span", { className: "eyebrow", text: ranked ? "Flyover · Ranked attempt" : "Flyover · Practice" }),
          el("h1", { text: "Fly over the named country." }),
          el("p", { text: `Each country you touch scores a point and names the next. You have ${FLYOVER_RUN_SECONDS} seconds.` }),
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

  const stage = el("div", {
    className: "flyover-stage",
    children: [
      canvas,
      el("div", { className: "flyover-hud-top", children: [clock, targetCard, scoreBox] }),
      toast,
      el("div", { className: "flyover-hud-bottom", children: [el("div", { className: "flyover-hud-left", children: [skipButton, boostButton] }), overLabel, minimap] }),
      readyOverlay,
    ],
  });

  // --- Drawing -----------------------------------------------------------------------------
  let cssWidth = 0;
  let cssHeight = 0;
  let dpr = 1;
  let palette = readPalette(stage);
  let planeShape: Path2D | null = null;

  function viewScale(): number {
    return Math.max(2.6, Math.min(9, Math.min(cssWidth / 190, cssHeight / 105)));
  }

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    cssWidth = rect.width;
    cssHeight = rect.height;
    dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    draw();
  }

  function renderMinimapBase(): void {
    if (!minimapCtx || typeof document === "undefined") return;
    minimapBase ??= document.createElement("canvas");
    minimapBase.width = MINIMAP_WIDTH * 2;
    minimapBase.height = MINIMAP_HEIGHT * 2;
    const base = minimapBase.getContext("2d");
    if (!base) return;
    const scale = minimapBase.width / MAP_VIEWBOX_WIDTH;
    base.setTransform(1, 0, 0, 1, 0, 0);
    base.fillStyle = palette.sea;
    base.fillRect(0, 0, minimapBase.width, minimapBase.height);
    base.setTransform(scale, 0, 0, (minimapBase.height / MAP_VIEWBOX_HEIGHT), 0, 0);
    for (const country of countries) {
      const path = paths.get(country.code);
      if (!path) continue;
      base.fillStyle = visitedCodes.has(country.code) ? palette.visited : palette.land;
      base.fill(path);
    }
  }

  function drawMinimap(): void {
    if (!minimapCtx) return;
    if (!minimapBase) renderMinimapBase();
    const width = minimap.width;
    const height = minimap.height;
    minimapCtx.setTransform(1, 0, 0, 1, 0, 0);
    minimapCtx.clearRect(0, 0, width, height);
    if (minimapBase) minimapCtx.drawImage(minimapBase, 0, 0);
    const sx = width / MAP_VIEWBOX_WIDTH;
    const sy = height / MAP_VIEWBOX_HEIGHT;
    const scale = viewScale();
    const viewW = (cssWidth / scale) * sx;
    const viewH = (cssHeight / scale) * sy;
    minimapCtx.strokeStyle = palette.hint;
    minimapCtx.lineWidth = 2;
    for (const offset of [-width, 0, width]) {
      minimapCtx.strokeRect(plane.x * sx - viewW / 2 + offset, plane.y * sy - viewH / 2, viewW, viewH);
    }
    minimapCtx.fillStyle = palette.plane;
    minimapCtx.beginPath();
    minimapCtx.arc(plane.x * sx, plane.y * sy, 5, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  function draw(): void {
    if (!ctx || cssWidth <= 0 || cssHeight <= 0) return;
    const scale = viewScale();
    const centreX = cssWidth / 2;
    const centreY = cssHeight / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = palette.seaEdge;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const halfW = centreX / scale;
    const halfH = centreY / scale;
    for (const offset of [-MAP_VIEWBOX_WIDTH, 0, MAP_VIEWBOX_WIDTH]) {
      // The map copy at `offset` is visible when its span overlaps the view.
      const viewLeft = plane.x - offset - halfW;
      const viewRight = plane.x - offset + halfW;
      if (viewRight < 0 || viewLeft > MAP_VIEWBOX_WIDTH) continue;
      const viewTop = plane.y - halfH;
      const viewBottom = plane.y + halfH;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (centreX + (offset - plane.x) * scale), dpr * (centreY - plane.y * scale));
      ctx.fillStyle = palette.sea;
      ctx.fillRect(0, 0, MAP_VIEWBOX_WIDTH, MAP_VIEWBOX_HEIGHT);

      ctx.strokeStyle = palette.border;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([2 / scale, 6 / scale]);
      ctx.beginPath();
      for (let x = 0; x <= MAP_VIEWBOX_WIDTH; x += MAP_VIEWBOX_WIDTH / 36) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, MAP_VIEWBOX_HEIGHT);
      }
      for (let y = 0; y <= MAP_VIEWBOX_HEIGHT; y += MAP_VIEWBOX_HEIGHT / 14.5) {
        ctx.moveTo(0, y);
        ctx.lineTo(MAP_VIEWBOX_WIDTH, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      ctx.lineWidth = 0.9 / scale;
      ctx.lineJoin = "round";
      for (const country of countries) {
        const [minX, minY, maxX, maxY] = country.bounds;
        if (maxX < viewLeft || minX > viewRight || maxY < viewTop || minY > viewBottom) continue;
        const path = paths.get(country.code);
        if (!path) continue;
        ctx.fillStyle = visitedCodes.has(country.code) ? palette.visited : over?.code === country.code ? palette.over : palette.land;
        ctx.fill(path);
        ctx.stroke(path);
      }
    }

    // Everything below is in screen space, centred on the plane.
    ctx.setTransform(dpr, 0, 0, dpr, dpr * centreX, dpr * centreY);

    if (trail.length > 1) {
      ctx.lineCap = "round";
      for (let index = 1; index < trail.length; index += 1) {
        const a = trail[index - 1]!;
        const b = trail[index]!;
        ctx.globalAlpha = (index / trail.length) * 0.55;
        ctx.strokeStyle = palette.planeEdge;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(wrappedDeltaX(plane.x, a.x) * scale, (a.y - plane.y) * scale);
        ctx.lineTo(wrappedDeltaX(plane.x, b.x) * scale, (b.y - plane.y) * scale);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    const clockNow = now();
    if (phase === "flying" && target && (clockNow - targetSince) / 1000 >= FLYOVER_HINT_AFTER_SECONDS) {
      const angle = headingTowards([plane.x, plane.y], target.centre);
      const radius = PLANE_SIZE * 1.35;
      ctx.save();
      ctx.rotate(angle);
      ctx.fillStyle = palette.hint;
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(clockNow / 180);
      ctx.beginPath();
      ctx.moveTo(radius + 14, 0);
      ctx.lineTo(radius, -8);
      ctx.lineTo(radius + 3, 0);
      ctx.lineTo(radius, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (clockNow < flashUntil) {
      const progress = 1 - (flashUntil - clockNow) / 600;
      ctx.strokeStyle = palette.visited;
      ctx.globalAlpha = 1 - progress;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, PLANE_SIZE * (0.6 + progress * 1.6), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    planeShape ??= typeof Path2D !== "undefined" ? new Path2D(PLANE_PATH) : null;
    if (planeShape) {
      const size = PLANE_SIZE / 24;
      // Shadow on the ground, offset down-right.
      ctx.save();
      ctx.translate(7, 10);
      ctx.rotate(plane.heading + Math.PI / 4);
      ctx.scale(size * 0.9, size * 0.9);
      ctx.translate(-12, -12);
      ctx.fillStyle = "rgba(0, 0, 0, .18)";
      ctx.fill(planeShape);
      ctx.restore();

      ctx.save();
      ctx.rotate(plane.heading + Math.PI / 4);
      ctx.scale(size, size);
      ctx.translate(-12, -12);
      ctx.fillStyle = palette.plane;
      ctx.strokeStyle = palette.planeEdge;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.stroke(planeShape);
      ctx.fill(planeShape);
      ctx.restore();
    }

    drawMinimap();
  }

  // --- Game --------------------------------------------------------------------------------
  function setTarget(next: FlyoverCountry | null): void {
    target = next;
    targetSince = now();
    if (!next) {
      targetName.textContent = "Every country visited!";
      targetFlag.hidden = true;
      return;
    }
    targetName.textContent = next.name;
    targetFlag.hidden = false;
    targetFlag.setAttribute("src", flagSrc(next.code));
    targetCard.classList.remove("is-new");
    void targetCard.offsetWidth;
    targetCard.classList.add("is-new");
  }

  function excluded(): Set<string> {
    const codes = new Set(visitedCodes);
    for (const country of skipped) codes.add(country.code);
    if (target) codes.add(target.code);
    return codes;
  }

  function showToast(text: string): void {
    toast.textContent = text;
    toast.classList.remove("is-shown");
    void toast.offsetWidth;
    toast.classList.add("is-shown");
  }

  function updateScore(): void {
    scoreValue.textContent = String(reached.length);
  }

  function updateClock(clockNow: number): void {
    const left = (runEndsAt - clockNow) / 1000;
    clockValue.textContent = formatClock(left);
    clock.classList.toggle("is-low", left <= 10);
  }

  function reach(country: FlyoverCountry, clockNow: number): void {
    reached.push({ country, seconds: (clockNow - targetSince) / 1000 });
    visitedCodes.add(country.code);
    flashUntil = clockNow + 600;
    showToast(`+1 ${country.name}`);
    updateScore();
    renderMinimapBase();
    const next = pickNextTarget(countries, [plane.x, plane.y], excluded(), rng);
    setTarget(next);
    if (!next) finish();
  }

  function skip(): void {
    if (phase !== "flying" || !target) return;
    skipped.push(target);
    runEndsAt -= FLYOVER_SKIP_PENALTY_SECONDS * 1000;
    showToast(`Skipped ${target.name} · −${FLYOVER_SKIP_PENALTY_SECONDS}s`);
    const next = pickNextTarget(countries, [plane.x, plane.y], excluded(), rng);
    setTarget(next);
    updateClock(now());
    if (!next || runEndsAt <= now()) finish();
  }

  function currentInput() {
    const left = [...heldKeys].some((key) => TURN_KEYS_LEFT.has(key));
    const right = [...heldKeys].some((key) => TURN_KEYS_RIGHT.has(key));
    const boost = boostHeld || [...heldKeys].some((key) => BOOST_KEYS.has(key));
    const towards = pointerSteer ? pointerHeading(pointerSteer) : null;
    return { turn: (right ? 1 : 0) - (left ? 1 : 0), towards, boost };
  }

  function pointerHeading(pointer: { x: number; y: number }): number | null {
    const rect = canvas.getBoundingClientRect();
    const dx = pointer.x - (rect.left + rect.width / 2);
    const dy = pointer.y - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) < 12) return null;
    return Math.atan2(dy, dx);
  }

  function tick(): void {
    frameHandle = null;
    const clockNow = now();
    const dt = Math.min(0.05, Math.max(0, (clockNow - lastFrameAt) / 1000));
    lastFrameAt = clockNow;
    if (phase === "flying") {
      plane = stepPlane(plane, currentInput(), dt);
      trail.push({ x: plane.x, y: plane.y });
      if (trail.length > TRAIL_LENGTH) trail = trail.slice(-TRAIL_LENGTH);
      if (target && planeTouchesCountry(target, plane.x, plane.y)) reach(target, clockNow);
      overCheckCountdown -= 1;
      if (overCheckCountdown <= 0) {
        overCheckCountdown = 5;
        const under = countryUnderPoint(countries, plane.x, plane.y);
        if (under?.code !== over?.code) {
          over = under;
          overLabel.textContent = under ? `Over ${under.name}` : "Over the ocean";
        }
      }
      updateClock(clockNow);
      if (phase === "flying" && clockNow >= runEndsAt) finish();
    }
    draw();
    if (phase === "flying") scheduleFrame();
  }

  function scheduleFrame(): void {
    if (frameHandle === null && !signal.aborted) frameHandle = requestFrame(tick);
  }

  function start(): void {
    if (phase !== "ready") return;
    phase = "flying";
    readyOverlay.hidden = true;
    stage.classList.add("is-flying");
    const clockNow = now();
    runEndsAt = clockNow + FLYOVER_RUN_SECONDS * 1000;
    lastFrameAt = clockNow;
    setTarget(pickNextTarget(countries, [plane.x, plane.y], excluded(), rng));
    updateClock(clockNow);
    // Drop focus from Take off so Space (boost) can't press a button mid-flight.
    if (document.activeElement instanceof HTMLElement && element.contains(document.activeElement)) document.activeElement.blur();
    scheduleFrame();
  }

  function reset(): void {
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
    phase = "ready";
    plane = startingPlane(countries, rng);
    target = null;
    over = null;
    trail = [];
    reached.splice(0);
    skipped.splice(0);
    visitedCodes.clear();
    heldKeys.clear();
    pointerSteer = null;
    boostHeld = false;
    flashUntil = 0;
    targetName.textContent = "…";
    targetFlag.hidden = true;
    overLabel.textContent = "Over the ocean";
    clockValue.textContent = formatClock(FLYOVER_RUN_SECONDS);
    clock.classList.remove("is-low");
    stage.classList.remove("is-flying");
    readyOverlay.hidden = false;
    updateScore();
    renderMinimapBase();
    resultsStage.hide();
    // The layout is visible again: measure it.
    resize();
    startButton.focus();
  }

  function finish(): void {
    if (phase === "done") return;
    phase = "done";
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
    heldKeys.clear();
    pointerSteer = null;
    stage.classList.remove("is-flying");
    const score = reached.length;
    const fastest = reached.reduce<Reached | null>((best, item) => (!best || item.seconds < best.seconds ? item : best), null);
    const flags = reached.slice(0, 24).map((item) => flagEmoji(item.country.code)).join("");
    const shareText = `Locato Flyover${ranked ? " (ranked)" : ""} ✈️ ${score} ${score === 1 ? "country" : "countries"} in ${FLYOVER_RUN_SECONDS}s\n${flags}${reached.length > 24 ? "…" : ""}\nlocato.quest`;
    const runList = createRunList("Your route", reached.map((item) => ({
      label: item.country.name,
      detail: item.country.continent,
      value: `${item.seconds.toFixed(1)}s`,
      tone: item.seconds <= 5 ? "good" : item.seconds <= 12 ? "ok" : "miss",
      flagSrc: flagSrc(item.country.code),
      onClick: () => shell.openCountry(item.country.code),
      ariaLabel: `${item.country.name}, reached in ${item.seconds.toFixed(1)} seconds. Open in the Atlas`,
    })));
    const missed = skipped.map((country) => ({ code: country.code, name: country.name, flagSrc: flagSrc(country.code) }));
    const stats = [
      { label: "Countries", value: formatNumber(score), note: `in ${FLYOVER_RUN_SECONDS} seconds` },
      ...(fastest ? [{ label: "Quickest find", value: `${fastest.seconds.toFixed(1)}s`, note: fastest.country.name }] : []),
    ];

    if (ranked) {
      const rankedCard = createRankedResults(shell, {
        mode: "flyover",
        title: feedbackTitle(score),
        total: score,
        stats,
        ...(missed.length ? { missed, missedTitle: "Skipped — worth another look" } : {}),
        shareTitle: "Locato Flyover",
        shareText,
        onTryAgain: reset,
        posting: submitRankedAttempt({ shell, mode: "flyover", total: score, storage: options.storage, ...(services.postAttempt ? { post: services.postAttempt } : {}) }),
        tone: score >= 10 ? "celebrate" : "neutral",
      });
      if (reached.length) insertIntoResults(rankedCard, runList);
      resultsStage.show(rankedCard);
      return;
    }

    const localBest = recordLocalBest(options.storage, BEST_SCORE_KEY, score);
    const card = createResultsCard(shell, {
      kicker: "Flyover · Practice",
      title: localBest.isNew && localBest.previous > 0 ? "A new best flight!" : feedbackTitle(score),
      subtitle: score >= 18 ? "You know your way around the world." : score >= 8 ? "Every country gets quicker to find." : "Head for the big ones first, then fill in the neighbours.",
      stats: [...stats, { label: "Your best", value: formatNumber(localBest.best), note: localBest.isNew ? "New best" : "On this device" }],
      ...(missed.length ? { missed, missedTitle: "Skipped — worth another look" } : {}),
      primary: { label: "Fly again", onClick: reset },
      share: { title: "Locato Flyover", text: shareText },
      crossLink: rankedCrossLink(shell, "flyover"),
      tone: score >= 10 ? "celebrate" : "neutral",
    });
    if (reached.length) insertIntoResults(card, runList);
    resultsStage.show(card);
  }

  // --- Input -------------------------------------------------------------------------------
  function isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
  }

  window.addEventListener("keydown", (event) => {
    if (!element.isConnected || isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
    const steering = TURN_KEYS_LEFT.has(event.key) || TURN_KEYS_RIGHT.has(event.key) || BOOST_KEYS.has(event.key);
    if (phase === "ready" && steering) {
      event.preventDefault();
      start();
    }
    if (phase !== "flying") return;
    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      skip();
      return;
    }
    if (steering) {
      event.preventDefault();
      heldKeys.add(event.key);
    }
  }, { signal });
  window.addEventListener("keyup", (event) => {
    heldKeys.delete(event.key);
    // Shift changes the reported key of letters; clear the pair so nothing sticks.
    if (event.key.length === 1) {
      heldKeys.delete(event.key.toLowerCase());
      heldKeys.delete(event.key.toUpperCase());
    }
  }, { signal });
  window.addEventListener("blur", () => {
    heldKeys.clear();
    pointerSteer = null;
    boostHeld = false;
  }, { signal });

  canvas.addEventListener("pointerdown", (event) => {
    if (phase !== "flying" || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    pointerSteer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture?.(event.pointerId);
  }, { signal });
  canvas.addEventListener("pointermove", (event) => {
    if (pointerSteer?.id === event.pointerId) pointerSteer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, { signal });
  const endPointer = (event: PointerEvent) => {
    if (pointerSteer?.id !== event.pointerId) return;
    pointerSteer = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener("pointerup", endPointer, { signal });
  canvas.addEventListener("pointercancel", endPointer, { signal });

  boostButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    boostHeld = true;
  }, { signal });
  for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) boostButton.addEventListener(type, () => (boostHeld = false), { signal });
  boostButton.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });

  skipButton.addEventListener("click", skip, { signal });
  startButton.addEventListener("click", start, { signal });

  // --- Mount -------------------------------------------------------------------------------
  const layout = el("main", { className: "flyover-layout", children: [stage] });
  const resultsStage = createResultsStage(layout);
  const element = el("section", { className: "game-screen flyover-screen gb-screen" });
  const inProgress = () => phase === "flying";
  const bar = ranked
    ? createRankedBar(element, shell, { gameMode: "flyover", inProgress })
    : createPracticeBar(element, shell, {
        gameMode: "flyover",
        leaveGuard: () => (inProgress() ? "You're mid-flight. Leaving ends this run and the score isn't kept." : null),
        extraMenuItems: [{ label: "Restart flight", icon: "rotate-ccw", onSelect: reset }],
      });
  element.append(bar.element, layout, resultsStage.element);

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(canvas);
  }
  let themeObserver: MutationObserver | null = null;
  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    themeObserver = new MutationObserver(() => {
      palette = readPalette(stage);
      renderMinimapBase();
      draw();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  // Colours come from CSS once the element is in the document.
  requestFrame(() => {
    if (signal.aborted) return;
    palette = readPalette(stage);
    renderMinimapBase();
    resize();
    if (phase === "ready") startButton.focus();
  });

  updateScore();
  targetFlag.hidden = true;

  return {
    element,
    destroy: () => {
      controller.abort();
      if (frameHandle !== null) cancelFrame(frameHandle);
      frameHandle = null;
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      bar.destroy();
    },
  };
}
