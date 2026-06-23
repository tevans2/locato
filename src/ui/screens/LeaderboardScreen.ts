import { fetchAuthState, fetchLeaderboard, submitBestTime, type AuthUser, type LeaderboardEntry } from "../../core/auth";
import { CONTINENTS } from "../../core/countries";
import { isTimerGameModeId, timerGameModeOptions, type GameModeId, type TimerGameModeId } from "../../core/gameModes";
import { timerKeysForMode } from "../../core/timer/keys";
import { formatElapsedTime, readStoredTime } from "../../core/timer/playTimer";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";

export interface LeaderboardScreenOptions {
  readonly initialMode?: GameModeId;
  readonly initialVariant?: string;
  readonly storage: Storage;
  readonly onBack: () => void;
  readonly onDailyChallenge?: () => void;
  readonly onSignIn: () => void;
}

function createLogo(): HTMLElement {
  return el("div", {
    className: "brand-lockup compact",
    children: [el("img", { className: "brand-logo", attrs: { src: "logo.svg", alt: "" } }), el("span", { className: "brand-name", text: "locato" })],
  });
}

function entryAvatar(entry: LeaderboardEntry): HTMLElement {
  if (entry.avatarEmoji) {
    return el("span", { className: "leaderboard-avatar is-emoji", text: entry.avatarEmoji });
  }
  return el("span", { className: "leaderboard-avatar", text: entry.displayName.charAt(0).toUpperCase() });
}

function renderRows(entries: readonly LeaderboardEntry[], currentUserId: string | null): readonly HTMLElement[] {
  return entries.map((entry) =>
    el("li", {
      className: `leaderboard-row${entry.rank === 1 ? " is-winner" : ""}${entry.userId === currentUserId ? " is-local" : ""}`,
      children: [
        el("span", { className: "leaderboard-rank", text: `#${entry.rank}` }),
        entryAvatar(entry),
        el("span", { className: "leaderboard-name", text: entry.userId === currentUserId ? `${entry.displayName} (you)` : entry.displayName }),
        el("span", { className: "leaderboard-score", text: formatElapsedTime(entry.timeMs) }),
      ],
    }),
  );
}

export function createLeaderboardScreen(options: LeaderboardScreenOptions): Screen {
  const controller = new AbortController();
  let selectedMode: TimerGameModeId = options.initialMode && isTimerGameModeId(options.initialMode) ? options.initialMode : "name-all";
  let selectedVariant = options.initialVariant ?? (selectedMode === "puzzle" ? "Africa" : "");
  let currentUser: AuthUser | null = null;

  const modeSelect = el("select", {
    className: "leaderboard-mode-select",
    attrs: { id: "leaderboard-mode", name: "leaderboardMode", "aria-label": "Leaderboard game mode" },
    children: timerGameModeOptions.map((mode) => el("option", { text: mode.label, attrs: { value: mode.id } })),
  });
  modeSelect.value = selectedMode;

  const variantSelect = el("select", {
    className: "leaderboard-variant-select",
    attrs: { id: "leaderboard-variant", name: "leaderboardVariant", "aria-label": "Puzzle continent" },
    children: CONTINENTS.map((continent) => el("option", { text: continent, attrs: { value: continent } })),
  });
  variantSelect.value = selectedVariant || "Africa";

  const statusText = el("p", { className: "leaderboard-status", attrs: { role: "status" } });
  const userRankText = el("p", { className: "leaderboard-user-rank" });
  const list = el("ol", { className: "leaderboard global-leaderboard" });
  const backButton = el("button", { className: "ghost-action screen-back-button", text: "Back", attrs: { type: "button", "aria-label": "Back to game" } });
  const dailyButton = el("button", { className: "ghost-action screen-header-action", text: "Daily Challenge", attrs: { type: "button", "aria-label": "Open daily challenge", ...(options.onDailyChallenge ? {} : { hidden: "true" }) } });
  const signInButton = el("button", { className: "secondary-action screen-header-action", text: "Sign in", attrs: { type: "button", hidden: "true" } });
  const postLocalBestButton = el("button", { className: "secondary-action", text: "Post saved best", attrs: { type: "button", hidden: "true" } });

  const variantFilter = el("label", {
    className: "leaderboard-filter leaderboard-filter-variant",
    children: [el("span", { className: "stat-label", text: "Continent", attrs: { for: "leaderboard-variant" } }), variantSelect],
  });

  function syncVariantVisibility(): void {
    const showVariant = selectedMode === "puzzle";
    variantFilter.hidden = !showVariant;
    if (!showVariant) selectedVariant = "";
    else if (!selectedVariant) selectedVariant = variantSelect.value;
  }

  async function loadBoard(): Promise<void> {
    statusText.textContent = "Loading leaderboard...";
    userRankText.textContent = "";
    list.replaceChildren();

    const variant = selectedMode === "puzzle" ? selectedVariant : "";
    const response = await fetchLeaderboard(selectedMode, variant);

    if (!response) {
      statusText.textContent = "Could not load leaderboard.";
      return;
    }

    if (response.entries.length === 0) {
      statusText.textContent = "No times posted yet. Be the first in timer mode.";
    } else {
      statusText.textContent = "";
    }

    list.replaceChildren(...renderRows(response.entries, currentUser?.id ?? null));

    postLocalBestButton.hidden = true;

    if (currentUser && response.currentUser) {
      userRankText.textContent = `Your best: ${formatElapsedTime(response.currentUser.timeMs)} — rank #${response.currentUser.rank}`;
    } else if (currentUser) {
      const variant = selectedMode === "puzzle" ? selectedVariant : "";
      const localBest = readStoredTime(options.storage, timerKeysForMode(selectedMode).best);
      if (localBest) {
        userRankText.textContent = `You have a saved best of ${formatElapsedTime(localBest)} on this device that is not on the board yet.`;
        postLocalBestButton.hidden = false;
        postLocalBestButton.textContent = `Post saved best (${formatElapsedTime(localBest)})`;
        postLocalBestButton.dataset.timeMs = String(localBest);
        postLocalBestButton.dataset.variant = variant;
      } else {
        userRankText.textContent = "You have not posted a time for this board yet. Finish a run in Timer mode.";
      }
    } else {
      userRankText.textContent = "Sign in to post your timer runs and track your rank.";
    }

    signInButton.hidden = currentUser !== null;
  }

  modeSelect.addEventListener(
    "change",
    () => {
      selectedMode = modeSelect.value as TimerGameModeId;
      if (selectedMode === "puzzle" && !selectedVariant) selectedVariant = variantSelect.value;
      syncVariantVisibility();
      void loadBoard();
    },
    { signal: controller.signal },
  );

  variantSelect.addEventListener(
    "change",
    () => {
      selectedVariant = variantSelect.value;
      void loadBoard();
    },
    { signal: controller.signal },
  );

  backButton.addEventListener("click", options.onBack, { signal: controller.signal });
  dailyButton.addEventListener("click", () => options.onDailyChallenge?.(), { signal: controller.signal });
  signInButton.addEventListener("click", options.onSignIn, { signal: controller.signal });
  postLocalBestButton.addEventListener(
    "click",
    async () => {
      const timeMs = Number(postLocalBestButton.dataset.timeMs);
      if (!currentUser || !Number.isFinite(timeMs)) return;
      postLocalBestButton.disabled = true;
      const result = await submitBestTime({
        gameMode: selectedMode,
        variant: postLocalBestButton.dataset.variant ?? "",
        timeMs,
      });
      postLocalBestButton.disabled = false;
      if (result?.accepted) {
        void loadBoard();
        return;
      }
      statusText.textContent = "Could not post that saved time.";
    },
    { signal: controller.signal },
  );

  const element = el("section", {
    className: "game-screen leaderboard-screen",
    children: [
      el("header", {
        className: "stats-header leaderboard-header",
        children: [
          el("div", { className: "stats-header-title", children: [createLogo(), el("h1", { text: "Leaderboards" })] }),
          el("div", { className: "screen-header-actions", children: [dailyButton, backButton, signInButton] }),
        ],
      }),
      el("div", {
        className: "leaderboard-layout",
        children: [
          el("div", {
            className: "panel-title",
            children: [
              el("h2", { text: "Leaderboards" }),
              el("p", { text: "Only Timer mode runs count. Practice mode saves progress but does not post times." }),
            ],
          }),
          el("div", {
            className: "leaderboard-filters",
            children: [
              el("label", {
                className: "leaderboard-filter",
                children: [el("span", { className: "stat-label", text: "Game mode", attrs: { for: "leaderboard-mode" } }), modeSelect],
              }),
              variantFilter,
            ],
          }),
          statusText,
          userRankText,
          postLocalBestButton,
          list,
        ],
      }),
    ],
  });

  syncVariantVisibility();
  void fetchAuthState().then((state) => {
    currentUser = state.user;
    void loadBoard();
  });

  return {
    element,
    destroy: () => controller.abort(),
  };
}
