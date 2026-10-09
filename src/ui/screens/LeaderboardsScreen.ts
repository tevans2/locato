import { GEO_GAME_MAPS } from "../../core/geoguessr/maps";
import { fetchAuthState, fetchLeaderboard, type AuthUser } from "../../core/auth";
import { GAME_MODE_GROUPS, isTimerGameModeId, type GameModeCatalogueEntry, type GameModeGroup, type GameModeId } from "../../core/gameModes";
import { leaderboardConfig, runLabels, type LeaderboardMetric, type LeaderboardModeConfig } from "../../core/leaderboards";
import { timerKeysForMode } from "../../core/timer/keys";
import { formatElapsedTime, readStoredTime } from "../../core/timer/playTimer";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createSitePage, shellIcon, type ShellContext } from "../shell";
import "../../styles/leaderboards.css";

/*
 * Leaderboards (docs/navigation.md → "Leaderboards"): every mode's global board
 * (src/core/leaderboards.ts), with one call to action: play a ranked attempt. Time boards rank
 * the fastest run, score boards the highest total from one fixed-length attempt.
 */

export interface LeaderboardsScreenOptions {
  readonly shell: ShellContext;
  readonly storage: Storage;
  /** Mode to open on (from `?mode=`). Unknown modes fall back to the first board. */
  readonly mode?: GameModeId;
  /** Variant to open on (from `?variant=`): "territories" / "both" for flags, a continent for puzzle. */
  readonly variant?: string;
  /** Called when the player picks another board or variant. App mirrors it into the URL with history *replace*. */
  readonly onSelect?: (mode: GameModeId, variant: string) => void;
}

/** Rows per board page ("Show more" fetches the next page). */
export const LEADERBOARD_PAGE_SIZE = 20;

/** The call to action on a board, per metric. */
export const PLAY_LABELS: Record<LeaderboardMetric, string> = {
  time: "Start a timed run",
  score: "Play a ranked attempt",
};

const VARIANT_LABELS: Record<string, string> = { "": "Countries", territories: "Territories", both: "Both" };

type BoardMode = GameModeCatalogueEntry & { readonly config: LeaderboardModeConfig };

interface BoardGroup {
  readonly group: GameModeGroup;
  readonly modes: readonly BoardMode[];
}

/** Every mode with a board, in the shell's Clues / Map / Street View order. */
const BOARD_GROUPS: readonly BoardGroup[] = GAME_MODE_GROUPS.map((group) => ({
  group,
  modes: group.modes.flatMap((mode) => {
    const config = leaderboardConfig(mode.id);
    return config ? [{ ...mode, config }] : [];
  }),
})).filter((entry) => entry.modes.length > 0);

const BOARD_MODES: readonly BoardMode[] = BOARD_GROUPS.flatMap((entry) => entry.modes);

/** The board API (GET /api/leaderboard): time boards carry `timeMs`, score boards `score`. */
interface BoardEntry {
  readonly rank: number;
  readonly userId: string;
  readonly displayName: string;
  readonly avatarEmoji: string | null;
  readonly timeMs?: number;
  readonly score?: number;
  readonly achievedAt: number;
}

interface BoardStanding {
  readonly rank: number;
  readonly timeMs?: number;
  readonly score?: number;
}

interface BoardResponse {
  readonly metric?: LeaderboardMetric;
  readonly entries: readonly BoardEntry[];
  readonly currentUser: BoardStanding | null;
}

const numberFormat = new Intl.NumberFormat("en-US");

export function createLeaderboardsScreen(options: LeaderboardsScreenOptions): Screen {
  const { shell, storage } = options;
  const controller = new AbortController();
  const signal = controller.signal;
  let destroyed = false;

  const modeInfo = (id: GameModeId): BoardMode => BOARD_MODES.find((mode) => mode.id === id) ?? BOARD_MODES[0]!;
  let selected: BoardMode = modeInfo(options.mode && BOARD_MODES.some((mode) => mode.id === options.mode) ? options.mode : BOARD_MODES[0]!.id);

  /** The variant chosen per mode ("" is the default board; puzzle defaults to its first continent). */
  const variants = new Map<GameModeId, string>();
  {
    // "countries" is the default flag board; the server stores it as "".
    const requested = selected.id === "flags" && options.variant === "countries" ? "" : options.variant;
    if (requested !== undefined && selected.config.variants.includes(requested)) variants.set(selected.id, requested);
  }
  const variantFor = (mode: BoardMode): string => variants.get(mode.id) ?? mode.config.variants[0] ?? "";

  let user: AuthUser | null = null;
  let authKnown = false;

  /** Time modes keep a best on this device (per flag set; one for all puzzle continents). */
  function localBest(mode: BoardMode): number | null {
    if (mode.config.metric !== "time" || !isTimerGameModeId(mode.id)) return null;
    const variant = variantFor(mode);
    return readStoredTime(storage, timerKeysForMode(mode.id, mode.id === "flags" && (variant === "territories" || variant === "both") ? variant : "countries").best);
  }

  function formatValue(mode: BoardMode, value: { readonly timeMs?: number; readonly score?: number }): string {
    if (mode.config.metric === "time") return typeof value.timeMs === "number" ? formatElapsedTime(value.timeMs) : "—";
    return typeof value.score === "number" ? numberFormat.format(value.score) : "—";
  }

  /** "1:02.3" for times; "38,420 / 50,000" (the max quieter) for scores. */
  function valueNode(mode: BoardMode, value: { readonly timeMs?: number; readonly score?: number }, className: string): HTMLElement {
    const node = el("span", { className, children: [el("span", { className: "lb-value-main", text: formatValue(mode, value) })] });
    if (mode.config.metric === "score" && mode.config.maxScore) {
      node.append(el("span", { className: "lb-value-max", text: ` / ${numberFormat.format(mode.config.maxScore)}` }));
    }
    return node;
  }

  // ---------- Mode picker ----------

  const modeButtons = new Map<GameModeId, HTMLButtonElement>();
  const picker = el("nav", {
    className: "lb-modes",
    attrs: { "aria-label": "Leaderboard modes" },
    children: BOARD_GROUPS.map(({ group, modes }) =>
      el("div", {
        className: "lb-modes-group",
        attrs: { "data-group": group.id, role: "group", "aria-label": group.label },
        children: [
          el("span", { className: "lb-modes-label", text: group.label, attrs: { "aria-hidden": "true" } }),
          el("div", {
            className: "lb-modes-list",
            children: modes.map((mode) => {
              const button = el("button", {
                className: "lb-mode",
                attrs: { type: "button", "data-mode": mode.id, "data-group": group.id, "aria-pressed": "false" },
                children: [el("span", { className: "lb-mode-icon", children: [shellIcon(mode.icon, 16, 1.9)] }), el("span", { className: "lb-mode-name", text: mode.label })],
                on: { click: () => select(mode.id) },
              });
              modeButtons.set(mode.id, button);
              return button;
            }),
          }),
        ],
      }),
    ),
  });

  function renderPicker(): void {
    for (const [id, button] of modeButtons) {
      const active = id === selected.id;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-selected", active);
    }
  }

  // ---------- Board header: mode, one line, the call to action ----------

  const headIcon = el("span", { className: "lb-board-icon" });
  const eyebrow = el("p", { className: "lb-eyebrow" });
  const title = el("h2", { className: "lb-title", attrs: { id: "lb-mode-title", tabindex: "-1" } });
  const attempt = el("p", { className: "lb-attempt" });
  const standingLine = el("p", { className: "lb-standing", attrs: { "aria-live": "polite" } });
  const playLabel = el("span");
  const playIcon = el("span", { className: "lb-play-icon" });
  const playButton = el("button", {
    className: "shell-btn shell-btn-primary lb-play",
    attrs: { type: "button" },
    children: [playIcon, playLabel],
    on: { click: () => shell.openGame(selected.id, "timed", variantFor(selected) || undefined) },
  });
  const practiseLink = el("button", {
    className: "lb-link lb-practise",
    text: "or practise first",
    attrs: { type: "button" },
    on: { click: () => shell.openGame(selected.id, "practice") },
  });
  const variantHost = el("div", { className: "lb-variants" });

  const boardHead = el("header", {
    className: "lb-board-head",
    children: [
      el("div", {
        className: "lb-board-intro",
        children: [headIcon, el("div", { className: "lb-board-copy", children: [eyebrow, title, attempt, standingLine] })],
      }),
      el("div", { className: "lb-cta", children: [playButton, practiseLink] }),
    ],
  });

  function renderVariants(): void {
    const choices = selected.config.variants;
    if (choices.length < 2) {
      variantHost.hidden = true;
      variantHost.replaceChildren();
      return;
    }
    variantHost.hidden = false;
    if (selected.id === "geoguessr") {
      const select = el("select", { className: "lb-map-select", attrs: { "aria-label": "Map leaderboard" }, children: GEO_GAME_MAPS.map(map => el("option", { text: map.name, attrs: { value: map.id } })) });
      select.value = variantFor(selected);
      select.addEventListener("change", () => selectVariant(select.value), { signal });
      variantHost.replaceChildren(el("label", { className: "lb-variants-label", text: "Map", children: [select] }));
      return;
    }
    const label = selected.id === "flags" ? "Flag set" : selected.id === "puzzle" ? "Continent" : "Board";
    const current = variantFor(selected);
    variantHost.replaceChildren(
      el("span", { className: "lb-variants-label", text: label, attrs: { id: "lb-variant-label" } }),
      el("div", {
        className: "lb-segments",
        attrs: { role: "radiogroup", "aria-labelledby": "lb-variant-label" },
        children: choices.map((choice) =>
          el("button", {
            className: `lb-segment${choice === current ? " is-selected" : ""}`,
            text: VARIANT_LABELS[choice] ?? choice,
            attrs: { type: "button", role: "radio", "aria-checked": String(choice === current), "data-variant": choice },
            on: { click: () => selectVariant(choice) },
          }),
        ),
      }),
    );
  }

  function renderHead(): void {
    const group = BOARD_GROUPS.find((entry) => entry.modes.includes(selected))!.group;
    const metric = selected.config.metric;
    boardCard.dataset.group = group.id;
    boardCard.dataset.metric = metric;
    headIcon.replaceChildren(shellIcon(selected.icon, 24, 1.8));
    eyebrow.textContent = `${group.label} · ${metric === "time" ? "Fastest time wins" : "Highest score wins"}`;
    title.textContent = selected.label;
    attempt.textContent = selected.config.attempt;
    const single = selected.config.runs === "single";
    // Single-run modes have no practice: "Play GeoGuessr" opens the one game, whose best posts.
    playLabel.textContent = single ? `Play ${selected.label}` : PLAY_LABELS[metric];
    practiseLink.hidden = single;
    if (!single) practiseLink.textContent = runLabels(selected.id).practice === "Custom" ? "or play with custom settings" : "or practise first";
    playIcon.replaceChildren(shellIcon(metric === "time" ? "timer" : "play", 18, 2.1));
    renderVariants();
    renderStanding();
  }

  /** One slim line: your rank and best on this board, or (guests) the way to post. */
  function renderStanding(): void {
    const parts: Node[] = [];
    const local = localBest(selected);
    if (user) {
      if (boardLoadedKey === boardKey() && boardUser) {
        parts.push(
          el("span", { className: "lb-standing-rank", text: `#${numberFormat.format(boardUser.rank)}` }),
          el("span", { text: "Your best " }),
          el("strong", { text: formatValue(selected, boardUser) }),
        );
      } else if (boardLoadedKey === boardKey()) {
        parts.push(el("span", { text: "You're not on this board yet." }));
      }
    } else if (authKnown || !shell.signedIn()) {
      if (local !== null) parts.push(el("span", { text: "Best on this device " }), el("strong", { text: formatElapsedTime(local) }));
      parts.push(
        el("button", {
          className: "lb-link lb-guest-note",
          attrs: { type: "button" },
          children: [shellIcon("user-round", 14, 2), el("span", { text: "Sign in to post your scores" })],
          on: { click: () => shell.openAccount() },
        }),
      );
    }
    standingLine.replaceChildren(...parts);
    standingLine.hidden = parts.length === 0;
  }

  // ---------- Board ----------

  const boardState = el("div", { className: "lb-board-state", attrs: { role: "status", "aria-live": "polite" } });
  const podium = el("ol", { className: "lb-podium", attrs: { "aria-label": "Top three" } });
  const boardColumns = el("div", { className: "lb-board-columns", attrs: { "aria-hidden": "true" } });
  const boardList = el("ol", { className: "lb-board-list", attrs: { "aria-labelledby": "lb-mode-title" } });
  const moreButton = el("button", { className: "shell-btn shell-btn-quiet lb-more", text: "Show more", attrs: { type: "button", hidden: "" }, on: { click: () => void loadBoard(false) } });
  const boardBody = el("div", { className: "lb-board-body", children: [boardState, podium, boardColumns, boardList, moreButton] });
  const boardCard = el("section", {
    className: "lb-board",
    attrs: { "aria-labelledby": "lb-mode-title", "aria-busy": "false" },
    children: [boardHead, variantHost, boardBody],
  });

  let boardEntries: BoardEntry[] = [];
  let boardUser: BoardStanding | null = null;
  let boardRequest = 0;
  /** `mode|variant` of the board currently shown, once its first page has arrived. */
  let boardLoadedKey: string | null = null;
  const boardKey = (): string => `${selected.id}|${variantFor(selected)}`;

  function avatar(entry: Pick<BoardEntry, "avatarEmoji" | "displayName">, className = "lb-avatar"): HTMLElement {
    return entry.avatarEmoji
      ? el("span", { className: `${className} is-emoji`, text: entry.avatarEmoji, attrs: { "aria-hidden": "true" } })
      : el("span", { className, text: entry.displayName.charAt(0).toUpperCase(), attrs: { "aria-hidden": "true" } });
  }

  function youTag(): HTMLElement {
    return el("span", { className: "lb-you", text: "You" });
  }

  function row(entry: BoardEntry, isYou: boolean, pinned = false): HTMLElement {
    const name = el("span", { className: "lb-row-name", children: [el("span", { className: "lb-row-display", text: entry.displayName })] });
    if (isYou) name.append(youTag());
    return el("li", {
      className: `lb-row${isYou ? " is-you" : ""}${pinned ? " is-pinned" : ""}`,
      attrs: { "data-rank": String(entry.rank) },
      children: [
        el("span", { className: "lb-row-rank", text: numberFormat.format(entry.rank), attrs: { "aria-label": `Rank ${entry.rank}` } }),
        avatar(entry),
        name,
        valueNode(selected, entry, "lb-row-value"),
      ],
    });
  }

  function podiumStep(entry: BoardEntry | null, rank: number, isYou: boolean): HTMLElement {
    if (!entry) {
      return el("li", {
        className: `lb-podium-step is-rank-${rank} is-open`,
        attrs: { "data-rank": String(rank) },
        children: [
          el("span", { className: "lb-podium-avatar is-open", attrs: { "aria-hidden": "true" }, children: [shellIcon("trophy", 20, 1.7)] }),
          el("span", { className: "lb-podium-name", text: "Up for grabs" }),
          el("span", { className: "lb-podium-block", children: [el("span", { className: "lb-podium-rank", text: String(rank) })] }),
        ],
      });
    }
    return el("li", {
      className: `lb-podium-step is-rank-${rank}${isYou ? " is-you" : ""}`,
      attrs: { "data-rank": String(rank) },
      children: [
        avatar(entry, "lb-podium-avatar"),
        el("span", { className: "lb-podium-name", children: [el("span", { className: "lb-podium-display", text: entry.displayName }), ...(isYou ? [youTag()] : [])] }),
        valueNode(selected, entry, "lb-podium-value"),
        el("span", { className: "lb-podium-block", children: [el("span", { className: "lb-podium-rank", text: String(rank), attrs: { "aria-label": `Rank ${rank}` } })] }),
      ],
    });
  }

  function renderBoard(): void {
    const youId = user?.id ?? null;
    const top = [1, 2, 3].map((rank) => boardEntries.find((entry) => entry.rank === rank) ?? null);
    const hasPodium = top.some(Boolean);
    // Visual order 2 · 1 · 3; the list order (and screen readers) stay 1 · 2 · 3 via CSS order.
    podium.replaceChildren(...(hasPodium ? top.map((entry, index) => podiumStep(entry, index + 1, entry !== null && entry.userId === youId)) : []));
    podium.hidden = !hasPodium;

    const rest = boardEntries.filter((entry) => entry.rank > 3);
    const rows = rest.map((entry) => row(entry, entry.userId === youId));
    // You're on the board but below the rows shown: pin your row under a gap.
    if (user && boardUser && !boardEntries.some((entry) => entry.userId === user!.id)) {
      rows.push(el("li", { className: "lb-row-gap", attrs: { "aria-hidden": "true" }, text: "···" }));
      rows.push(row({ rank: boardUser.rank, userId: user.id, displayName: user.displayName, avatarEmoji: user.avatarEmoji, ...(boardUser.timeMs !== undefined ? { timeMs: boardUser.timeMs } : {}), ...(boardUser.score !== undefined ? { score: boardUser.score } : {}), achievedAt: 0 }, true, true));
    }
    boardList.replaceChildren(...rows);
    boardList.hidden = rows.length === 0;
    boardColumns.replaceChildren(el("span", { text: "Rank" }), el("span", { text: "Player" }), el("span", {
      text: selected.config.metric === "time" ? "Time" : "Score",
      children: selected.config.maxScore ? [el("span", { className: "lb-columns-max", text: ` / ${numberFormat.format(selected.config.maxScore)}` })] : [],
    }));
    boardColumns.hidden = rest.length === 0;
  }

  function showBoardState(kind: "loading" | "empty" | "error" | "none"): void {
    boardCard.setAttribute("aria-busy", String(kind === "loading"));
    boardCard.dataset.state = kind;
    if (kind === "none") {
      boardState.replaceChildren();
      boardState.hidden = true;
      return;
    }
    boardState.hidden = false;
    if (kind === "loading") {
      boardState.replaceChildren(
        el("span", { className: "lb-sr", text: "Loading the leaderboard…" }),
        el("div", {
          className: "lb-skeleton",
          attrs: { "aria-hidden": "true" },
          children: [
            el("div", { className: "lb-skeleton-podium", children: [el("span"), el("span"), el("span")] }),
            ...Array.from({ length: 5 }, () => el("span", { className: "lb-skeleton-row" })),
          ],
        }),
      );
      return;
    }
    if (kind === "empty") {
      const time = selected.config.metric === "time";
      boardState.replaceChildren(
        el("div", {
          className: "lb-empty",
          children: [
            el("span", { className: "lb-empty-icon", children: [shellIcon("trophy", 28, 1.6)] }),
            el("strong", { text: time ? "No times on this board yet" : "No scores on this board yet" }),
            el("span", { text: time ? "Finish a timed run to take first place." : selected.config.runs === "single" ? "Finish a run to take first place." : "Play a ranked attempt to take first place." }),
          ],
        }),
      );
      return;
    }
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    boardState.replaceChildren(
      el("div", {
        className: "lb-empty is-error",
        children: [
          el("strong", { text: offline ? "You're offline" : "Couldn't load the leaderboard" }),
          el("span", { text: offline ? "Boards need a connection. You can still play; reconnect to post." : "Check your connection and try again." }),
          el("button", { className: "shell-btn shell-btn-quiet lb-retry", text: "Try again", attrs: { type: "button" }, on: { click: () => void loadBoard(true) } }),
        ],
      }),
    );
  }

  async function loadBoard(reset: boolean): Promise<void> {
    const request = ++boardRequest;
    const mode = selected;
    const variant = variantFor(mode);
    const offset = reset ? 0 : boardEntries.length;
    if (reset) {
      boardLoadedKey = null;
      boardEntries = [];
      boardUser = null;
      renderBoard();
      podium.hidden = true;
      boardColumns.hidden = true;
      moreButton.hidden = true;
      renderStanding();
      showBoardState("loading");
    } else {
      moreButton.disabled = true;
      moreButton.textContent = "Loading…";
    }

    const response = (await fetchLeaderboard(mode.id, variant, LEADERBOARD_PAGE_SIZE, offset)) as BoardResponse | null;
    if (destroyed || request !== boardRequest) return;

    moreButton.disabled = false;
    moreButton.textContent = "Show more";
    if (!response) {
      if (reset) showBoardState("error");
      else moreButton.textContent = "Couldn't load more. Try again";
      return;
    }

    boardEntries = reset ? [...response.entries] : [...boardEntries, ...response.entries.filter((entry) => entry.rank > (boardEntries.at(-1)?.rank ?? 0))];
    boardUser = response.currentUser ?? null;
    boardLoadedKey = `${mode.id}|${variant}`;
    moreButton.hidden = response.entries.length < LEADERBOARD_PAGE_SIZE;
    showBoardState(boardEntries.length === 0 ? "empty" : "none");
    renderBoard();
    renderStanding();
  }

  // ---------- Selection ----------

  function select(id: GameModeId): void {
    if (id === selected.id) return;
    selected = modeInfo(id);
    renderAll();
    options.onSelect?.(selected.id, variantFor(selected));
    void loadBoard(true);
    revealSelectedMode();
  }

  /** On phones the picker scrolls sideways: keep the chosen chip in view (without scrolling the page). */
  function revealSelectedMode(): void {
    const chip = modeButtons.get(selected.id);
    if (!chip || picker.scrollWidth <= picker.clientWidth) return;
    const left = chip.offsetLeft - (picker.clientWidth - chip.offsetWidth) / 2;
    picker.scrollTo?.({ left: Math.max(0, left), behavior: "smooth" });
  }

  function selectVariant(variant: string): void {
    if (variant === variantFor(selected) || !selected.config.variants.includes(variant)) return;
    variants.set(selected.id, variant);
    renderAll();
    options.onSelect?.(selected.id, variant);
    void loadBoard(true);
  }

  function renderAll(): void {
    renderPicker();
    renderHead();
  }

  function applyAuth(next: AuthUser | null): void {
    user = next;
    authKnown = true;
    renderStanding();
  }

  // ---------- Leaderboards: every mode's board, one call to action ----------

  const leaderboardsPanel = el("div", { className: "lb-lb", children: [picker, boardCard] });

  // ---------- Page ----------

  const page = createSitePage(shell, {
    section: "leaderboards",
    id: "leaderboards",
    className: "leaderboards-page",
    title: "Leaderboards",
    subtitle: "Every mode's global board. Play a ranked attempt to post your time or score.",
    content: [leaderboardsPanel],
  });

  renderAll();
  void loadBoard(true);
  requestAnimationFrame(() => revealSelectedMode());
  const syncAuth = (): void => void fetchAuthState().then((state) => {
    if (destroyed) return;
    applyAuth(state.user);
    // The board response already carries your standing (the session cookie rides along), so a
    // board that arrived before the auth check only needs re-rendering, not re-fetching.
    renderBoard();
  });
  syncAuth();
  // Signing in or out from the header while here swaps the guest note, your row and friends.
  const unsubscribeAuth = shell.onAuthChange?.(() => {
    if (!authKnown || shell.signedIn() !== (user !== null)) {
      syncAuth();
      void loadBoard(true);
    }
  });

  // Local bests can change in another tab (a timed run finished there).
  window.addEventListener("storage", () => renderStanding(), { signal });

  return {
    element: page.element,
    destroy: () => {
      destroyed = true;
      controller.abort();
      unsubscribeAuth?.();
      page.destroy();
    },
  };
}
