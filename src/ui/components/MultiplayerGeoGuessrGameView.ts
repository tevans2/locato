import type { FinalResult, GeoGuessrRoundResult, PlayerId, PublicRoomState, PublicRoundState } from "../../core/multiplayer";
import type { LngLatPoint } from "../../core/maptap/distance";
import { getPlayerEmoji } from "../../core/auth/avatars";
import { el } from "../dom/createElement";
import { createGeoGuessMap } from "./GeoGuessMap";

const PLAYER_COLORS = ["#38bdf8", "#fb923c", "#a78bfa", "#34d399", "#f472b6", "#fbbf24", "#60a5fa", "#f87171"];

interface StreetViewPrompt {
  readonly lat: number;
  readonly lng: number;
  readonly heading: number;
  readonly pitch: number;
  readonly fov: number;
}

export interface GeoGuessrMultiplayerReveal {
  readonly countryName: string;
  readonly targetLat: number;
  readonly targetLng: number;
  readonly results: readonly GeoGuessrRoundResult[];
}

export interface MultiplayerGeoGuessrGameViewState {
  readonly room: PublicRoomState;
  readonly localPlayerId: PlayerId | null;
  readonly round: PublicRoundState | null;
  readonly reveal: GeoGuessrMultiplayerReveal | null;
  readonly finalResults: readonly FinalResult[] | null;
  readonly feedback: string;
  readonly canSubmit: boolean;
}

export interface MultiplayerGeoGuessrGameViewOptions {
  readonly signal: AbortSignal;
  readonly onGuess: (lat: number, lng: number) => void;
  readonly onSkip: () => void;
}

export interface MultiplayerGeoGuessrGameView {
  readonly element: HTMLElement;
  readonly update: (state: MultiplayerGeoGuessrGameViewState) => void;
  readonly destroy: () => void;
}

function googleMapsEmbedApiKey(): string {
  const env = (import.meta as ImportMeta & { readonly env?: { readonly VITE_GOOGLE_MAPS_EMBED_API_KEY?: string } }).env;
  return env?.VITE_GOOGLE_MAPS_EMBED_API_KEY?.trim() ?? "";
}

function parsePrompt(value: string): StreetViewPrompt | null {
  try {
    const parsed = JSON.parse(value) as Partial<StreetViewPrompt>;
    if (![parsed.lat, parsed.lng, parsed.heading, parsed.pitch, parsed.fov].every((item) => typeof item === "number" && Number.isFinite(item))) return null;
    return parsed as StreetViewPrompt;
  } catch {
    return null;
  }
}

function streetViewUrl(apiKey: string, prompt: StreetViewPrompt): string {
  const params = new URLSearchParams({
    key: apiKey,
    location: `${prompt.lat},${prompt.lng}`,
    heading: String(prompt.heading),
    pitch: String(prompt.pitch),
    fov: String(prompt.fov),
    radius: "1000",
    source: "outdoor",
  });
  return `https://www.google.com/maps/embed/v1/streetview?${params.toString()}`;
}

function formatDistance(distanceKm: number | null): string {
  if (distanceKm === null) return "—";
  if (distanceKm < 1) return `${Math.max(1, Math.round(distanceKm * 1000)).toLocaleString()} m`;
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm).toLocaleString()} km`;
}

export function createMultiplayerGeoGuessrGameView(options: MultiplayerGeoGuessrGameViewOptions): MultiplayerGeoGuessrGameView {
  const apiKey = googleMapsEmbedApiKey();
  let pendingGuess: LngLatPoint | null = null;
  let hasGuessed = false;
  let renderedRoundKey: string | null = null;
  let renderedRevealKey: string | null = null;
  let phaseStartedAt: number | null = null;
  let phaseEndsAt: number | null = null;
  let rafId: number | null = null;

  const streetViewFrame = el("iframe", {
    className: "geoguessr-streetview-frame",
    attrs: { title: "Multiplayer mystery Street View", loading: "eager", referrerpolicy: "no-referrer-when-downgrade", allowfullscreen: "true" },
  });
  const missingKey = el("div", { className: "streetview-missing-key geoguessr-missing-key", children: [el("strong", { text: "Google Maps Embed API key missing" }), el("p", { text: "Set VITE_GOOGLE_MAPS_EMBED_API_KEY to play this room." })] });
  const statusText = el("span", { className: "geoguessr-mp-status", text: "Waiting for the round..." });
  const pinStatus = el("span", { className: "geoguessr-pin-status", text: "Place a pin on the map" });
  const submitButton = el("button", { className: "primary-action geoguessr-submit", text: "Make guess", attrs: { type: "button" } });
  const skipButton = el("button", { className: "ghost-action multiplayer-skip-btn", text: "Skip", attrs: { type: "button" } });
  const resultList = el("ul", { className: "result-list maptap-mp-result-list" });
  const scoreList = el("ol", { className: "score-list geoguessr-mp-score-list" });
  const timerFill = el("div", { className: "multiplayer-timer-fill" });
  const timerBar = el("div", { className: "multiplayer-timer geoguessr-mp-timer", attrs: { role: "presentation" }, children: [timerFill] });
  const roundLabel = el("strong", { text: "Round 1" });

  const map = createGeoGuessMap({
    signal: options.signal,
    onGuessChange: (point) => {
      if (hasGuessed) return;
      pendingGuess = point;
      pinStatus.textContent = `${Math.abs(point.lat).toFixed(2)}° ${point.lat >= 0 ? "N" : "S"}, ${Math.abs(point.lng).toFixed(2)}° ${point.lng >= 0 ? "E" : "W"}`;
      submitButton.disabled = false;
    },
  });
  const mapPanel = el("aside", {
    className: "geoguessr-map-dock geoguessr-mp-map-dock is-open",
    children: [
      el("div", { className: "geoguessr-map-header", children: [el("div", { children: [el("span", { className: "eyebrow", text: "YOUR GUESS" }), pinStatus] }), roundLabel] }),
      map.element,
      el("div", { className: "geoguessr-map-actions geoguessr-mp-map-actions", children: [submitButton, skipButton] }),
      resultList,
    ],
  });
  const scoreboard = el("aside", {
    className: "geoguessr-mp-scoreboard",
    children: [el("span", { className: "eyebrow", text: "LIVE STANDINGS" }), scoreList],
  });
  const element = el("div", {
    className: "multiplayer-geoguessr-layout",
    children: [
      el("div", { className: "geoguessr-stage multiplayer-geoguessr-stage", children: [streetViewFrame, missingKey, timerBar, statusText, scoreboard, mapPanel] }),
    ],
  });

  submitButton.addEventListener("click", () => {
    if (!pendingGuess || hasGuessed) return;
    hasGuessed = true;
    submitButton.disabled = true;
    map.setAcceptingGuesses(false);
    options.onGuess(pendingGuess.lat, pendingGuess.lng);
  }, { signal: options.signal });
  skipButton.addEventListener("click", options.onSkip, { signal: options.signal });

  function renderTimer(): void {
    if (phaseStartedAt === null || phaseEndsAt === null || phaseEndsAt <= phaseStartedAt) {
      timerBar.hidden = true;
      return;
    }
    timerBar.hidden = false;
    const fraction = Math.max(0, Math.min(1, (phaseEndsAt - Date.now()) / (phaseEndsAt - phaseStartedAt)));
    timerFill.style.transform = `scaleX(${fraction})`;
  }

  function ensureTimerLoop(): void {
    if (rafId !== null) return;
    const loop = (): void => { renderTimer(); rafId = requestAnimationFrame(loop); };
    rafId = requestAnimationFrame(loop);
  }

  function stopTimerLoop(): void {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    timerBar.hidden = true;
  }

  function playerColors(room: PublicRoomState): Map<PlayerId, string> {
    return new Map(room.players.map((player, index) => [player.id, PLAYER_COLORS[index % PLAYER_COLORS.length] ?? "#888"]));
  }

  function renderScoreboard(room: PublicRoomState, localPlayerId: PlayerId | null): void {
    scoreList.replaceChildren(...[...room.players].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name)).map((player, index) =>
      el("li", {
        className: player.id === localPlayerId ? "score-row is-local" : "score-row",
        children: [
          el("span", { className: "score-rank", text: `#${index + 1}` }),
          el("span", { className: "player-emoji score-emoji", text: getPlayerEmoji(player.id, player.id === localPlayerId), attrs: { "aria-hidden": "true" } }),
          el("span", { className: "score-name", text: player.name }),
          el("span", { className: "score-value", text: player.score.toLocaleString() }),
        ],
      }),
    ));
  }

  function renderRoundResults(room: PublicRoomState, reveal: GeoGuessrMultiplayerReveal, localPlayerId: PlayerId | null): void {
    const colors = playerColors(room);
    resultList.replaceChildren(...reveal.results.map((result) =>
      el("li", {
        className: result.playerId === localPlayerId ? "result-row maptap-mp-result-row is-local" : "result-row maptap-mp-result-row",
        children: [
          el("span", { className: "maptap-mp-result-dot", attrs: { style: `background:${colors.get(result.playerId) ?? "#888"}` } }),
          el("span", { className: "maptap-mp-result-name", text: result.name }),
          el("span", { className: "maptap-mp-result-dist", text: result.guess ? formatDistance(result.distanceKm) : "no guess" }),
          el("span", { className: "maptap-mp-result-score", text: `+${result.score.toLocaleString()}` }),
        ],
      }),
    ));
  }

  return {
    element,
    update(state) {
      const { room, localPlayerId, round, reveal, finalResults, feedback, canSubmit } = state;
      const visibleRound = round ?? room.round;
      const roundKey = visibleRound ? `${room.roomCode}:${visibleRound.roundNumber}:${visibleRound.startedAt}` : null;
      const revealKey = reveal ? `${room.roomCode}:${visibleRound?.roundNumber ?? 0}:${reveal.targetLat}:${reveal.targetLng}` : null;

      if (roundKey !== renderedRoundKey) {
        renderedRoundKey = roundKey;
        renderedRevealKey = null;
        pendingGuess = null;
        hasGuessed = false;
        pinStatus.textContent = "Place a pin on the map";
        resultList.replaceChildren();
        mapPanel.classList.remove("is-result");
        map.reset();
        const prompt = visibleRound?.prompt.kind === "geoguessr-streetview" ? parsePrompt(visibleRound.prompt.value) : null;
        if (apiKey && prompt) {
          streetViewFrame.hidden = false;
          missingKey.hidden = true;
          streetViewFrame.src = streetViewUrl(apiKey, prompt);
        } else {
          streetViewFrame.hidden = true;
          missingKey.hidden = Boolean(apiKey);
        }
      }

      roundLabel.textContent = visibleRound ? `Round ${visibleRound.roundNumber} / ${room.settings.roundLimit}` : "Game complete";
      submitButton.disabled = !canSubmit || hasGuessed || pendingGuess === null;
      map.setAcceptingGuesses(canSubmit && !hasGuessed && !reveal);
      statusText.textContent = hasGuessed && !reveal ? "Guess locked — waiting for the other players…" : reveal ? `${reveal.countryName} · ${feedback}` : feedback;
      const localSkipVoted = localPlayerId !== null && room.skipVotes.includes(localPlayerId);
      const skipRequired = Math.max(0, room.skipRequired);
      const skipCount = Math.min(room.skipVotes.length, skipRequired);
      skipButton.hidden = !canSubmit || skipRequired === 0 || reveal !== null;
      skipButton.disabled = !canSubmit || localSkipVoted;
      skipButton.textContent = localSkipVoted ? `Skip ${skipCount}/${skipRequired}` : `Skip ${skipCount}/${skipRequired}`;

      if (reveal && revealKey !== renderedRevealKey) {
        renderedRevealKey = revealKey;
        const colors = playerColors(room);
        map.reveal(
          { lat: reveal.targetLat, lng: reveal.targetLng },
          reveal.results.filter((result) => result.guess !== null).map((result) => ({ ...result.guess!, label: result.name, color: colors.get(result.playerId) ?? "#888" })),
        );
        mapPanel.classList.add("is-result");
        renderRoundResults(room, reveal, localPlayerId);
        requestAnimationFrame(map.resize);
      }

      if (finalResults) {
        resultList.replaceChildren(...finalResults.map((result) => el("li", { className: "result-row final", text: `#${result.rank} ${result.name} · ${result.score.toLocaleString()}` })));
      }
      renderScoreboard(room, localPlayerId);

      phaseStartedAt = room.phaseStartedAt;
      phaseEndsAt = room.phaseEndsAt;
      timerBar.classList.toggle("is-intermission", room.status === "round-result");
      if ((room.status === "playing" || room.status === "round-result") && phaseEndsAt !== null) {
        renderTimer();
        ensureTimerLoop();
      } else stopTimerLoop();
    },
    destroy: stopTimerLoop,
  };
}
