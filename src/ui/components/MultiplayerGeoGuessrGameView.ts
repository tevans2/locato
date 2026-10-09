import type { FinalResult, GeoGuessrRoundResult, PlayerId, PublicRoomState, PublicRoundState } from "../../core/multiplayer";
import type { LngLatPoint } from "../../core/maptap/distance";
import { rawCountries } from "../../core/countries";
import { getPlayerEmoji } from "../../core/auth/avatars";
import { el } from "../dom/createElement";
import { createGameBar, shellIcon, type ShellContext } from "../shell";
import { isSoundEnabled, setSoundEnabled, SOUND_CHANGE_EVENT } from "../dom/sfx";
import { createGeoGuessMap, type GeoMapStyle } from "./GeoGuessMap";
import { createGeoGuessrFeedback } from "./GeoGuessrFeedback";
import { createGeoRoundJourney } from "./GeoRoundJourney";
import { loadStreetImage } from "./loadStreetImage";
import "../../styles/geoguessr-multiplayer.css";

const PLAYER_COLORS = ["#287965", "#3f79ac", "#c47755", "#648447", "#a9637b", "#97803b", "#55959a", "#836f59"];
interface StreetViewPrompt { readonly asset?: string; readonly lat: number; readonly lng: number; readonly heading: number; readonly pitch: number; readonly fov: number; }
export interface GeoGuessrMultiplayerReveal { readonly countryName: string; readonly targetLat: number; readonly targetLng: number; readonly results: readonly GeoGuessrRoundResult[]; }
export interface MultiplayerGeoGuessrGameViewState {
  readonly room: PublicRoomState; readonly localPlayerId: PlayerId | null; readonly round: PublicRoundState | null;
  readonly reveal: GeoGuessrMultiplayerReveal | null; readonly finalResults: readonly FinalResult[] | null;
  readonly feedback: string; readonly canSubmit: boolean;
}
export interface MultiplayerGeoGuessrGameViewOptions {
  readonly signal: AbortSignal; readonly shell: ShellContext; readonly onLeave: () => void;
  readonly leaveGuard: () => string | null; readonly storage?: Storage;
  readonly onGuess: (lat: number, lng: number) => void; readonly onSkip: () => void;
}
export interface MultiplayerGeoGuessrGameView {
  readonly element: HTMLElement; readonly finalSlot: HTMLElement;
  readonly update: (state: MultiplayerGeoGuessrGameViewState) => void; readonly destroy: () => void;
}
function parsePrompt(value: string): StreetViewPrompt | null {
  try {
    const parsed = JSON.parse(value) as Partial<StreetViewPrompt>;
    if (typeof parsed.asset === "string" && /^\/api\/game-assets\/[a-f0-9]{48}$/.test(parsed.asset)) return parsed as StreetViewPrompt;
    if (![parsed.lat, parsed.lng, parsed.heading, parsed.pitch, parsed.fov].every(item => typeof item === "number" && Number.isFinite(item))) return null;
    return parsed as StreetViewPrompt;
  } catch { return null; }
}
function streetViewUrl(prompt: StreetViewPrompt): string | null {
  const key = import.meta.env.VITE_GOOGLE_MAPS_EMBED_API_KEY?.trim();
  if (!key) return null;
  return `https://www.google.com/maps/embed/v1/streetview?${new URLSearchParams({ key, location: `${prompt.lat},${prompt.lng}`, heading: String(prompt.heading), pitch: String(prompt.pitch), fov: String(prompt.fov), radius: "1000", source: "outdoor" })}`;
}
function distance(km: number | null): string {
  if (km === null) return "No guess";
  return km < 1 ? `${Math.max(1, Math.round(km * 1000))} m` : `${Math.round(km).toLocaleString()} km`;
}

function controlIcon(symbol: Parameters<typeof shellIcon>[0] | "plus" | "minus"): SVGSVGElement {
  if (symbol !== "plus" && symbol !== "minus") return shellIcon(symbol, 18);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", symbol === "plus" ? "M12 5v14M5 12h14" : "M5 12h14"); svg.append(path);
  return svg;
}

/** The solo play surface, with private room imagery and server-controlled rounds. */
export function createMultiplayerGeoGuessrGameView(options: MultiplayerGeoGuessrGameViewOptions): MultiplayerGeoGuessrGameView {
  const { signal } = options;
  const feedback = createGeoGuessrFeedback(signal, options.storage ?? options.shell.storage ?? null);
  let state: MultiplayerGeoGuessrGameViewState | null = null;
  let pendingGuess: LngLatPoint | null = null;
  let hasGuessed = false;
  let roundKey = "";
  let revealKey = "";
  let asset = "";
  let turn = 0;
  let imageZoom = 1;
  let imageReady = false;
  let imageError = false;
  let imageRequest: AbortController | null = null;
  let timerId = 0;
  let stopped = false;
  let countdownTick: number | null = null;
  let pinned = false;
  let style: GeoMapStyle = "roadmap";
  try { const saved = options.storage?.getItem("locato:geoguessr:map-style"); if (saved === "terrain" || saved === "hybrid") style = saved; } catch { /* Optional preference. */ }
  const narrow = window.matchMedia("(max-width: 760px)");
  const hover = window.matchMedia("(hover: hover) and (pointer: fine)");
  const button = (label: string, symbol: Parameters<typeof shellIcon>[0] | "plus" | "minus", className: string, click: () => void) => el("button", {
    className: `geo-button ${className}`, attrs: { type: "button", title: label, "aria-label": label }, children: [controlIcon(symbol)], on: { click },
  });
  const image = el("img", { className: "private-street-image", attrs: { alt: "Explore the multiplayer mystery location", hidden: "" } });
  const frame = el("iframe", { className: "geo-mp-embed", attrs: { title: "Explore the multiplayer mystery location", referrerpolicy: "no-referrer-when-downgrade", allowfullscreen: "true", hidden: "" } });
  const panorama = el("div", { className: "geo-panorama private-street-view", children: [image, frame] });
  let journeyRounds = 5;
  let journey = createGeoRoundJourney(journeyRounds);
  const loadingTitle = el("h1", { text: "Get ready to explore." });
  const loadingText = el("p", { text: "Same place. A new perspective." });
  const retry = el("button", { className: "geo-button geo-primary", text: "Try again", attrs: { type: "button", hidden: "" }, on: { click: () => void prepareImage() } });
  const loader = el("section", { className: "geo-loading-panel", attrs: { role: "status" }, children: [journey.element, loadingTitle, loadingText, retry] });
  const resultList = el("ul", { className: "geo-mp-round-results" });
  const resultTitle = el("h2", { attrs: { tabindex: "-1" } });
  const resultClock = el("span", { className: "geo-label" });
  const resultPanel = el("section", { className: "geo-result-card geo-mp-result", attrs: { hidden: "", "aria-label": "Round results" }, children: [el("div", { className: "geo-mp-result-heading", children: [resultTitle, resultClock] }), resultList] });
  const finalSlot = el("section", { className: "geo-result-card geo-mp-final", attrs: { hidden: "", "aria-label": "Game results" } });
  const legend = el("div", { className: "geo-map-legend", children: [el("span", { className: "geo-legend-guess", text: "Your pin" }), el("span", { className: "geo-legend-target", text: "Actual location" })] });
  const submit = el("button", { className: "geo-button geo-lock", text: "Place your pin", attrs: { type: "button", disabled: "" } });
  const skip = el("button", { className: "geo-button geo-mp-skip", attrs: { type: "button", hidden: "" }, on: { click: () => { if (canGuess()) options.onSkip(); } } });
  const map = createGeoGuessMap({ signal, nativeControls: false,
    revealPadding: () => element.dataset.phase === "complete"
      ? { top: 105, right: 90, bottom: narrow.matches ? Math.round(window.innerHeight * .56) + 35 : 85, left: narrow.matches ? 70 : 460 }
      : { top: narrow.matches ? 200 : 120, right: narrow.matches ? 65 : 290, bottom: (resultPanel.offsetHeight || 190) + 75, left: 80 },
    onGuessChange(point) {
      if (!canGuess()) return;
      pendingGuess = point; submit.textContent = "Guess"; submit.disabled = false;
      returnPin.disabled = false; feedback.play("pin");
    },
  });
  map.setStyle?.(style);
  const expand = button("Expand guess map", "maximize", "geo-expand-map", () => setMapSize("expanded"));
  const pin = button("Keep map expanded", "map-pin", "geo-pin-map", () => { pinned = !pinned; pin.setAttribute("aria-pressed", String(pinned)); setMapSize(pinned ? "expanded" : "compact"); });
  pin.setAttribute("aria-pressed", "false");
  const collapse = button("Hide guess map", "x", "geo-collapse-map", () => setMapSize("collapsed"));
  const mapHeader = el("div", { className: "geo-map-header", children: [expand, pin, collapse] });
  const layerButtons = ([['roadmap', 'Standard'], ['terrain', 'Terrain'], ['hybrid', 'Satellite']] as const).map(([value, label]) => el("button", {
    className: "geo-button geo-map-style", text: label, attrs: { type: "button", "data-style": value, "aria-pressed": String(style === value) },
    on: { click: () => { style = value; map.setStyle?.(style); layerButtons.forEach(item => item.setAttribute("aria-pressed", String(item.dataset.style === value))); try { options.storage?.setItem("locato:geoguessr:map-style", value); } catch { /* Optional preference. */ } } },
  }));
  const mapToolbar = el("div", { className: "geo-map-toolbar", children: [el("div", { className: "geo-map-styles", attrs: { role: "group", "aria-label": "Map style" }, children: layerButtons })] });
  const returnPin = button("Return to your pin", "map-pin", "geo-return-pin", () => map.showGuess?.());
  returnPin.disabled = true;
  const mapTools = el("div", { className: "geo-map-tools", attrs: { role: "group", "aria-label": "Map controls" }, children: [
    button("Zoom in", "plus", "geo-zoom-in", () => map.zoomBy?.(1)), button("Zoom out", "minus", "geo-zoom-out", () => map.zoomBy?.(-1)),
    button("Show world map", "globe", "geo-world", () => map.showWorld?.()), returnPin,
  ] });
  const dock = el("aside", { className: "geo-map-panel", attrs: { "aria-label": "Guess map" }, children: [mapHeader, mapToolbar, el("div", { className: "geo-map-viewport", children: [map.element, mapTools] }), submit] });
  const openMap = button("Open guess map", "globe", "geo-open-map", () => setMapSize("expanded"));
  openMap.append(el("span", { text: "Place your guess" }));
  const sound = button("Sound effects", "volume-2", "geo-sound", () => setSoundEnabled(!isSoundEnabled()));
  const syncSound = () => { sound.setAttribute("aria-pressed", String(isSoundEnabled())); sound.replaceChildren(shellIcon(isSoundEnabled() ? "volume-2" : "volume-x", 18)); };
  window.addEventListener(SOUND_CHANGE_EVENT, syncSound, { signal }); syncSound();
  const lookLeft = button("Look left", "arrow-left", "geo-reset", () => look(270));
  const lookRight = button("Look right", "arrow-right", "geo-reset", () => look(90));
  const streetZoom = (delta: number) => { imageZoom = Math.max(1, Math.min(2.5, imageZoom + delta)); image.style.transform = `scale(${imageZoom})`; };
  const bottomTools = el("div", { className: "geo-bottom-tools", children: [el("div", { className: "geo-explore-actions", children: [
    button("Zoom in Street View", "plus", "geo-street-zoom", () => streetZoom(.25)), button("Zoom out Street View", "minus", "geo-street-zoom", () => streetZoom(-.25)),
    lookLeft, lookRight, button("Return to starting point", "rotate-ccw", "geo-reset", () => { turn = 0; streetZoom(-3); if (asset) void prepareImage(); }), sound,
  ] })] });
  const steps = el("ol", { className: "geo-round-steps", attrs: { "aria-label": "Your round scores" } });
  const total = el("strong", { className: "geo-total-score", text: "0" });
  const sessionHud = el("div", { className: "geo-session", children: [el("div", { className: "geo-round", children: [el("span", { className: "geo-label", text: "Round" })] }), steps, el("div", { className: "geo-score", children: [total, el("span", { className: "geo-label", text: "Total" })] })] });
  const scoreList = el("ol", { className: "geo-mp-standings" });
  const standings = el("aside", { className: "geo-mp-scoreboard", attrs: { "aria-label": "Live standings" }, children: [el("span", { className: "geo-label", text: "Live standings" }), scoreList] });
  const clock = el("div", { className: "geo-compass geo-mp-clock", attrs: { role: "timer", "aria-label": "Round time remaining" } });
  const status = el("p", { className: "geo-mp-status", attrs: { role: "status", hidden: "" } });
  const bar = createGameBar(options.shell, { gameMode: "geoguessr", run: "practice", onBack: options.onLeave, backLabel: "Leave room", leaveGuard: options.leaveGuard });
  bar.element.classList.add("geo-gamebar");
  const topbar = el("div", { className: "geo-topbar", children: [bar.element, sessionHud] });
  const element = el("div", { className: "geoguessr-screen geo-multiplayer-view", attrs: { "data-phase": "loading", "data-map-size": narrow.matches ? "collapsed" : "compact" }, children: [panorama, el("div", { className: "geo-vignette" }), loader, topbar, clock, standings, bottomTools, dock, openMap, skip, status, resultPanel, finalSlot, legend] });
  const roundScores = new Map<number, number>();
  const resultResize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
    const height = resultPanel.offsetHeight;
    if (height > 0) element.style.setProperty("--geo-result-height", `${height}px`);
    if (!stopped && element.dataset.phase === "result") map.showResult?.();
  });
  resultResize?.observe(resultPanel);

  function canGuess(): boolean {
    const round = state?.round ?? state?.room.round;
    return Boolean(!stopped && round && state?.canSubmit && state.room.status === "playing" && !state.reveal && !hasGuessed && imageReady && !imageError && Date.now() >= round.startedAt && (round.endsAt === null || Date.now() < round.endsAt));
  }
  function setMapSize(size: string): void { element.dataset.mapSize = size; requestAnimationFrame(() => { if (!stopped) map.resize(); }); }
  dock.addEventListener("pointerenter", () => { if (hover.matches && !pinned && state?.room.status === "playing") setMapSize("expanded"); }, { signal });
  dock.addEventListener("pointerleave", () => { if (hover.matches && !pinned && state?.room.status === "playing") setMapSize("compact"); }, { signal });
  dock.addEventListener("focusin", () => { if (state?.room.status === "playing") setMapSize("expanded"); }, { signal });
  document.addEventListener("keydown", event => {
    if (element.hidden || element.closest("[hidden]") || (event.target instanceof Element && event.target.closest("button,input,textarea,select,[contenteditable='true']"))) return;
    if (event.key === "Enter" && canGuess() && pendingGuess) { event.preventDefault(); submit.click(); }
    if (event.key.toLowerCase() === "m" && element.dataset.phase === "playing") { event.preventDefault(); setMapSize(element.dataset.mapSize === "collapsed" ? "expanded" : "collapsed"); }
  }, { signal });
  submit.addEventListener("click", () => {
    if (!canGuess() || !pendingGuess) return;
    hasGuessed = true; map.setAcceptingGuesses(false); feedback.play("submit");
    options.onGuess(pendingGuess.lat, pendingGuess.lng); renderPresentation();
  }, { signal });
  function look(delta: number): void { if (!canGuess() || !asset) return; turn = (turn + delta) % 360; void prepareImage(); }
  async function prepareImage(): Promise<void> {
    imageRequest?.abort(); const request = new AbortController(); imageRequest = request;
    imageReady = false; imageError = false; renderPresentation();
    const prompt = state?.round ?? state?.room.round;
    const parsed = prompt?.prompt.kind === "geoguessr-streetview" ? parsePrompt(prompt.prompt.value) : null;
    try {
      if (parsed?.asset) {
        asset = parsed.asset; frame.hidden = true; image.hidden = false;
        await loadStreetImage(image, `${asset}?turn=${turn}`, request.signal);
      } else if (parsed) {
        const url = streetViewUrl(parsed); if (!url) throw new Error("Street View unavailable.");
        image.hidden = true; frame.hidden = false; asset = "";
        await new Promise<void>((resolve, reject) => {
          const done = () => { cleanup(); resolve(); };
          const cancel = () => { cleanup(); reject(new Error("Cancelled")); };
          const fail = () => { cleanup(); reject(new Error("Street View unavailable.")); };
          const timer = setTimeout(fail, 20_000);
          const cleanup = () => { clearTimeout(timer); frame.removeEventListener("load", done); request.signal.removeEventListener("abort", cancel); };
          frame.addEventListener("load", done, { once: true }); request.signal.addEventListener("abort", cancel, { once: true }); frame.src = url;
        });
      } else throw new Error("Street View unavailable.");
      if (stopped || request.signal.aborted || imageRequest !== request) return;
      imageReady = true;
    } catch { if (!stopped && !request.signal.aborted && imageRequest === request) imageError = true; }
    if (!stopped && imageRequest === request) renderPresentation();
  }
  function renderPresentation(): void {
    if (!state || stopped) return;
    const { room, localPlayerId, reveal, canSubmit, finalResults } = state;
    const round = state.round ?? room.round;
    const remaining = round ? Math.max(0, Math.ceil((round.startedAt - Date.now()) / 1000)) : 0;
    const complete = Boolean(finalResults);
    const phase = complete ? "complete" : reveal ? "result" : imageError ? "error" : !imageReady || remaining > 0 ? "loading" : "playing";
    if (element.dataset.phase !== phase) {
      const previous = element.dataset.phase; element.dataset.phase = phase;
      element.dataset.reducedMotion = String(feedback.reducedMotion());
      if (phase === "playing" && previous === "loading") feedback.play("go");
      requestAnimationFrame(() => { if (!stopped) { map.resize(); if (phase === "result" || phase === "complete") map.showResult?.(); } });
    }
    loader.hidden = phase !== "loading" && phase !== "error";
    loader.classList.toggle("is-countdown", remaining > 0);
    if (phase === "loading" && remaining > 0) {
      if (countdownTick !== remaining) { journey.setCountdown(remaining); feedback.play("countdown", remaining); countdownTick = remaining; }
    } else if (journey.element.classList.contains("is-counting")) journey.setCountdown(null);
    loadingTitle.textContent = imageError ? "This view couldn’t load." : "Get ready to explore.";
    loadingText.textContent = imageError ? "Try the view again. The room stays connected." : "Look for clues. Trust your instinct.";
    retry.hidden = !imageError;
    submit.disabled = !canGuess() || pendingGuess === null;
    submit.textContent = hasGuessed ? "Guess locked" : pendingGuess ? "Guess" : "Place your pin";
    map.setAcceptingGuesses(canGuess());
    mapHeader.hidden = mapToolbar.hidden = phase === "result" || complete;
    mapTools.hidden = complete;
    resultPanel.hidden = phase !== "result"; finalSlot.hidden = !complete;
    sessionHud.hidden = standings.hidden = complete;
    clock.hidden = phase !== "playing";
    bottomTools.hidden = phase !== "playing" || !asset;
    panorama.inert = phase !== "playing";
    dock.inert = phase === "loading" || phase === "error";
    const voted = localPlayerId !== null && room.skipVotes.includes(localPlayerId);
    skip.hidden = !canSubmit || room.skipRequired === 0 || phase !== "playing";
    skip.disabled = voted || !canGuess();
    skip.textContent = `Skip ${room.skipVotes.length}/${room.skipRequired}`;
    status.hidden = phase !== "playing" || (!hasGuessed && canSubmit);
    status.textContent = hasGuessed ? "Guess locked · Waiting for the other players" : state.feedback || "Watching this round";
    if (room.phaseEndsAt !== null) {
      const seconds = Math.max(0, Math.ceil((room.phaseEndsAt - Date.now()) / 1000));
      clock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      resultClock.textContent = `Next round in ${seconds}s`;
    } else { clock.textContent = "Explore"; resultClock.textContent = "Waiting for the next round"; }
  }
  function stop(): void {
    if (stopped) return; stopped = true; imageRequest?.abort(); resultResize?.disconnect(); window.clearInterval(timerId); feedback.reset(); map.destroy(); bar.destroy(); image.removeAttribute("src"); frame.removeAttribute("src");
  }
  signal.addEventListener("abort", stop, { once: true });
  timerId = window.setInterval(() => { if (!stopped && state && !element.hidden && !element.closest("[hidden]")) renderPresentation(); }, 200);
  return { element, finalSlot, destroy: stop, update(next) {
    state = next;
    const { room, localPlayerId, reveal, finalResults } = next;
    const round = next.round ?? room.round;
    if (journeyRounds !== room.settings.roundLimit) {
      journeyRounds = room.settings.roundLimit;
      const previous = journey; journey = createGeoRoundJourney(journeyRounds); previous.element.replaceWith(journey.element);
    }
    const nextKey = round ? `${room.roomCode}:${round.roundNumber}:${round.startedAt}` : roundKey;
    if (nextKey !== roundKey) {
      if (round?.roundNumber === 1) roundScores.clear();
      roundKey = nextKey; revealKey = ""; pendingGuess = null; hasGuessed = false; turn = 0; imageZoom = 1; image.style.transform = ""; countdownTick = null;
      feedback.reset(); map.reset(); map.setStyle?.(style); returnPin.disabled = true;
      journey.setRound((round?.roundNumber ?? 1) - 1); setMapSize(pinned ? "expanded" : narrow.matches ? "collapsed" : "compact");
      void prepareImage();
    }
    const colors = new Map(room.players.map((player, i) => [player.id, PLAYER_COLORS[i % PLAYER_COLORS.length]!]));
    element.style.setProperty("--geo-player", colors.get(localPlayerId ?? "") ?? PLAYER_COLORS[0]!);
    if (reveal && `${roundKey}:${reveal.targetLat}:${reveal.targetLng}` !== revealKey) {
      revealKey = `${roundKey}:${reveal.targetLat}:${reveal.targetLng}`;
      const mine = reveal.results.find(result => result.playerId === localPlayerId);
      roundScores.set(round?.roundNumber ?? 1, mine?.score ?? 0);
      map.reveal({ lat: reveal.targetLat, lng: reveal.targetLng }, reveal.results.filter(result => result.guess).map(result => ({ ...result.guess!, label: result.playerId === localPlayerId ? "Your pin" : result.name, color: colors.get(result.playerId) ?? "#287965" })));
      const country = rawCountries.find(country => country.name === reveal.countryName);
      if (country) map.highlightCountry?.(country.code);
      setMapSize("expanded"); resultTitle.textContent = reveal.countryName;
      resultList.replaceChildren(...reveal.results.map(result => el("li", { className: result.playerId === localPlayerId ? "is-local" : "", children: [
        el("span", { className: "geo-mp-player-dot", attrs: { style: `--player-color:${colors.get(result.playerId)}` } }),
        el("strong", { text: result.playerId === localPlayerId ? `${result.name} · You` : result.name }), el("span", { text: distance(result.distanceKm) }), el("strong", { text: `+${result.score.toLocaleString()}` }),
      ] })));
      feedback.play("score", mine?.score ?? 0); requestAnimationFrame(() => { if (!stopped) resultTitle.focus(); });
    }
    if (finalResults) map.setStyle?.("roadmap");
    total.textContent = (room.players.find(player => player.id === localPlayerId)?.score ?? 0).toLocaleString();
    steps.replaceChildren(...Array.from({ length: room.settings.roundLimit }, (_, i) => el("li", { className: roundScores.has(i + 1) ? "is-done" : i + 1 === round?.roundNumber ? "is-current" : "", children: [el("span", { className: "geo-step-pin", text: String(i + 1) }), el("span", { className: "geo-step-score", text: roundScores.get(i + 1)?.toLocaleString() ?? "" })] })));
    scoreList.replaceChildren(...[...room.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).map((player, i) => el("li", { className: player.id === localPlayerId ? "is-local" : "", children: [
      el("span", { className: "geo-mp-rank", text: String(i + 1) }), el("span", { text: getPlayerEmoji(player, player.id === localPlayerId), attrs: { "aria-hidden": "true" } }), el("strong", { text: player.name }), el("strong", { text: player.score.toLocaleString() }),
    ] })));
    renderPresentation();
  } };
}
