import type { FinalResult, MapTapRoundResult, PlayerId, PublicRoomState, PublicRoundState } from "../../core/multiplayer";
import { fetchWikipediaSummary } from "../../core/maptap/wikipedia";
import { getPlayerEmoji } from "../../core/auth/avatars";
import { el } from "../dom/createElement";
import { createMapTapGlobe } from "./MapTapGlobe";
import { createMapTapInfoOverlay } from "./MapTapInfoOverlay";

// Colour palette for player markers — one per player slot
const PLAYER_COLORS = ["#38bdf8", "#fb923c", "#a78bfa", "#34d399", "#f472b6", "#fbbf24", "#60a5fa", "#f87171"];

export interface MapTapMultiplayerReveal {
  readonly targetName: string;
  readonly targetLat: number;
  readonly targetLng: number;
  readonly wikiSlug: string;
  readonly results: readonly MapTapRoundResult[];
}

export interface MultiplayerMapTapGameViewState {
  readonly room: PublicRoomState;
  readonly localPlayerId: PlayerId | null;
  readonly round: PublicRoundState | null;
  readonly reveal: MapTapMultiplayerReveal | null;
  readonly finalResults: readonly FinalResult[] | null;
  readonly feedback: string;
  readonly canSubmit: boolean;
}

export interface MultiplayerMapTapGameViewOptions {
  readonly signal: AbortSignal;
  readonly onGuess: (lat: number, lng: number) => void;
  readonly onSkip: () => void;
}

export interface MultiplayerMapTapGameView {
  readonly element: HTMLElement;
  readonly update: (state: MultiplayerMapTapGameViewState) => void;
  readonly destroy: () => void;
}

function formatDistance(km: number | null): string {
  if (km === null) return "—";
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

function formatCategory(category: string): string {
  if (category === "poi") return "point of interest";
  return category;
}

function parsePromptValue(value: string): { name: string; category: string; difficulty: string } | null {
  try {
    return JSON.parse(value) as { name: string; category: string; difficulty: string };
  } catch {
    return null;
  }
}

export function createMultiplayerMapTapGameView(options: MultiplayerMapTapGameViewOptions): MultiplayerMapTapGameView {
  let hasGuessed = false;
  let renderedRevealKey: string | null = null;
  let renderedRoundKey: string | null = null;
  let phaseStartedAt: number | null = null;
  let phaseEndsAt: number | null = null;
  let rafId: number | null = null;
  let wikiAbortController: AbortController | null = null;

  const promptTarget = el("strong", { text: "" });
  const promptMeta = el("span", { className: "maptap-prompt-meta", text: "" });
  const statusText = el("p", { className: "maptap-status", attrs: { role: "status" }, text: "" });
  const timerFill = el("div", { className: "multiplayer-timer-fill" });
  const timerBar = el("div", { className: "multiplayer-timer maptap-mp-timer", attrs: { role: "presentation" }, children: [timerFill] });
  const resultList = el("ul", { className: "result-list maptap-mp-result-list" });
  const scoreList = el("ol", { className: "score-list" });

  const infoOverlay = createMapTapInfoOverlay();

  const globe = createMapTapGlobe({
    signal: options.signal,
    onGuess: (point) => {
      if (!hasGuessed) {
        hasGuessed = true;
        globe.setAcceptingGuesses(false);
        options.onGuess(point.lat, point.lng);
      }
    },
  });

  function renderTimer(): void {
    if (phaseStartedAt === null || phaseEndsAt === null || phaseEndsAt <= phaseStartedAt) { timerBar.hidden = true; return; }
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
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    timerBar.hidden = true;
  }

  function createScoreRows(room: PublicRoomState, localPlayerId: PlayerId | null): readonly HTMLElement[] {
    return [...room.players]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map((player, index) => {
        const emoji = getPlayerEmoji(player.id, player.id === localPlayerId);
        return el("li", {
          className: player.id === localPlayerId ? "score-row is-local" : "score-row",
          children: [
            el("span", { className: "score-rank", text: `#${index + 1}` }),
            el("span", { className: "player-emoji score-emoji", text: emoji, attrs: { "aria-hidden": "true" } }),
            el("span", { className: "score-name", text: `${player.name}${player.connected ? "" : " · offline"}` }),
            el("span", { className: "score-value", text: player.score.toLocaleString() }),
          ],
        });
      });
  }

  function createResultRows(results: readonly MapTapRoundResult[], localPlayerId: PlayerId | null): readonly HTMLElement[] {
    return results.map((result, index) => {
      const color = PLAYER_COLORS[index % PLAYER_COLORS.length] ?? "#888";
      const isLocal = result.playerId === localPlayerId;
      const distText = result.guess ? formatDistance(result.distanceKm) : "didn't guess";
      return el("li", {
        className: isLocal ? "result-row maptap-mp-result-row is-local" : "result-row maptap-mp-result-row",
        children: [
          el("span", { className: "maptap-mp-result-dot", attrs: { style: `background:${color}` } }),
          el("span", { className: "maptap-mp-result-name", text: result.name }),
          el("span", { className: "maptap-mp-result-dist", text: distText }),
          el("span", { className: "maptap-mp-result-score", text: `+${result.score}` }),
        ],
      });
    });
  }

  const element = el("div", {
    className: "maptap-layout multiplayer-maptap-layout",
    children: [
      el("div", {
        className: "maptap-map-panel",
        children: [globe.element, timerBar, infoOverlay.element],
      }),
      el("aside", {
        className: "maptap-sidebar multiplayer-maptap-sidebar",
        children: [
          el("div", {
            className: "panel-title",
            children: [el("span", { className: "eyebrow", text: "MapTap · Multiplayer" }), el("h1", { text: "Click on:" }), promptTarget, promptMeta],
          }),
          statusText,
          resultList,
          el("div", { className: "maptap-mp-scoreboard", children: [el("p", { className: "eyebrow", text: "SCOREBOARD" }), scoreList] }),
        ],
      }),
    ],
  });

  return {
    element,
    update(state) {
      const { room, localPlayerId, round, reveal, finalResults, feedback, canSubmit } = state;
      const visibleRound = round ?? room.round;
      const roundKey = visibleRound ? `${room.roomCode}:${visibleRound.roundNumber}:${visibleRound.startedAt}` : null;
      const revealKey = reveal ? `${room.roomCode}:${reveal.targetName}:${reveal.targetLat}` : null;

      // New round — reset state
      if (roundKey !== renderedRoundKey) {
        renderedRoundKey = roundKey;
        hasGuessed = false;
        renderedRevealKey = null;
        globe.reset();
        globe.setAcceptingGuesses(canSubmit);
        infoOverlay.hide();
        wikiAbortController?.abort();
        wikiAbortController = null;
        resultList.replaceChildren();
      }

      globe.setAcceptingGuesses(canSubmit && !hasGuessed && !reveal);

      if (visibleRound) {
        const parsed = parsePromptValue(visibleRound.prompt.value);
        promptTarget.textContent = parsed?.name ?? visibleRound.prompt.value;
        promptMeta.textContent = parsed ? `${formatCategory(parsed.category)} · ${parsed.difficulty}` : "";
      } else {
        promptTarget.textContent = finalResults ? "Game over" : "Waiting...";
        promptMeta.textContent = "";
      }

      if (hasGuessed && !reveal) {
        statusText.textContent = "Guess submitted — waiting for others…";
      } else if (reveal) {
        statusText.textContent = feedback;
      } else {
        statusText.textContent = canSubmit ? "Rotate the globe and click your best guess." : feedback;
      }

      // Reveal — show markers + overlay once
      if (revealKey && revealKey !== renderedRevealKey) {
        renderedRevealKey = revealKey;
        const target = { lat: reveal!.targetLat, lng: reveal!.targetLng };
        const playerColors = new Map(room.players.map((p, i) => [p.id, PLAYER_COLORS[i % PLAYER_COLORS.length] ?? "#888"]));
        const guesses = reveal!.results
          .filter((r) => r.guess !== null)
          .map((r) => ({
            lat: r.guess!.lat,
            lng: r.guess!.lng,
            label: r.name,
            color: playerColors.get(r.playerId) ?? "#888",
          }));
        globe.revealMultiplayer(target, guesses);

        wikiAbortController?.abort();
        wikiAbortController = new AbortController();
        void fetchWikipediaSummary(reveal!.wikiSlug, wikiAbortController.signal).then((summary) => {
          if (wikiAbortController?.signal.aborted) return;
          infoOverlay.show(reveal!.targetName, summary);
        });

        resultList.replaceChildren(...createResultRows(reveal!.results, localPlayerId));
      }

      if (finalResults) {
        resultList.replaceChildren(
          ...finalResults.map((r) =>
            el("li", { className: "result-row final", text: `#${r.rank} ${r.name} · ${r.score.toLocaleString()}` }),
          ),
        );
      }

      scoreList.replaceChildren(...createScoreRows(room, localPlayerId));

      phaseStartedAt = room.phaseStartedAt;
      phaseEndsAt = room.phaseEndsAt;
      const intermission = room.status === "round-result";
      timerBar.classList.toggle("is-intermission", intermission);
      if ((room.status === "playing" || intermission) && phaseEndsAt !== null) {
        renderTimer();
        ensureTimerLoop();
      } else {
        stopTimerLoop();
      }
    },
    destroy() {
      stopTimerLoop();
      wikiAbortController?.abort();
    },
  };
}
