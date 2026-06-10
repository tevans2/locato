import { fetchAuthState, fetchLeaderboard, type AuthUser, type LeaderboardEntry } from "../../core/auth";
import { CONTINENTS } from "../../core/countries";
import { gameModeOptions, type GameModeId } from "../../core/gameModes";
import { formatElapsedTime } from "../../core/timer/playTimer";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";

export interface LeaderboardScreenOptions {
  readonly initialMode?: GameModeId;
  readonly initialVariant?: string;
  readonly onBack: () => void;
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
  let selectedMode: GameModeId = options.initialMode ?? "name-all";
  let selectedVariant = options.initialVariant ?? (selectedMode === "puzzle" ? "Africa" : "");
  let currentUser: AuthUser | null = null;

  const modeSelect = el("select", {
    className: "leaderboard-mode-select",
    attrs: { id: "leaderboard-mode", name: "leaderboardMode", "aria-label": "Leaderboard game mode" },
    children: gameModeOptions.map((mode) => el("option", { text: mode.label, attrs: { value: mode.id } })),
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
  const backButton = el("button", { className: "ghost-action", text: "Back to game", attrs: { type: "button" } });
  const signInButton = el("button", { className: "secondary-action", text: "Sign in", attrs: { type: "button", hidden: "true" } });

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

    if (currentUser && response.currentUser) {
      userRankText.textContent = `Your best: ${formatElapsedTime(response.currentUser.timeMs)} — rank #${response.currentUser.rank}`;
    } else if (currentUser) {
      userRankText.textContent = "You have not posted a time for this board yet.";
    } else {
      userRankText.textContent = "Sign in to post your timer runs and track your rank.";
    }

    signInButton.hidden = currentUser !== null;
  }

  modeSelect.addEventListener(
    "change",
    () => {
      selectedMode = modeSelect.value as GameModeId;
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
  signInButton.addEventListener("click", options.onSignIn, { signal: controller.signal });

  const element = el("section", {
    className: "game-screen leaderboard-screen",
    children: [
      el("header", {
        className: "game-header",
        children: [
          el("div", { className: "game-header-left", children: [createLogo()] }),
          el("div", { className: "game-header-actions", children: [backButton, signInButton] }),
        ],
      }),
      el("div", {
        className: "leaderboard-layout",
        children: [
          el("div", { className: "panel-title", children: [el("h2", { text: "Leaderboards" }), el("p", { text: "Fastest timer-mode completions worldwide." })] }),
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
