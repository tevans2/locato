import {
  FLYOVER_HINT_AFTER_SECONDS,
  FLYOVER_SPEED,
  countryUnderPoint,
  headingTowards,
  planeTouchesCountry,
  stepPlane,
  wrapX,
  wrappedDeltaX,
  type FlyoverCountry,
  type PlaneState,
  type PlaneInput,
} from "../../core/flyover";
import { MAP_VIEWBOX_HEIGHT, MAP_VIEWBOX_WIDTH } from "../../core/map";
import { el } from "../dom/createElement";
import { shellIcon } from "../shell/icons";
import "../../styles/flyover.css";

/**
 * The Flyover flight: a canvas world map that scrolls under a centred plane, the HUD around it
 * (clock, the country to fly to, what's under the plane, skip, boost, minimap) and the steering.
 * It flies and draws; the game around it — solo run or multiplayer race — decides what the
 * targets are, what reaching one means and when the flight starts and stops.
 */

/** Lucide "plane" (ISC licence): drawn on the canvas, nose towards the icon's top-right corner. */
const PLANE_PATH = "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z";
const PLANE_SIZE = 34;
const GHOST_SIZE = 26;
const TRAIL_LENGTH = 70;
const MINIMAP_WIDTH = 176;
const MINIMAP_HEIGHT = 88;
/** Ghost planes are predicted forward from their last report for at most this long. */
const GHOST_PREDICT_SECONDS = 0.4;
const TURN_KEYS_LEFT = new Set(["ArrowLeft", "a", "A"]);
const TURN_KEYS_RIGHT = new Set(["ArrowRight", "d", "D"]);
const BOOST_KEYS = new Set(["ArrowUp", "w", "W", "Shift", " "]);

export interface FlyoverGhost {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly heading: number;
  /** Any CSS colour. */
  readonly colour: string;
}

export interface FlyoverFlightOptions {
  readonly countries: readonly FlyoverCountry[];
  /** Fills the top-right of the HUD: the solo score, or the race standings. */
  readonly hudRight: HTMLElement;
  /** Covers the map while not flying: the briefing card, the countdown. */
  readonly overlay: HTMLElement;
  readonly skipLabel: string;
  /** Shown on the clock before take-off. */
  readonly flightSeconds: number;
  readonly now: () => number;
  /** A steady local clock for motion, independent of adjustments to the server clock. */
  readonly animationNow?: () => number;
  readonly requestFrame: (callback: () => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly signal: AbortSignal;
  /** A steering key while the plane is on the ground (the solo game takes off on it). */
  readonly onSteerWhileGrounded?: () => void;
  /** The plane touched the target. The target is cleared first: set the next one. */
  readonly onReach: (country: FlyoverCountry, seconds: number) => void;
  readonly onSkip: () => void;
  readonly onTimeUp: () => void;
  /** Every frame in flight, after the plane moves. */
  readonly onMove?: (plane: PlaneState) => void;
  readonly onInput?: (input: PlaneInput) => void;
  /** Ranked flights count touches on the server. Local motion is a visual prediction only. */
  readonly authoritative?: boolean;
}

export interface FlyoverFlight {
  readonly element: HTMLElement;
  readonly plane: () => PlaneState;
  readonly setPlane: (plane: PlaneState) => void;
  readonly target: () => FlyoverCountry | null;
  readonly isFlying: () => boolean;
  /** Start flying (or keep flying) until `endsAt` on the `now()` clock. */
  readonly fly: (endsAt: number) => void;
  readonly endsAt: () => number;
  readonly setEndsAt: (endsAt: number) => void;
  /** Stop: the plane stays where it is and steering lets go. */
  readonly land: () => void;
  /** Back on the ground at `plane`: clears the trail, visited countries, target and clock. */
  readonly reset: (plane: PlaneState, flightSeconds?: number) => void;
  readonly setTarget: (country: FlyoverCountry | null, emptyText?: string) => void;
  readonly markVisited: (code: string) => void;
  readonly unmarkVisited: (code: string) => void;
  /** No country counts until `until` (the race's holding pattern after a skip). */
  readonly holdUntil: (until: number) => void;
  readonly setGhosts: (ghosts: readonly FlyoverGhost[]) => void;
  readonly showToast: (text: string) => void;
  readonly setSkipLabel: (text: string) => void;
  /** Measure and draw once the element is in the document. */
  readonly mount: () => void;
  readonly destroy: () => void;
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

interface GhostTrack {
  ghost: FlyoverGhost;
  receivedAt: number;
  shown: { x: number; y: number; heading: number };
}

export function flyoverFlagSrc(code: string): string {
  return `/assets/flags/${code.toLowerCase()}.svg`;
}

export function formatFlyoverClock(seconds: number): string {
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

function angleDiff(from: number, to: number): number {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/** A modal dialog is showing. Some stay mounted while hidden (the race's game-over card): those don't count. */
function modalDialogOpen(): boolean {
  return [...document.querySelectorAll("[role='dialog'][aria-modal='true']")].some((dialog) => !dialog.closest("[hidden]"));
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function createFlyoverFlight(options: FlyoverFlightOptions): FlyoverFlight {
  const { countries, now, requestFrame, cancelFrame, signal } = options;
  const animationNow = options.animationNow ?? now;
  const paths = new Map<string, Path2D | null>(countries.map((country) => [country.code, buildPath(country)]));

  let flying = false;
  let plane: PlaneState = { x: MAP_VIEWBOX_WIDTH / 2, y: MAP_VIEWBOX_HEIGHT / 2, heading: 0 };
  let target: FlyoverCountry | null = null;
  let targetSince = 0;
  let runEndsAt = 0;
  let holdEndsAt = 0;
  let lastFrameAt = 0;
  let frameHandle: number | null = null;
  let over: FlyoverCountry | null = null;
  let overCheckCountdown = 0;
  let flashUntil = 0;
  let trail: { x: number; y: number }[] = [];
  const visitedCodes = new Set<string>();
  const heldKeys = new Set<string>();
  let pointerSteer: { id: number; x: number; y: number } | null = null;
  let boostHeld = false;
  const ghosts = new Map<string, GhostTrack>();

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
  const clockValue = el("strong", { className: "flyover-clock-value", text: formatFlyoverClock(options.flightSeconds) });
  const clock = el("div", { className: "flyover-clock", children: [shellIcon("timer", 16, 2), clockValue] });
  const overLabel = el("div", { className: "flyover-over", text: "Over the ocean" });
  const toast = el("div", { className: "flyover-toast", attrs: { "aria-hidden": "true" } });
  const skipButton = el("button", { className: "flyover-skip", text: options.skipLabel, attrs: { type: "button" } });
  const boostButton = el("button", { className: "flyover-boost", text: "Boost", attrs: { type: "button", "aria-label": "Hold to fly faster" } });

  const stage = el("div", {
    className: "flyover-stage",
    children: [
      canvas,
      el("div", { className: "flyover-hud-top", children: [clock, targetCard, options.hudRight] }),
      toast,
      el("div", { className: "flyover-hud-bottom", children: [el("div", { className: "flyover-hud-left", children: [skipButton, boostButton] }), overLabel, minimap] }),
      options.overlay,
    ],
  });
  targetFlag.hidden = true;

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
    for (const track of ghosts.values()) {
      minimapCtx.fillStyle = track.ghost.colour;
      minimapCtx.beginPath();
      minimapCtx.arc(track.shown.x * sx, track.shown.y * sy, 3.5, 0, Math.PI * 2);
      minimapCtx.fill();
    }
    minimapCtx.fillStyle = palette.plane;
    minimapCtx.beginPath();
    minimapCtx.arc(plane.x * sx, plane.y * sy, 5, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  function drawPlaneShape(heading: number, size: number, fill: string, shadow: boolean): void {
    if (!ctx || !planeShape) return;
    const scale = size / 24;
    if (shadow) {
      // Shadow on the ground, offset down-right.
      ctx.save();
      ctx.translate(size * 0.2, size * 0.3);
      ctx.rotate(heading + Math.PI / 4);
      ctx.scale(scale * 0.9, scale * 0.9);
      ctx.translate(-12, -12);
      ctx.fillStyle = "rgba(0, 0, 0, .18)";
      ctx.fill(planeShape);
      ctx.restore();
    }
    ctx.save();
    ctx.rotate(heading + Math.PI / 4);
    ctx.scale(scale, scale);
    ctx.translate(-12, -12);
    ctx.fillStyle = fill;
    ctx.strokeStyle = palette.planeEdge;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    ctx.stroke(planeShape);
    ctx.fill(planeShape);
    ctx.restore();
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

    planeShape ??= typeof Path2D !== "undefined" ? new Path2D(PLANE_PATH) : null;

    // Other racers, under your own plane, labelled with their names.
    for (const track of ghosts.values()) {
      const sx = wrappedDeltaX(plane.x, track.shown.x) * scale;
      const sy = (track.shown.y - plane.y) * scale;
      if (Math.abs(sx) > centreX + GHOST_SIZE || Math.abs(sy) > centreY + GHOST_SIZE) continue;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.globalAlpha = 0.78;
      drawPlaneShape(track.shown.heading, GHOST_SIZE, track.ghost.colour, false);
      ctx.globalAlpha = 1;
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineWidth = 3;
      ctx.strokeStyle = palette.planeEdge;
      ctx.strokeText(track.ghost.name, 0, GHOST_SIZE * 0.6);
      ctx.fillStyle = track.ghost.colour;
      ctx.fillText(track.ghost.name, 0, GHOST_SIZE * 0.6);
      ctx.restore();
    }

    const clockNow = now();
    if (flying && target && (clockNow - targetSince) / 1000 >= FLYOVER_HINT_AFTER_SECONDS) {
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

    // Holding pattern after a race skip: a dashed ring that empties as the hold runs out.
    if (flying && clockNow < holdEndsAt) {
      ctx.save();
      ctx.strokeStyle = palette.hint;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, PLANE_SIZE * 0.95, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, (holdEndsAt - clockNow) / 5000));
      ctx.stroke();
      ctx.restore();
    }

    drawPlaneShape(plane.heading, PLANE_SIZE, palette.plane, true);
    drawMinimap();
  }

  // --- Flight ------------------------------------------------------------------------------
  function setTarget(next: FlyoverCountry | null, emptyText = "Every country visited!"): void {
    // Polls and race syncs usually repeat the same target. Leave its flag, animation and hint
    // clock alone until the country actually changes.
    if (next ? next.code === target?.code : !target && targetName.textContent === emptyText) return;
    target = next;
    targetSince = now();
    if (!next) {
      targetName.textContent = emptyText;
      targetFlag.hidden = true;
      return;
    }
    targetName.textContent = next.name;
    targetFlag.hidden = false;
    targetFlag.setAttribute("src", flyoverFlagSrc(next.code));
    targetCard.classList.remove("is-new");
    void targetCard.offsetWidth;
    targetCard.classList.add("is-new");
  }

  function showToast(text: string): void {
    toast.textContent = text;
    toast.classList.remove("is-shown");
    void toast.offsetWidth;
    toast.classList.add("is-shown");
  }

  function updateClock(clockNow: number): void {
    const left = (runEndsAt - clockNow) / 1000;
    const text = formatFlyoverClock(left);
    if (clockValue.textContent !== text) clockValue.textContent = text;
    if (clock.classList.contains("is-low") !== (left <= 10)) clock.classList.toggle("is-low", left <= 10);
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

  function moveGhosts(clockNow: number, dt: number): void {
    const ease = 1 - Math.exp(-dt * 10);
    for (const track of ghosts.values()) {
      const ahead = Math.min(GHOST_PREDICT_SECONDS, Math.max(0, (clockNow - track.receivedAt) / 1000));
      const { ghost, shown } = track;
      const predictedX = ghost.x + Math.cos(ghost.heading) * FLYOVER_SPEED * ahead;
      const predictedY = ghost.y + Math.sin(ghost.heading) * FLYOVER_SPEED * ahead;
      shown.x = wrapX(shown.x + wrappedDeltaX(shown.x, predictedX) * ease);
      shown.y += (predictedY - shown.y) * ease;
      shown.heading += angleDiff(shown.heading, ghost.heading) * ease;
    }
  }

  function tick(): void {
    frameHandle = null;
    const clockNow = now();
    const frameNow = animationNow();
    const dt = Math.min(0.05, Math.max(0, (frameNow - lastFrameAt) / 1000));
    lastFrameAt = frameNow;
    if (flying) {
      const input = currentInput();
      options.onInput?.(input);
      plane = stepPlane(plane, input, dt);
      trail.push({ x: plane.x, y: plane.y });
      if (trail.length > TRAIL_LENGTH) trail = trail.slice(-TRAIL_LENGTH);
      moveGhosts(clockNow, dt);
      options.onMove?.(plane);
      const reached = target;
      if (!options.authoritative && flying && reached && clockNow >= holdEndsAt && planeTouchesCountry(reached, plane.x, plane.y)) {
        target = null;
        flashUntil = clockNow + 600;
        options.onReach(reached, (clockNow - targetSince) / 1000);
      }
      overCheckCountdown -= 1;
      if (overCheckCountdown <= 0) {
        overCheckCountdown = 5;
        const under = countryUnderPoint(countries, plane.x, plane.y);
        if (under?.code !== over?.code) {
          over = under;
          overLabel.textContent = under ? `Over ${under.name}` : "Over the ocean";
        }
      }
      if (flying) {
        updateClock(clockNow);
        if (clockNow >= runEndsAt) options.onTimeUp();
      }
    }
    draw();
    if (flying) scheduleFrame();
  }

  function scheduleFrame(): void {
    if (frameHandle === null && !signal.aborted) frameHandle = requestFrame(tick);
  }

  function fly(endsAt: number): void {
    runEndsAt = endsAt;
    const clockNow = now();
    updateClock(clockNow);
    if (flying) return;
    flying = true;
    lastFrameAt = animationNow();
    stage.classList.add("is-flying");
    scheduleFrame();
  }

  function releaseControls(): void {
    heldKeys.clear();
    pointerSteer = null;
    boostHeld = false;
  }

  function land(): void {
    flying = false;
    if (frameHandle !== null) cancelFrame(frameHandle);
    frameHandle = null;
    releaseControls();
    stage.classList.remove("is-flying");
  }

  function reset(next: PlaneState, flightSeconds = options.flightSeconds): void {
    land();
    plane = next;
    target = null;
    over = null;
    trail = [];
    holdEndsAt = 0;
    flashUntil = 0;
    visitedCodes.clear();
    ghosts.clear();
    targetName.textContent = "…";
    targetFlag.hidden = true;
    overLabel.textContent = "Over the ocean";
    clockValue.textContent = formatFlyoverClock(flightSeconds);
    clock.classList.remove("is-low");
    renderMinimapBase();
    resize();
  }

  function setGhosts(next: readonly FlyoverGhost[]): void {
    const clockNow = now();
    const seen = new Set<string>();
    for (const ghost of next) {
      seen.add(ghost.id);
      const track = ghosts.get(ghost.id);
      if (track) {
        track.ghost = ghost;
        track.receivedAt = clockNow;
      } else {
        ghosts.set(ghost.id, { ghost, receivedAt: clockNow, shown: { x: ghost.x, y: ghost.y, heading: ghost.heading } });
      }
    }
    for (const id of [...ghosts.keys()]) if (!seen.has(id)) ghosts.delete(id);
    if (!flying) draw();
  }

  // --- Input -------------------------------------------------------------------------------
  window.addEventListener("keydown", (event) => {
    if (!stage.isConnected || isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (modalDialogOpen()) return;
    const steering = TURN_KEYS_LEFT.has(event.key) || TURN_KEYS_RIGHT.has(event.key) || BOOST_KEYS.has(event.key);
    if (!flying && steering && options.onSteerWhileGrounded) {
      event.preventDefault();
      options.onSteerWhileGrounded();
    }
    if (!flying) return;
    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      options.onSkip();
      return;
    }
    if (steering) {
      event.preventDefault();
      heldKeys.add(event.key);
    }
  }, { signal });
  window.addEventListener("keyup", (event) => {
    if (typeof event.key !== "string") return;
    heldKeys.delete(event.key);
    // Shift changes the reported key of letters; clear the pair so nothing sticks.
    if (event.key.length === 1) {
      heldKeys.delete(event.key.toLowerCase());
      heldKeys.delete(event.key.toUpperCase());
    }
  }, { signal });
  window.addEventListener("blur", releaseControls, { signal });

  canvas.addEventListener("pointerdown", (event) => {
    if (!flying || (event.pointerType === "mouse" && event.button !== 0)) return;
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
  skipButton.addEventListener("click", () => {
    if (flying) options.onSkip();
  }, { signal });

  // --- Mount -------------------------------------------------------------------------------
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

  return {
    element: stage,
    plane: () => plane,
    setPlane: (next) => { plane = next; },
    target: () => target,
    isFlying: () => flying,
    fly,
    endsAt: () => runEndsAt,
    setEndsAt: (endsAt) => {
      runEndsAt = endsAt;
      updateClock(now());
    },
    land,
    reset,
    setTarget,
    markVisited: (code) => {
      visitedCodes.add(code);
      renderMinimapBase();
    },
    unmarkVisited: (code) => {
      if (visitedCodes.delete(code)) renderMinimapBase();
    },
    holdUntil: (until) => {
      holdEndsAt = until;
    },
    setGhosts,
    showToast,
    setSkipLabel: (text) => {
      skipButton.textContent = text;
    },
    mount: () => {
      palette = readPalette(stage);
      renderMinimapBase();
      resize();
    },
    destroy: () => {
      land();
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
    },
  };
}
