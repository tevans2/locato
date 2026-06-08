import type { FinalResult, PlayerId, PublicRoomState, PublicRoundState, RoundResult } from "../../core/multiplayer";
import type { CountryIndex } from "../../core/countries";
import type { WorldCountryFeature } from "../../core/map";
import { getPlayerEmoji } from "../../core/auth/avatars";
import { el } from "../dom/createElement";
import { promptImageClass } from "../dom/renderPrompt";
import { createWorldMapView } from "../dom/renderWorldMap";

export interface MultiplayerGameViewState {
  readonly room: PublicRoomState;
  readonly localPlayerId: PlayerId | null;
  readonly round: PublicRoundState | null;
  readonly roundResult: { readonly answer: string; readonly results: readonly RoundResult[] } | null;
  readonly finalResults: readonly FinalResult[] | null;
  readonly feedback: string;
  readonly canSubmit: boolean;
}

export interface MultiplayerGameView {
  readonly element: HTMLElement;
  readonly answerInput: HTMLInputElement;
  readonly submitButton: HTMLButtonElement;
  readonly update: (state: MultiplayerGameViewState) => void;
  readonly destroy: () => void;
}

export interface MultiplayerGameViewOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly onSubmit: (answer: string) => void;
}

function formatScore(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function sortPlayers(room: PublicRoomState) {
  return [...room.players].sort((left, right) => right.score - left.score || right.correctAnswers - left.correctAnswers || left.name.localeCompare(right.name));
}

function createScoreRows(room: PublicRoomState, localPlayerId: PlayerId | null): readonly HTMLElement[] {
  return sortPlayers(room).map((player, index) => {
    const emoji = getPlayerEmoji(player.id, player.id === localPlayerId);
    return el("li", {
      className: player.id === localPlayerId ? "score-row is-local" : "score-row",
      children: [
        el("span", { className: "score-rank", text: `#${index + 1}` }),
        el("span", { className: "player-emoji score-emoji", text: emoji, attrs: { "aria-hidden": "true" } }),
        el("span", { className: "score-name", text: `${player.name}${player.connected ? "" : " · offline"}` }),
        el("span", { className: "score-value", text: formatScore(player.score) }),
        el("span", { className: "score-meta", text: `${player.correctAnswers} correct · ${player.streak} streak` }),
      ],
    });
  });
}

function createResultRows(results: readonly RoundResult[]): readonly HTMLElement[] {
  return results.map((result) =>
    el("li", {
      className: result.correct ? "result-row good" : "result-row",
      text: `${result.name}: ${result.correct ? `+${result.points}` : "no correct answer"}`,
    }),
  );
}

function createFinalRows(results: readonly FinalResult[]): readonly HTMLElement[] {
  return results.map((result) =>
    el("li", {
      className: "result-row final",
      text: `#${result.rank} ${result.name} · ${formatScore(result.score)} · ${result.correctAnswers} correct`,
    }),
  );
}

export function createMultiplayerGameView(options: MultiplayerGameViewOptions): MultiplayerGameView {
  const flagSlot = el("div", { className: "multiplayer-flag-slot" });
  const roundKicker = el("p", { className: "round-kicker", text: "Waiting for the next round" });
  const timerFill = el("div", { className: "multiplayer-timer-fill" });
  const timerBar = el("div", { className: "multiplayer-timer", attrs: { role: "presentation" }, children: [timerFill] });
  const roundTitle = el("h2", { text: "Multiplayer round" });
  const feedback = el("p", { className: "multiplayer-feedback", text: "Submit answers before the server closes the round." });
  const resultList = el("ul", { className: "result-list" });
  const scoreList = el("ol", { className: "score-list" });
  const answerInput = el("input", {
    attrs: { type: "text", autocomplete: "off", autocapitalize: "words", spellcheck: "false", placeholder: "Type the country name" },
  });
  const submitButton = el("button", { className: "primary-action", text: "Submit", attrs: { type: "submit" } });
  const answerForm = el("form", {
    className: "guess-form multiplayer-answer-form",
    children: [el("label", { text: "Your answer" }), el("div", { className: "input-row", children: [answerInput, submitButton] })],
  });
  const mapTargetName = el("strong", { className: "multiplayer-map-target-name", text: "—" });
  const mapTarget = el("div", {
    className: "multiplayer-map-target",
    children: [el("span", { text: "Pick this country" }), mapTargetName],
  });
  const mapView = createWorldMapView(options.worldCountryFeatures, options.countryIndex, {
    onCountryClick: (countryId) => {
      const country = options.countryIndex.byId[countryId];
      if (!country || answerInput.disabled) return;
      options.onSubmit(country.code);
    },
  });
  mapView.element.classList.add("multiplayer-map-panel");
  const mapPrompt = el("div", { className: "multiplayer-map-prompt", children: [mapTarget, mapView.element] });

  let renderedRoundKey: string | null = null;
  let focusedRoundKey: string | null = null;
  let phaseStartedAt: number | null = null;
  let phaseEndsAt: number | null = null;
  let rafId: number | null = null;

  // The bar is driven by its own animation frame, not by server messages, so it drains smoothly
  // between snapshots. The server stays authoritative; the bar only clamps to [0,1] to stay sane
  // under client/server clock skew.
  function renderTimer(): void {
    if (phaseStartedAt === null || phaseEndsAt === null || phaseEndsAt <= phaseStartedAt) {
      timerBar.hidden = true;
      return;
    }
    timerBar.hidden = false;
    const total = phaseEndsAt - phaseStartedAt;
    const remaining = phaseEndsAt - Date.now();
    const fraction = Math.max(0, Math.min(1, remaining / total));
    timerFill.style.transform = `scaleX(${fraction})`;
  }

  function ensureTimerLoop(): void {
    if (rafId !== null) return;
    const loop = (): void => {
      renderTimer();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function stopTimerLoop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    timerBar.hidden = true;
  }

  answerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const answer = answerInput.value.trim();
    if (!answer) return;
    options.onSubmit(answer);
    answerInput.value = "";
  });

  const element = el("div", {
    className: "multiplayer-game-layout",
    children: [
      el("section", {
        className: "flag-card multiplayer-flag-card",
        children: [el("div", { className: "flag-card-top", children: [roundKicker] }), flagSlot, timerBar],
      }),
      el("div", {
        className: "multiplayer-bottom-grid",
        children: [
          el("section", {
            className: "answer-panel multiplayer-round-panel multiplayer-answer-panel",
            children: [roundTitle, answerForm, feedback, resultList],
          }),
          el("aside", {
            className: "answer-panel multiplayer-score-panel",
            children: [el("h2", { text: "Scoreboard" }), scoreList],
          }),
        ],
      }),
    ],
  });

  return {
    element,
    answerInput,
    submitButton,
    update: (state) => {
      const visibleRound = state.round ?? state.room.round;
      const roundKey = visibleRound ? `${state.room.roomCode}:${visibleRound.roundNumber}:${visibleRound.startedAt}:${visibleRound.prompt.kind}:${visibleRound.prompt.value}` : null;
      const isMapClickRound = visibleRound?.prompt.kind === "map-click";
      const isNewRound = roundKey !== null && roundKey !== renderedRoundKey;
      if (isNewRound) answerInput.value = "";
      renderedRoundKey = roundKey;

      const intermission = state.room.status === "round-result";
      roundKicker.textContent = state.room.status === "complete"
        ? "Final results"
        : intermission
          ? "Next round starting…"
          : visibleRound
            ? `Round ${visibleRound.roundNumber}`
            : "Waiting for the next round";
      roundTitle.textContent = state.room.status === "complete" ? "Game complete" : "Your answer";
      feedback.textContent = state.feedback;
      answerInput.disabled = !state.canSubmit;
      submitButton.disabled = !state.canSubmit;
      answerForm.hidden = isMapClickRound;
      mapView.element.classList.toggle("is-disabled", !state.canSubmit);
      // Focus the first time a round becomes submittable, not on round identity alone: the
      // ROUND_STARTED/GAME_STARTED frame arrives while status is still round-result/lobby
      // (canSubmit false), and the playing snapshot follows separately. Keying focus off
      // canSubmit handles that split, and once-per-round avoids stealing the caret mid-type.
      if (state.canSubmit && !isMapClickRound && roundKey !== null && roundKey !== focusedRoundKey) {
        answerInput.focus();
        focusedRoundKey = roundKey;
      }

      if (visibleRound) {
        if (visibleRound.prompt.kind === "image") {
          flagSlot.replaceChildren(el("img", { className: promptImageClass(visibleRound.prompt.value), attrs: { src: visibleRound.prompt.value, alt: "Prompt to guess" } }));
        } else if (visibleRound.prompt.kind === "map-click") {
          mapTargetName.textContent = visibleRound.prompt.value;
          flagSlot.replaceChildren(mapPrompt);
        } else {
          flagSlot.replaceChildren(el("div", { className: "prompt-text", text: visibleRound.prompt.value }));
        }
      } else {
        flagSlot.replaceChildren(el("div", { className: "complete-card", text: "The server will reveal the next prompt when the room starts." }));
      }

      phaseStartedAt = state.room.phaseStartedAt;
      phaseEndsAt = state.room.phaseEndsAt;
      timerBar.classList.toggle("is-intermission", intermission);
      if ((state.room.status === "playing" || intermission) && phaseEndsAt !== null) {
        renderTimer();
        ensureTimerLoop();
      } else {
        stopTimerLoop();
      }

      if (state.finalResults) resultList.replaceChildren(...createFinalRows(state.finalResults));
      else if (state.roundResult) {
        resultList.replaceChildren(
          el("li", { className: "result-row reveal", text: state.roundResult.answer }),
          ...createResultRows(state.roundResult.results),
        );
      } else resultList.replaceChildren(el("li", { className: "result-row", text: "No result yet." }));

      scoreList.replaceChildren(...createScoreRows(state.room, state.localPlayerId));
    },
    destroy: stopTimerLoop,
  };
}
