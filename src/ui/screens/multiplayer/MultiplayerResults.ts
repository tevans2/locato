/*
 * After a game: the standings, then one click to go again. The host plays again with the same
 * players and settings (or goes back to the lobby to change them); everyone else sees that the
 * host is choosing, and can leave.
 */

import type { ClientMessage, FinalResult, PublicRoomState, QuickMatchGame } from "../../../core/multiplayer";
import type { RatingUpdate } from "./roomSession";
import { getPlayerEmoji } from "../../../core/auth/avatars";
import { el } from "../../dom/createElement";
import { shellIcon } from "../../shell";
import { describeRoom, roomKindInfo } from "./roomModes";

export interface MultiplayerResultsOptions {
  readonly signal: AbortSignal;
  readonly send: (message: ClientMessage) => void;
  readonly onLeave: () => void;
  /** Quick matches: queue for the next one. */
  readonly onFindMatch?: (game: QuickMatchGame) => void;
}

export interface MultiplayerResultsState {
  readonly room: PublicRoomState;
  readonly localPlayerId: string | null;
  readonly results: readonly FinalResult[];
  /** Quick matches: the rated players' new ratings, once the server sends them. */
  readonly ratingUpdate?: RatingUpdate | null;
}

export interface MultiplayerResults {
  readonly element: HTMLElement;
  readonly update: (state: MultiplayerResultsState) => void;
}

const numberFormat = new Intl.NumberFormat("en-US");

/** The second line on a standings row, in the game's own terms. */
function resultDetail(room: PublicRoomState, result: FinalResult): string {
  if (room.kind === "flyover") return `${result.score} ${result.score === 1 ? "country" : "countries"}${result.wrongAnswers ? ` · ${result.wrongAnswers} skipped` : ""}`;
  if (room.kind === "quiz") return `${result.correctAnswers} correct`;
  return `${result.correctAnswers} of ${result.correctAnswers + result.wrongAnswers} rounds pinned`;
}

export function createMultiplayerResults(options: MultiplayerResultsOptions): MultiplayerResults {
  const { signal } = options;

  const kicker = el("p", { className: "mp-kicker" });
  const headline = el("h2", { className: "mp-results-title", attrs: { tabindex: "-1" } });
  const subline = el("p", { className: "mp-muted" });
  const standings = el("ol", { className: "mp-standings" });

  const playAgain = el("button", { className: "shell-btn mp-start-game", attrs: { type: "button" }, children: [shellIcon("rotate-ccw", 18, 2.2), el("span", { text: "Play again" })] });
  const changeSettings = el("button", { className: "shell-btn shell-btn-quiet", text: "Change game", attrs: { type: "button" } });
  const waiting = el("p", { className: "mp-waiting", children: [el("span", { className: "mp-live-dot", attrs: { "aria-hidden": "true" } }), el("span")] });
  const leave = el("button", { className: "shell-btn shell-btn-quiet mp-leave", text: "Leave room", attrs: { type: "button" } });
  const findMatch = el("button", { className: "shell-btn mp-start-game mp-find-match", attrs: { type: "button", hidden: "" }, children: [shellIcon("users", 18, 2.2), el("span", { text: "Find another match" })] });
  let quickGame: QuickMatchGame | null = null;
  findMatch.addEventListener("click", () => { if (quickGame) options.onFindMatch?.(quickGame); }, { signal });
  playAgain.addEventListener("click", () => options.send({ type: "PLAY_AGAIN" }), { signal });
  changeSettings.addEventListener("click", () => options.send({ type: "RETURN_TO_LOBBY" }), { signal });
  leave.addEventListener("click", () => options.onLeave(), { signal });

  const element = el("section", {
    className: "mp-card mp-results",
    attrs: { "aria-labelledby": "mp-results-title" },
    children: [
      el("header", { className: "mp-results-head", children: [kicker, headline, subline] }),
      standings,
      el("div", { className: "mp-action-bar", children: [el("div", { className: "mp-action-main", children: [playAgain, changeSettings, findMatch, waiting] }), leave] }),
    ],
  });
  headline.id = "mp-results-title";

  let shownFor = "";

  return {
    element,
    update: ({ room, localPlayerId, results, ratingUpdate }) => {
      const isHost = localPlayerId === room.hostPlayerId;
      const winner = results[0];
      const mine = results.find((result) => result.playerId === localPlayerId);
      const tied = winner && results[1] && results[1].score === winner.score && room.kind !== "flyover";
      kicker.replaceChildren(el("span", { text: `${roomKindInfo(room.kind).label} · game over` }));
      headline.textContent = !winner ? "Game over" : tied ? "It's a tie!" : winner.playerId === localPlayerId ? "You won!" : `${winner.name} wins`;
      const placing = !mine ? "" : tied && mine.score === winner?.score ? "You tied for first." : mine.rank === 1 ? "You finished first." : `You finished #${mine.rank} of ${results.length}.`;
      subline.textContent = mine
        ? `${placing} ${describeRoom(room).join(" · ")}`
        : `You watched this one, so you're in the next game. ${describeRoom(room).join(" · ")}`;

      standings.replaceChildren(
        ...results.map((result) => {
          const player = room.players.find((candidate) => candidate.id === result.playerId);
          const isYou = result.playerId === localPlayerId;
          const change = ratingUpdate?.changes.find((item) => item.playerId === result.playerId);
          return el("li", {
            className: `mp-standing rank-${Math.min(result.rank, 4)}${isYou ? " is-you" : ""}${change ? " has-rating" : ""}`,
            children: [
              el("span", { className: "mp-standing-rank", text: String(result.rank) }),
              el("span", { className: "mp-avatar is-emoji", text: getPlayerEmoji(player ?? { id: result.playerId }, isYou), attrs: { "aria-hidden": "true" } }),
              el("span", {
                className: "mp-standing-name",
                children: [
                  el("strong", { children: [el("span", { text: result.name }), ...(isYou ? [el("span", { className: "mp-you", text: "you" })] : [])] }),
                  el("span", { className: "mp-muted", text: resultDetail(room, result) }),
                ],
              }),
              el("span", { className: "mp-standing-score", text: numberFormat.format(result.score) }),
              ...(change ? [el("span", {
                className: `mp-standing-rating ${change.delta > 0 ? "is-up" : change.delta < 0 ? "is-down" : ""}`.trim(),
                text: `${numberFormat.format(change.rating)} (${change.delta > 0 ? "+" : change.delta < 0 ? "−" : "±"}${Math.abs(change.delta)})`,
                attrs: { title: "Rating after this game" },
              })] : []),
            ],
          });
        }),
      );

      // Quick matches don't rematch: everyone queues for the next one.
      quickGame = room.quickMatch?.game ?? null;
      findMatch.hidden = quickGame === null || !options.onFindMatch;
      playAgain.hidden = !isHost || quickGame !== null;
      changeSettings.hidden = !isHost || quickGame !== null;
      waiting.hidden = isHost || quickGame !== null;
      const host = room.players.find((player) => player.id === room.hostPlayerId);
      waiting.lastElementChild!.textContent = `${host?.name ?? "The host"} is choosing what's next…`;

      // Move focus to the result once per game, so screen readers hear who won.
      const key = `${room.roomCode}:${results.map((result) => `${result.playerId}=${result.score}`).join(",")}`;
      if (key !== shownFor) {
        shownFor = key;
        requestAnimationFrame(() => {
          if (element.isConnected && !element.closest("[hidden]")) headline.focus({ preventScroll: false });
        });
      }
    },
  };
}
