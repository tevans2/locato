import type { FinalResult, PlayerId } from "../../core/multiplayer";
import { el } from "../dom/createElement";

export interface EndGameModalCallbacks {
  readonly onPlayAgain: () => void;
  readonly onLeave: () => void;
}

export interface EndGameModalState {
  readonly localPlayerId: PlayerId | null;
  readonly results: readonly FinalResult[];
  readonly canPlayAgain: boolean;
}

export interface EndGameModal {
  readonly element: HTMLElement;
  readonly show: (state: EndGameModalState) => void;
  readonly hide: () => void;
}

function formatScore(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function leaderboardRows(state: EndGameModalState): readonly HTMLElement[] {
  return state.results.map((result) => {
    const isLocal = result.playerId === state.localPlayerId;
    return el("li", {
      className: `leaderboard-row${result.rank === 1 ? " is-winner" : ""}${isLocal ? " is-local" : ""}`,
      children: [
        el("span", { className: "leaderboard-rank", text: `#${result.rank}` }),
        el("span", { className: "leaderboard-name", text: isLocal ? `${result.name} (you)` : result.name }),
        el("span", { className: "leaderboard-score", text: formatScore(result.score) }),
        el("span", { className: "leaderboard-meta", text: `${result.correctAnswers} correct` }),
      ],
    });
  });
}

export function createEndGameModal(callbacks: EndGameModalCallbacks): EndGameModal {
  const headline = el("h2", { className: "modal-headline", text: "Game over" });
  const leaderboard = el("ol", { className: "leaderboard" });
  const playAgainButton = el("button", { className: "primary-action", text: "Rematch", attrs: { type: "button" } });
  const leaveButton = el("button", { className: "ghost-action", text: "Leave room", attrs: { type: "button" } });
  const hint = el("p", { className: "modal-hint", text: "" });

  playAgainButton.addEventListener("click", () => callbacks.onPlayAgain());
  leaveButton.addEventListener("click", () => callbacks.onLeave());

  const dialog = el("div", {
    className: "multiplayer-modal",
    attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Game over" },
    children: [
      el("p", { className: "eyebrow", text: "GAME OVER" }),
      headline,
      leaderboard,
      el("div", { className: "actions", children: [playAgainButton, leaveButton] }),
      hint,
    ],
  });

  const element = el("div", { className: "multiplayer-modal-backdrop", children: [dialog] });
  element.hidden = true;

  let visible = false;

  return {
    element,
    show: (state) => {
      const winner = state.results.find((result) => result.rank === 1);
      headline.textContent = winner && winner.playerId === state.localPlayerId ? "You won!" : winner ? `${winner.name} wins` : "Game over";

      leaderboard.replaceChildren(...leaderboardRows(state));

      playAgainButton.disabled = !state.canPlayAgain;
      hint.textContent = state.canPlayAgain ? "" : "Only the host can start a rematch.";
      hint.hidden = state.canPlayAgain;

      element.hidden = false;
      if (!visible) {
        visible = true;
        // Land focus on the action the player can actually take, once per appearance.
        (state.canPlayAgain ? playAgainButton : leaveButton).focus();
      }
    },
    hide: () => {
      visible = false;
      element.hidden = true;
    },
  };
}
