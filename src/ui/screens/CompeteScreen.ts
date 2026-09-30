import { fetchAuthState, fetchFriends, fetchLeaderboard, type AuthUser, type FriendInfo } from "../../core/auth";
import { cleanJoinCode, MAX_PLAYER_NAME_LENGTH, readActiveRoomCode, readPlayerName, writePlayerName } from "../../core/multiplayer/localPlayer";
import { GAME_MODE_GROUPS, isTimerGameModeId, type GameModeCatalogueEntry, type GameModeGroup, type GameModeId } from "../../core/gameModes";
import { leaderboardConfig, type LeaderboardMetric, type LeaderboardModeConfig } from "../../core/leaderboards";
import { timerKeysForMode } from "../../core/timer/keys";
import { formatElapsedTime, readStoredTime } from "../../core/timer/playTimer";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createSitePage, shellIcon, type ShellContext } from "../shell";
import "../../styles/compete.css";

/*
 * Compete (docs/navigation.md → "Compete"): two clearly different ways to play for keeps, as tabs.
 *
 *   Multiplayer (default) — a live match with friends: create a room, join with a code, invite
 *                           friends who are online. Guests can play (they pick a name).
 *   Leaderboards          — every mode's global board (src/core/leaderboards.ts), with one call to
 *                           action: play a ranked attempt. Time boards rank the fastest run, score
 *                           boards the highest total from one fixed-length attempt.
 */

export type CompeteTab = "multiplayer" | "leaderboards";

export interface CompeteRoomRequest {
  /** Invite this friend (user id) as soon as the new room exists. */
  readonly inviteUserId?: string;
}

export interface CompeteScreenOptions {
  readonly shell: ShellContext;
  readonly storage: Storage;
  /** Mode to open on (from `?mode=`). Unknown modes fall back to the first board. */
  readonly mode?: GameModeId;
  /** Variant to open on (from `?variant=`): "territories" / "both" for flags, a continent for puzzle. */
  readonly variant?: string;
  /** Called when the player picks another board or variant. App mirrors it into the URL with history *replace*. */
  readonly onSelect?: (mode: GameModeId, variant: string) => void;
  /** Tab to open on. Default: Leaderboards when a `mode` is given (old board links), else Multiplayer. */
  readonly tab?: CompeteTab;
  /** Called when the player switches tab (App replaces the URL). Leaderboards passes the board shown. */
  readonly onTab?: (tab: CompeteTab, mode: GameModeId, variant: string) => void;
  /** Opens the full multiplayer setup (modes, rounds, timer) without creating a room yet. */
  readonly onMultiplayer?: () => void;
  /** Opens the lobby straight into a new room with the default settings. The name is already saved. */
  readonly onCreateRoom?: (request?: CompeteRoomRequest) => void;
  /** Joins a room by code (`?room=CODE`). The name is already saved. */
  readonly onJoinRoom?: (code: string) => void;
  /** Reopens the room this tab is still seated in (the lobby reconnects on its own). */
  readonly onRejoinRoom?: () => void;
  /** Opens the Friends page (You › Friends). */
  readonly onFriends?: () => void;
  /** Live presence / friend-list changes; the listener refetches friends. Returns an unsubscribe. */
  readonly subscribeFriends?: (listener: () => void) => () => void;
}

/** The settings a room made with "Create a room" starts with (the lobby's defaults). */
export const QUICK_ROOM_SUMMARY = "Flags · 10 rounds · 30 seconds each";

/** Rows per board page ("Show more" fetches the next page). */
export const COMPETE_PAGE_SIZE = 20;

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

export function createCompeteScreen(options: CompeteScreenOptions): Screen {
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
    const node = el("span", { className, children: [el("span", { className: "compete-value-main", text: formatValue(mode, value) })] });
    if (mode.config.metric === "score" && mode.config.maxScore) {
      node.append(el("span", { className: "compete-value-max", text: ` / ${numberFormat.format(mode.config.maxScore)}` }));
    }
    return node;
  }

  // ---------- Mode picker ----------

  const modeButtons = new Map<GameModeId, HTMLButtonElement>();
  const picker = el("nav", {
    className: "compete-modes",
    attrs: { "aria-label": "Leaderboard modes" },
    children: BOARD_GROUPS.map(({ group, modes }) =>
      el("div", {
        className: "compete-modes-group",
        attrs: { "data-group": group.id, role: "group", "aria-label": group.label },
        children: [
          el("span", { className: "compete-modes-label", text: group.label, attrs: { "aria-hidden": "true" } }),
          el("div", {
            className: "compete-modes-list",
            children: modes.map((mode) => {
              const button = el("button", {
                className: "compete-mode",
                attrs: { type: "button", "data-mode": mode.id, "data-group": group.id, "aria-pressed": "false" },
                children: [el("span", { className: "compete-mode-icon", children: [shellIcon(mode.icon, 16, 1.9)] }), el("span", { className: "compete-mode-name", text: mode.label })],
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

  const headIcon = el("span", { className: "compete-board-icon" });
  const eyebrow = el("p", { className: "compete-eyebrow" });
  const title = el("h2", { className: "compete-title", attrs: { id: "compete-mode-title", tabindex: "-1" } });
  const attempt = el("p", { className: "compete-attempt" });
  const standingLine = el("p", { className: "compete-standing", attrs: { "aria-live": "polite" } });
  const playLabel = el("span");
  const playIcon = el("span", { className: "compete-play-icon" });
  const playButton = el("button", {
    className: "shell-btn shell-btn-primary compete-play",
    attrs: { type: "button" },
    children: [playIcon, playLabel],
    on: { click: () => shell.openGame(selected.id, "timed", variantFor(selected) || undefined) },
  });
  const practiseLink = el("button", {
    className: "compete-link compete-practise",
    text: "or practise first",
    attrs: { type: "button" },
    on: { click: () => shell.openGame(selected.id, "practice") },
  });
  const variantHost = el("div", { className: "compete-variants" });

  const boardHead = el("header", {
    className: "compete-board-head",
    children: [
      el("div", {
        className: "compete-board-intro",
        children: [headIcon, el("div", { className: "compete-board-copy", children: [eyebrow, title, attempt, standingLine] })],
      }),
      el("div", { className: "compete-cta", children: [playButton, practiseLink] }),
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
    const label = selected.id === "flags" ? "Flag set" : selected.id === "puzzle" ? "Continent" : "Board";
    const current = variantFor(selected);
    variantHost.replaceChildren(
      el("span", { className: "compete-variants-label", text: label, attrs: { id: "compete-variant-label" } }),
      el("div", {
        className: "compete-segments",
        attrs: { role: "radiogroup", "aria-labelledby": "compete-variant-label" },
        children: choices.map((choice) =>
          el("button", {
            className: `compete-segment${choice === current ? " is-selected" : ""}`,
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
    playLabel.textContent = PLAY_LABELS[metric];
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
          el("span", { className: "compete-standing-rank", text: `#${numberFormat.format(boardUser.rank)}` }),
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
          className: "compete-link compete-guest-note",
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

  const boardState = el("div", { className: "compete-board-state", attrs: { role: "status", "aria-live": "polite" } });
  const podium = el("ol", { className: "compete-podium", attrs: { "aria-label": "Top three" } });
  const boardColumns = el("div", { className: "compete-board-columns", attrs: { "aria-hidden": "true" } });
  const boardList = el("ol", { className: "compete-board-list", attrs: { "aria-labelledby": "compete-mode-title" } });
  const moreButton = el("button", { className: "shell-btn shell-btn-quiet compete-more", text: "Show more", attrs: { type: "button", hidden: "" }, on: { click: () => void loadBoard(false) } });
  const boardBody = el("div", { className: "compete-board-body", children: [boardState, podium, boardColumns, boardList, moreButton] });
  const boardCard = el("section", {
    className: "compete-board",
    attrs: { "aria-labelledby": "compete-mode-title", "aria-busy": "false" },
    children: [boardHead, variantHost, boardBody],
  });

  let boardEntries: BoardEntry[] = [];
  let boardUser: BoardStanding | null = null;
  let boardRequest = 0;
  /** `mode|variant` of the board currently shown, once its first page has arrived. */
  let boardLoadedKey: string | null = null;
  const boardKey = (): string => `${selected.id}|${variantFor(selected)}`;

  function avatar(entry: Pick<BoardEntry, "avatarEmoji" | "displayName">, className = "compete-avatar"): HTMLElement {
    return entry.avatarEmoji
      ? el("span", { className: `${className} is-emoji`, text: entry.avatarEmoji, attrs: { "aria-hidden": "true" } })
      : el("span", { className, text: entry.displayName.charAt(0).toUpperCase(), attrs: { "aria-hidden": "true" } });
  }

  function youTag(): HTMLElement {
    return el("span", { className: "compete-you", text: "You" });
  }

  function row(entry: BoardEntry, isYou: boolean, pinned = false): HTMLElement {
    const name = el("span", { className: "compete-row-name", children: [el("span", { className: "compete-row-display", text: entry.displayName })] });
    if (isYou) name.append(youTag());
    return el("li", {
      className: `compete-row${isYou ? " is-you" : ""}${pinned ? " is-pinned" : ""}`,
      attrs: { "data-rank": String(entry.rank) },
      children: [
        el("span", { className: "compete-row-rank", text: numberFormat.format(entry.rank), attrs: { "aria-label": `Rank ${entry.rank}` } }),
        avatar(entry),
        name,
        valueNode(selected, entry, "compete-row-value"),
      ],
    });
  }

  function podiumStep(entry: BoardEntry | null, rank: number, isYou: boolean): HTMLElement {
    if (!entry) {
      return el("li", {
        className: `compete-podium-step is-rank-${rank} is-open`,
        attrs: { "data-rank": String(rank) },
        children: [
          el("span", { className: "compete-podium-avatar is-open", attrs: { "aria-hidden": "true" }, children: [shellIcon("trophy", 20, 1.7)] }),
          el("span", { className: "compete-podium-name", text: "Up for grabs" }),
          el("span", { className: "compete-podium-block", children: [el("span", { className: "compete-podium-rank", text: String(rank) })] }),
        ],
      });
    }
    return el("li", {
      className: `compete-podium-step is-rank-${rank}${isYou ? " is-you" : ""}`,
      attrs: { "data-rank": String(rank) },
      children: [
        avatar(entry, "compete-podium-avatar"),
        el("span", { className: "compete-podium-name", children: [el("span", { className: "compete-podium-display", text: entry.displayName }), ...(isYou ? [youTag()] : [])] }),
        valueNode(selected, entry, "compete-podium-value"),
        el("span", { className: "compete-podium-block", children: [el("span", { className: "compete-podium-rank", text: String(rank), attrs: { "aria-label": `Rank ${rank}` } })] }),
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
      rows.push(el("li", { className: "compete-row-gap", attrs: { "aria-hidden": "true" }, text: "···" }));
      rows.push(row({ rank: boardUser.rank, userId: user.id, displayName: user.displayName, avatarEmoji: user.avatarEmoji, ...(boardUser.timeMs !== undefined ? { timeMs: boardUser.timeMs } : {}), ...(boardUser.score !== undefined ? { score: boardUser.score } : {}), achievedAt: 0 }, true, true));
    }
    boardList.replaceChildren(...rows);
    boardList.hidden = rows.length === 0;
    boardColumns.replaceChildren(el("span", { text: "Rank" }), el("span", { text: "Player" }), el("span", {
      text: selected.config.metric === "time" ? "Time" : "Score",
      children: selected.config.maxScore ? [el("span", { className: "compete-columns-max", text: ` / ${numberFormat.format(selected.config.maxScore)}` })] : [],
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
        el("span", { className: "compete-sr", text: "Loading the leaderboard…" }),
        el("div", {
          className: "compete-skeleton",
          attrs: { "aria-hidden": "true" },
          children: [
            el("div", { className: "compete-skeleton-podium", children: [el("span"), el("span"), el("span")] }),
            ...Array.from({ length: 5 }, () => el("span", { className: "compete-skeleton-row" })),
          ],
        }),
      );
      return;
    }
    if (kind === "empty") {
      const time = selected.config.metric === "time";
      boardState.replaceChildren(
        el("div", {
          className: "compete-empty",
          children: [
            el("span", { className: "compete-empty-icon", children: [shellIcon("trophy", 28, 1.6)] }),
            el("strong", { text: time ? "No times on this board yet" : "No scores on this board yet" }),
            el("span", { text: time ? "Finish a timed run to take first place." : "Play a ranked attempt to take first place." }),
          ],
        }),
      );
      return;
    }
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    boardState.replaceChildren(
      el("div", {
        className: "compete-empty is-error",
        children: [
          el("strong", { text: offline ? "You're offline" : "Couldn't load the leaderboard" }),
          el("span", { text: offline ? "Boards need a connection. You can still play; reconnect to post." : "Check your connection and try again." }),
          el("button", { className: "shell-btn shell-btn-quiet compete-retry", text: "Try again", attrs: { type: "button" }, on: { click: () => void loadBoard(true) } }),
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

    const response = (await fetchLeaderboard(mode.id, variant, COMPETE_PAGE_SIZE, offset)) as BoardResponse | null;
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
    moreButton.hidden = response.entries.length < COMPETE_PAGE_SIZE;
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

  // ---------- Multiplayer: live match with friends ----------

  const canCreate = typeof options.onCreateRoom === "function";
  const nameId = "compete-mp-name";
  const nameInput = el("input", {
    className: "compete-input compete-name-input",
    attrs: {
      id: nameId,
      type: "text",
      autocomplete: "nickname",
      maxlength: String(MAX_PLAYER_NAME_LENGTH),
      placeholder: "e.g. Sam",
      enterkeyhint: "done",
      value: readPlayerName(storage) ?? "",
    },
  });
  const nameError = el("p", { className: "compete-field-error", attrs: { id: `${nameId}-error`, role: "alert", hidden: "" } });
  const nameField = el("div", {
    className: "compete-name-field",
    children: [
      el("label", { className: "compete-field-label", text: "Your name", attrs: { for: nameId } }),
      nameInput,
      el("span", { className: "compete-field-hint", text: "Shown to everyone in the room. No account needed." }),
      nameError,
    ],
  });
  const playingAs = el("p", { className: "compete-playing-as", attrs: { hidden: "" } });

  /** Guests need a name before they can create or join; signed-in players use their account name. */
  function claimName(): boolean {
    if (user) return true;
    const value = nameInput.value.trim();
    if (!value) {
      nameError.textContent = "Pick a name first, so friends know who's who.";
      nameError.hidden = false;
      nameInput.setAttribute("aria-invalid", "true");
      nameInput.setAttribute("aria-describedby", `${nameId}-error`);
      nameInput.focus();
      return false;
    }
    writePlayerName(storage, value);
    return true;
  }
  nameInput.addEventListener("input", () => {
    if (nameError.hidden) return;
    nameError.hidden = true;
    nameInput.removeAttribute("aria-invalid");
    nameInput.removeAttribute("aria-describedby");
  }, { signal });

  const createRoom = (request?: CompeteRoomRequest): void => {
    if (!claimName()) return;
    options.onCreateRoom?.(request);
  };

  const createButton = el("button", {
    className: "shell-btn compete-create",
    attrs: { type: "button" },
    children: [shellIcon("users", 20, 2), el("span", { text: "Create a room" })],
    on: { click: () => createRoom() },
  });

  const joinId = "compete-join-code";
  const joinInput = el("input", {
    className: "compete-input compete-join-input",
    attrs: {
      id: joinId,
      type: "text",
      autocomplete: "off",
      autocapitalize: "characters",
      spellcheck: "false",
      maxlength: "64",
      placeholder: "ABCDE",
      enterkeyhint: "go",
      "aria-describedby": `${joinId}-hint`,
    },
  });
  const joinHint = el("span", { className: "compete-field-hint", text: "Paste a code or an invite link.", attrs: { id: `${joinId}-hint` } });
  const joinForm = el("form", {
    className: "compete-join",
    attrs: { "aria-label": "Join a room with a code" },
    children: [
      el("label", { className: "compete-field-label", text: "Have a code?", attrs: { for: joinId } }),
      el("div", {
        className: "compete-join-row",
        children: [
          joinInput,
          el("button", { className: "shell-btn compete-join-button", attrs: { type: "submit" }, children: [el("span", { text: "Join" }), shellIcon("arrow-right", 16, 2)] }),
        ],
      }),
      joinHint,
    ],
  });
  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = cleanJoinCode(joinInput.value);
    if (code.length < 4) {
      joinHint.textContent = "Room codes are 5 letters and numbers, like K7QMR.";
      joinHint.classList.add("is-error");
      joinInput.setAttribute("aria-invalid", "true");
      joinInput.focus();
      return;
    }
    joinInput.value = code;
    if (!claimName()) return;
    options.onJoinRoom?.(code);
  }, { signal });
  joinInput.addEventListener("input", () => {
    joinHint.textContent = "Paste a code or an invite link.";
    joinHint.classList.remove("is-error");
    joinInput.removeAttribute("aria-invalid");
  }, { signal });

  const activeRoom = readActiveRoomCode();
  const rejoin = activeRoom && options.onRejoinRoom
    ? el("div", {
        className: "compete-rejoin",
        attrs: { role: "status" },
        children: [
          el("span", { className: "compete-live-dot", attrs: { "aria-hidden": "true" } }),
          el("span", { className: "compete-rejoin-copy", children: [el("strong", { text: `You're still in room ${activeRoom}` }), el("span", { text: "Head back in before the others start without you." })] }),
          el("button", {
            className: "shell-btn compete-rejoin-action",
            attrs: { type: "button" },
            children: [el("span", { text: "Back to room" }), shellIcon("arrow-right", 16, 2)],
            on: { click: () => options.onRejoinRoom?.() },
          }),
        ],
      })
    : null;

  // Decorative: a live scoreboard mid-race, so the card reads as "a match with people" at a glance.
  const heroArt = el("div", {
    className: "compete-mp-art",
    attrs: { "aria-hidden": "true" },
    children: [
      el("div", { className: "compete-mp-art-head", children: [el("span", { className: "compete-live-dot" }), el("span", { text: "Round 4 of 10" })] }),
      ...[
        { emoji: "🦊", name: "Ana", points: 420, width: 92 },
        { emoji: "🐼", name: "Ben", points: 385, width: 80 },
        { emoji: "🦉", name: "You", points: 360, width: 74 },
        { emoji: "🐢", name: "Kofi", points: 240, width: 50 },
      ].map((player, index) =>
        el("div", {
          className: `compete-mp-art-row${player.name === "You" ? " is-you" : ""}`,
          attrs: { style: `--bar: ${player.width}%; --i: ${index}` },
          children: [
            el("span", { className: "compete-mp-art-emoji", text: player.emoji }),
            el("span", { className: "compete-mp-art-name", text: player.name }),
            el("span", { className: "compete-mp-art-bar" }),
            el("span", { className: "compete-mp-art-points", text: String(player.points) }),
          ],
        }),
      ),
    ],
  });

  const hero = el("article", {
    className: "compete-mp-hero",
    attrs: { "aria-labelledby": "compete-mp-title" },
    children: [
      el("div", {
        className: "compete-mp-intro",
        children: [
          el("p", { className: "compete-kicker is-live", children: [el("span", { className: "compete-live-dot", attrs: { "aria-hidden": "true" } }), el("span", { text: "Live match · 2 to 8 players" })] }),
          el("h2", { className: "compete-mp-title", text: "Play live with friends", attrs: { id: "compete-mp-title" } }),
          el("p", { className: "compete-mp-lede", text: "A real-time race: everyone gets the same question at the same moment, and the first right answer takes the round. Standings update as you play." }),
        ],
      }),
      heroArt,
      el("div", {
        className: "compete-mp-form",
        children: [
          nameField,
          playingAs,
          el("div", {
            className: "compete-create-row",
            children: [
              ...(canCreate ? [createButton] : []),
              el("span", { className: "compete-create-note", children: [el("strong", { text: "Starts as " }), el("span", { text: QUICK_ROOM_SUMMARY }), el("span", { text: ". Change modes once you're in." })] }),
            ],
          }),
          ...(options.onJoinRoom ? [el("div", { className: "compete-or", attrs: { "aria-hidden": "true" }, children: [el("span", { text: "or" })] }), joinForm] : []),
          ...(options.onMultiplayer
            ? [
                el("button", {
                  className: "compete-link compete-custom",
                  attrs: { type: "button" },
                  children: [el("span", { text: "Pick modes, rounds and timer first" }), shellIcon("arrow-right", 15, 2)],
                  on: { click: () => options.onMultiplayer?.() },
                }),
              ]
            : []),
        ],
      }),
    ],
  });

  // Friends online (signed in) with one-tap invites; guests get a sign-in nudge.
  const onlineCount = el("span", { className: "compete-online-count", attrs: { hidden: "" } });
  const onlineBody = el("div", { className: "compete-online-body", attrs: { "aria-live": "polite" } });
  const onlineCard = el("section", {
    className: "compete-card compete-online",
    attrs: { "aria-labelledby": "compete-online-title" },
    children: [
      el("header", { className: "compete-card-head", children: [el("h3", { className: "compete-card-title", text: "Friends online", attrs: { id: "compete-online-title" } }), onlineCount] }),
      onlineBody,
    ],
  });

  let friends: readonly FriendInfo[] | null = null;
  let friendsError = false;
  let friendsRequest = 0;

  function renderFriends(): void {
    const online = (friends ?? []).filter((friend) => friend.online);
    onlineCount.hidden = !user || friends === null || online.length === 0;
    onlineCount.textContent = String(online.length);
    if (!authKnown && !shell.signedIn()) {
      onlineBody.replaceChildren(el("p", { className: "compete-muted", text: "Checking who's around…" }));
      return;
    }
    if (!user) {
      onlineBody.replaceChildren(
        el("p", { className: "compete-muted", text: "Sign in to see which friends are online and invite them straight into your room." }),
        el("button", { className: "shell-btn shell-btn-quiet compete-online-signin", text: "Sign in", attrs: { type: "button" }, on: { click: () => shell.openAccount() } }),
      );
      return;
    }
    if (friends === null) {
      onlineBody.replaceChildren(
        friendsError
          ? el("p", { className: "compete-muted", text: "Couldn't load your friends. You can still create a room and share the code." })
          : el("div", { className: "compete-online-skeleton", attrs: { "aria-hidden": "true" }, children: [el("span"), el("span")] }),
      );
      return;
    }
    if (online.length === 0) {
      const none = friends.length === 0;
      onlineBody.replaceChildren(
        el("p", {
          className: "compete-muted",
          text: none
            ? "Add friends to see when they're online and invite them in one tap."
            : `${friends.length === 1 ? "Your friend isn't" : `None of your ${friends.length} friends are`} online right now. Create a room and send them the code.`,
        }),
        ...(options.onFriends
          ? [el("button", { className: "compete-link", attrs: { type: "button" }, children: [el("span", { text: none ? "Find friends" : "Open Friends" }), shellIcon("arrow-right", 15, 2)], on: { click: () => options.onFriends?.() } })]
          : []),
      );
      return;
    }
    onlineBody.replaceChildren(
      el("ul", {
        className: "compete-online-list",
        children: online.map((friend) =>
          el("li", {
            className: "compete-online-row",
            attrs: { "data-user": friend.user.id },
            children: [
              el("span", { className: `compete-avatar${friend.user.avatarEmoji ? " is-emoji" : ""}`, text: friend.user.avatarEmoji ?? friend.user.username.charAt(0).toUpperCase(), attrs: { "aria-hidden": "true" } }),
              el("span", { className: "compete-online-name", children: [el("span", { className: "compete-online-display", text: friend.user.username }), el("span", { className: "compete-online-status", text: "Online now" })] }),
              ...(canCreate
                ? [
                    el("button", {
                      className: "shell-btn compete-invite",
                      text: "Invite",
                      attrs: { type: "button", "aria-label": `Create a room and invite ${friend.user.username}` },
                      on: { click: () => createRoom({ inviteUserId: friend.user.id }) },
                    }),
                  ]
                : []),
            ],
          }),
        ),
      }),
      ...(canCreate ? [el("p", { className: "compete-online-note", text: "Invite opens a new room and sends them the code." })] : []),
    );
  }

  async function loadFriends(): Promise<void> {
    if (!user) return;
    const request = ++friendsRequest;
    const data = await fetchFriends();
    if (destroyed || request !== friendsRequest) return;
    friendsError = data === null;
    friends = data ? data.friends : friends;
    renderFriends();
  }

  const steps = el("section", {
    className: "compete-card compete-steps",
    attrs: { "aria-labelledby": "compete-steps-title" },
    children: [
      el("h3", { className: "compete-card-title", text: "How a match works", attrs: { id: "compete-steps-title" } }),
      el("ol", {
        className: "compete-steps-list",
        children: [
          ["Open a room", "Mix flags, capitals, maps or Street View."],
          ["Share the code", "Friends join from any device, with or without an account."],
          ["Race every round", "Faster answers and streaks score more. Top score wins."],
        ].map(([title, body], index) =>
          el("li", { children: [el("span", { className: "compete-step-num", text: String(index + 1) }), el("span", { className: "compete-step-copy", children: [el("strong", { text: title! }), el("span", { text: body! })] })] }),
        ),
      }),
    ],
  });

  const soloCross = el("button", {
    className: "compete-cross-band",
    attrs: { type: "button", "data-go-tab": "leaderboards" },
    children: [
      el("span", { className: "compete-cross-icon is-solo", children: [shellIcon("trophy", 20, 1.8)] }),
      el("span", {
        className: "compete-cross-copy",
        children: [el("strong", { text: "Rather go solo? Beat the leaderboard." }), el("span", { text: "A timed attempt against the clock. Your time posts to a global board." })],
      }),
      shellIcon("arrow-right", 18, 2),
    ],
    on: { click: () => setTab("leaderboards", true) },
  });

  const multiplayerPanel = el("section", {
    className: "compete-tabpanel compete-mp",
    attrs: { id: "compete-panel-multiplayer", role: "tabpanel", "aria-labelledby": "compete-tab-multiplayer", tabindex: "-1" },
    children: [
      ...(rejoin ? [rejoin] : []),
      el("div", { className: "compete-mp-grid", children: [hero, el("div", { className: "compete-mp-side", children: [onlineCard, steps] })] }),
      soloCross,
    ],
  });

  function renderPlayer(): void {
    nameField.hidden = user !== null;
    playingAs.hidden = user === null;
    if (user) {
      playingAs.replaceChildren(
        el("span", { className: `compete-avatar${user.avatarEmoji ? " is-emoji" : ""}`, text: user.avatarEmoji ?? user.displayName.charAt(0).toUpperCase(), attrs: { "aria-hidden": "true" } }),
        el("span", { children: [el("span", { className: "compete-muted", text: "Playing as " }), el("strong", { text: user.displayName })] }),
      );
    }
  }
  // ---------- Leaderboards: every mode's board, one call to action ----------

  const leaderboardsPanel = el("section", {
    className: "compete-tabpanel compete-lb",
    attrs: { id: "compete-panel-leaderboards", role: "tabpanel", "aria-labelledby": "compete-tab-leaderboards", tabindex: "-1" },
    children: [picker, boardCard],
  });

  // ---------- Tabs ----------

  const TABS: readonly { readonly id: CompeteTab; readonly label: string; readonly sub: string; readonly icon: "users" | "trophy" }[] = [
    { id: "multiplayer", label: "Multiplayer", sub: "Live match with friends", icon: "users" },
    { id: "leaderboards", label: "Leaderboards", sub: "Solo ranked attempts", icon: "trophy" },
  ];
  const tabButtons = new Map<CompeteTab, HTMLButtonElement>();
  const tabList = el("div", {
    className: "compete-tabs",
    attrs: { role: "tablist", "aria-label": "Ways to compete" },
    children: TABS.map((tab) => {
      const button = el("button", {
        className: `compete-tab is-${tab.id}`,
        attrs: { type: "button", role: "tab", id: `compete-tab-${tab.id}`, "aria-controls": `compete-panel-${tab.id}`, "data-tab": tab.id },
        children: [
          el("span", { className: "compete-tab-icon", children: [shellIcon(tab.icon, 20, 1.9)] }),
          el("span", { className: "compete-tab-copy", children: [el("span", { className: "compete-tab-label", text: tab.label }), el("span", { className: "compete-tab-sub", text: tab.sub })] }),
          ...(tab.id === "multiplayer" ? [el("span", { className: "compete-tab-badge", text: "Live" })] : []),
        ],
        on: { click: () => setTab(tab.id, false) },
      });
      tabButtons.set(tab.id, button);
      return button;
    }),
  });
  // Roving tabindex (WAI-ARIA tabs): arrows move between the two tabs and select them.
  tabList.addEventListener("keydown", (event) => {
    const next: CompeteTab | null =
      event.key === "Home" ? "multiplayer"
      : event.key === "End" ? "leaderboards"
      : event.key === "ArrowLeft" || event.key === "ArrowRight" ? (tab === "multiplayer" ? "leaderboards" : "multiplayer")
      : null;
    if (!next) return;
    event.preventDefault();
    setTab(next, false);
    tabButtons.get(next)?.focus();
  }, { signal });

  let tab: CompeteTab = options.tab ?? (options.mode ? "leaderboards" : "multiplayer");
  let boardsStarted = false;

  /** Boards are only fetched once the Leaderboards tab is first shown. */
  function startBoards(): void {
    if (boardsStarted) return;
    boardsStarted = true;
    void loadBoard(true);
  }

  function renderTabs(): void {
    for (const [id, button] of tabButtons) {
      const active = id === tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      button.classList.toggle("is-active", active);
    }
    multiplayerPanel.hidden = tab !== "multiplayer";
    leaderboardsPanel.hidden = tab !== "leaderboards";
    page.element.dataset.tab = tab;
    if (tab === "leaderboards") {
      startBoards();
      requestAnimationFrame(() => revealSelectedMode());
    }
  }

  /** `fromLink`: a cross-link inside a panel, so move focus to the new panel's start. */
  function setTab(next: CompeteTab, fromLink: boolean): void {
    if (next === tab) return;
    tab = next;
    renderTabs();
    options.onTab?.(tab, selected.id, variantFor(selected));
    if (fromLink) {
      (tab === "multiplayer" ? multiplayerPanel : leaderboardsPanel).focus({ preventScroll: true });
      tabList.scrollIntoView?.({ block: "nearest" });
    }
  }

  // ---------- Page ----------

  const page = createSitePage(shell, {
    section: "compete",
    id: "compete",
    className: "compete-page",
    title: "Compete",
    subtitle: "Race friends in a live match, or go solo against the clock for a place on the global leaderboards.",
    content: [tabList, multiplayerPanel, leaderboardsPanel],
  });

  renderAll();
  renderPlayer();
  renderFriends();
  renderTabs();
  const syncAuth = (): void => void fetchAuthState().then((state) => {
    if (destroyed) return;
    applyAuth(state.user);
    renderPlayer();
    renderFriends();
    // The board response already carries your standing (the session cookie rides along), so a
    // board that arrived before the auth check only needs re-rendering, not re-fetching.
    renderBoard();
    void loadFriends();
  });
  syncAuth();
  // Signing in or out from the header while here swaps the guest note, your row and friends.
  const unsubscribeAuth = shell.onAuthChange?.(() => {
    if (!authKnown || shell.signedIn() !== (user !== null)) {
      syncAuth();
      if (boardsStarted) void loadBoard(true);
    }
  });
  const unsubscribeFriends = options.subscribeFriends?.(() => void loadFriends());

  // Local bests can change in another tab (a timed run finished there).
  window.addEventListener("storage", () => renderStanding(), { signal });

  return {
    element: page.element,
    destroy: () => {
      destroyed = true;
      controller.abort();
      unsubscribeFriends?.();
      unsubscribeAuth?.();
      page.destroy();
    },
  };
}
