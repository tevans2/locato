import { fetchAuthState, fetchFriends, fetchLeaderboard, submitBestTime, type AuthUser, type FriendInfo, type LeaderboardEntry, type LeaderboardResponse } from "../../core/auth";
import { cleanJoinCode, MAX_PLAYER_NAME_LENGTH, readActiveRoomCode, readPlayerName, writePlayerName } from "../../core/multiplayer/localPlayer";
import { CONTINENTS } from "../../core/countries";
import { GAME_MODE_GROUPS, isLeaderboardMode, type GameModeCatalogueEntry, type GameModeGroup, type GameModeId, type LeaderboardGameModeId } from "../../core/gameModes";
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
 *   Leaderboards          — a solo timed attempt: every leaderboard mode, its board and your
 *                           best, and the way into a timed run (plus "Practise first").
 */

export type CompeteTab = "multiplayer" | "leaderboards";

export interface CompeteRoomRequest {
  /** Invite this friend (user id) as soon as the new room exists. */
  readonly inviteUserId?: string;
}

export interface CompeteScreenOptions {
  readonly shell: ShellContext;
  readonly storage: Storage;
  /** Mode to open on (from `?mode=`). Non-leaderboard modes fall back to the first board. */
  readonly mode?: GameModeId;
  /** Variant to open on (from `?variant=`): "territories" / "both" for flags, a continent for puzzle. */
  readonly variant?: string;
  /** Called when the player picks another board or variant. App mirrors it into the URL with history *replace*. */
  readonly onSelect?: (mode: LeaderboardGameModeId, variant: string) => void;
  /** Tab to open on. Default: Leaderboards when a `mode` is given (old board links), else Multiplayer. */
  readonly tab?: CompeteTab;
  /** Called when the player switches tab (App replaces the URL). Leaderboards passes the board shown. */
  readonly onTab?: (tab: CompeteTab, mode: LeaderboardGameModeId, variant: string) => void;
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

type FlagVariant = "" | "territories" | "both";
const FLAG_VARIANTS: readonly { readonly id: FlagVariant; readonly label: string }[] = [
  { id: "", label: "Countries" },
  { id: "territories", label: "Territories" },
  { id: "both", label: "Both" },
];
const DEFAULT_CONTINENT = "Africa";

/** What a timed run asks of you, per mode. One or two sentences. */
const TIMED_RULES: Record<LeaderboardGameModeId, string> = {
  flags: "Name every flag in the set as fast as you can.",
  shapes: "Name every country from its outline alone, as fast as you can.",
  codes: "Decode every ISO country code, as fast as you can.",
  capitals: "Name the country behind every capital, as fast as you can.",
  "capital-recall": "Name the capital of every country, as fast as you can.",
  "name-all": "Type every country in the world until the map is full.",
  "click-country": "Find every named country on the map, one after another.",
  "spot-country": "Name every country as it lights up on the map.",
  puzzle: "Drop every country of the continent into place.",
};

interface CompeteGroup {
  readonly group: GameModeGroup;
  readonly modes: readonly (GameModeCatalogueEntry & { readonly id: LeaderboardGameModeId })[];
}

const COMPETE_GROUPS: readonly CompeteGroup[] = GAME_MODE_GROUPS.map((group) => ({
  group,
  modes: group.modes.filter((mode): mode is GameModeCatalogueEntry & { readonly id: LeaderboardGameModeId } => isLeaderboardMode(mode.id)),
})).filter((entry) => entry.modes.length > 0);

const COMPETE_MODES = COMPETE_GROUPS.flatMap((entry) => entry.modes);

function isFlagVariant(value: string | undefined): value is FlagVariant {
  return value === "" || value === "territories" || value === "both";
}

function isContinent(value: string | undefined): boolean {
  return (CONTINENTS as readonly string[]).includes(value ?? "");
}

interface BoardStanding {
  readonly rank: number;
  readonly timeMs: number;
}

export function createCompeteScreen(options: CompeteScreenOptions): Screen {
  const { shell, storage } = options;
  const controller = new AbortController();
  const signal = controller.signal;
  let destroyed = false;

  let selected: LeaderboardGameModeId = options.mode && isLeaderboardMode(options.mode) ? options.mode : COMPETE_MODES[0]!.id;
  let flagVariant: FlagVariant = selected === "flags" && isFlagVariant(options.variant) ? options.variant : "";
  // "countries" is the default flag board; the server stores it as "".
  if (selected === "flags" && options.variant === "countries") flagVariant = "";
  let continent = selected === "puzzle" && isContinent(options.variant) ? options.variant! : DEFAULT_CONTINENT;

  let user: AuthUser | null = null;
  let authKnown = false;
  /** Your server standing per board (`mode|variant`); undefined = not fetched, null = no time posted. */
  const standings = new Map<string, BoardStanding | null>();

  const variantFor = (mode: LeaderboardGameModeId): string => (mode === "flags" ? flagVariant : mode === "puzzle" ? continent : "");
  const boardKey = (mode: LeaderboardGameModeId, variant = variantFor(mode)): string => `${mode}|${variant}`;
  const localBest = (mode: LeaderboardGameModeId): number | null =>
    readStoredTime(storage, timerKeysForMode(mode, mode === "flags" ? (flagVariant || "countries") : "countries").best);

  // ---------- Guest banner ----------

  const banner = el("div", {
    className: "compete-banner",
    attrs: { role: "note" },
    children: [
      el("span", { className: "compete-banner-icon", children: [shellIcon("user-round", 20, 1.8)] }),
      el("div", {
        className: "compete-banner-copy",
        children: [
          el("strong", { text: "Sign in to post your times" }),
          el("span", { text: "You can still race the clock as a guest. Your best is kept on this device, ready to post once you sign in." }),
        ],
      }),
      el("button", { className: "shell-btn shell-btn-primary compete-banner-action", text: "Sign in", attrs: { type: "button" }, on: { click: () => shell.openAccount() } }),
    ],
  });

  // ---------- Mode rail ----------

  const railButtons = new Map<LeaderboardGameModeId, { readonly button: HTMLButtonElement; readonly meta: HTMLElement }>();
  const rail = el("nav", {
    className: "compete-rail",
    attrs: { "aria-label": "Leaderboard modes" },
    children: COMPETE_GROUPS.map(({ group, modes }) =>
      el("section", {
        className: "compete-rail-group",
        attrs: { "data-group": group.id },
        children: [
          el("h2", { className: "compete-rail-label", text: group.label }),
          el("ul", {
            className: "compete-rail-list",
            children: modes.map((mode) => {
              const meta = el("span", { className: "compete-rail-meta" });
              const button = el("button", {
                className: "compete-rail-item",
                attrs: { type: "button", "data-mode": mode.id, "data-group": group.id, "aria-pressed": "false" },
                children: [
                  el("span", { className: "compete-rail-icon", children: [shellIcon(mode.icon, 19, 1.7)] }),
                  el("span", { className: "compete-rail-copy", children: [el("span", { className: "compete-rail-name", text: mode.label }), meta] }),
                ],
                on: { click: () => select(mode.id) },
              });
              railButtons.set(mode.id, { button, meta });
              return el("li", { children: [button] });
            }),
          }),
        ],
      }),
    ),
  });

  function renderRailItem(mode: LeaderboardGameModeId): void {
    const item = railButtons.get(mode);
    if (!item) return;
    item.button.setAttribute("aria-pressed", String(mode === selected));
    item.button.classList.toggle("is-selected", mode === selected);
    const standing = standings.get(boardKey(mode));
    const local = localBest(mode);
    const best = [standing?.timeMs, local].filter((value): value is number => typeof value === "number");
    const parts: HTMLElement[] = [];
    if (best.length) parts.push(el("span", { className: "compete-rail-time", text: formatElapsedTime(Math.min(...best)) }));
    if (standing) parts.push(el("span", { className: "compete-rail-rank", text: `#${standing.rank}` }));
    if (!parts.length) parts.push(el("span", { className: "compete-rail-empty", text: "No time yet" }));
    item.meta.replaceChildren(...parts);
  }

  const renderRail = (): void => COMPETE_MODES.forEach((mode) => renderRailItem(mode.id));

  // ---------- Selected mode panel ----------

  const eyebrow = el("p", { className: "compete-eyebrow" });
  const title = el("h2", { className: "compete-title", attrs: { id: "compete-mode-title", tabindex: "-1" } });
  const rules = el("p", { className: "compete-rules" });
  const variantHost = el("div", { className: "compete-variants" });
  const startButton = el("button", {
    className: "shell-btn shell-btn-primary compete-start",
    attrs: { type: "button" },
    children: [shellIcon("timer", 19, 2), el("span", { text: "Start timed run" })],
    on: { click: () => shell.openGame(selected, "timed", variantFor(selected) || undefined) },
  });
  const practiseButton = el("button", {
    className: "shell-btn compete-practise",
    attrs: { type: "button" },
    children: [el("span", { text: "Practise first" })],
    on: { click: () => shell.openGame(selected, "practice") },
  });

  const boardCaption = el("p", { className: "compete-board-caption" });
  const boardList = el("ol", { className: "compete-board-list", attrs: { "aria-labelledby": "compete-board-title" } });
  const boardState = el("div", { className: "compete-board-state", attrs: { role: "status", "aria-live": "polite" } });
  const moreButton = el("button", { className: "shell-btn shell-btn-quiet compete-more", text: "Show more", attrs: { type: "button", hidden: "" }, on: { click: () => void loadBoard(false) } });
  const board = el("section", {
    className: "compete-card compete-board",
    attrs: { "aria-busy": "false" },
    children: [
      el("header", {
        className: "compete-card-head",
        children: [el("h3", { className: "compete-card-title", text: "Leaderboard", attrs: { id: "compete-board-title" } }), boardCaption],
      }),
      boardState,
      boardList,
      moreButton,
    ],
  });

  const bestBody = el("div", { className: "compete-best-body" });
  const bestCard = el("section", {
    className: "compete-card compete-best",
    children: [el("header", { className: "compete-card-head", children: [el("h3", { className: "compete-card-title", text: "Your best" })] }), bestBody],
  });

  // The solo side points across to the live side (and vice versa), so neither is a dead end.
  const liveCard = el("section", {
    className: "compete-card compete-cross is-live",
    children: [
      el("span", { className: "compete-cross-icon", children: [shellIcon("users", 20, 1.8)] }),
      el("h3", { className: "compete-card-title", text: "Prefer a live match?" }),
      el("p", { text: "Multiplayer is a race against friends, not the clock: everyone gets the same question at once." }),
      el("button", {
        className: "shell-btn compete-cross-action",
        attrs: { type: "button", "data-go-tab": "multiplayer" },
        children: [el("span", { text: "Play friends live" }), shellIcon("arrow-right", 16, 2)],
        on: { click: () => setTab("multiplayer", true) },
      }),
    ],
  });

  const panel = el("section", {
    className: "compete-panel",
    attrs: { "aria-labelledby": "compete-mode-title" },
    children: [
      el("div", {
        className: "compete-panel-head",
        children: [
          el("div", { className: "compete-panel-intro", children: [eyebrow, title, rules] }),
          el("ul", {
            className: "compete-facts",
            children: [
              el("li", { children: [shellIcon("timer", 15, 2), el("span", { text: "The clock starts on your first answer." })] }),
              el("li", { children: [shellIcon("check", 15, 2), el("span", { text: "Finish the set to post your time." })] }),
              el("li", { children: [shellIcon("x", 15, 2), el("span", { text: "No switching to practice mid-run." })] }),
            ],
          }),
          variantHost,
          el("div", { className: "compete-actions", children: [startButton, practiseButton] }),
        ],
      }),
      el("div", {
        className: "compete-panel-body",
        children: [board, el("div", { className: "compete-side", children: [bestCard, liveCard] })],
      }),
    ],
  });

  function renderVariants(): void {
    if (selected !== "flags" && selected !== "puzzle") {
      variantHost.hidden = true;
      variantHost.replaceChildren();
      return;
    }
    variantHost.hidden = false;
    const label = selected === "flags" ? "Flag set" : "Continent";
    const choices = selected === "flags" ? FLAG_VARIANTS.map((item) => ({ id: item.id as string, label: item.label })) : CONTINENTS.map((name) => ({ id: name as string, label: name as string }));
    const current = variantFor(selected);
    variantHost.replaceChildren(
      el("span", { className: "compete-variants-label", text: label, attrs: { id: "compete-variant-label" } }),
      el("div", {
        className: "compete-segments",
        attrs: { role: "radiogroup", "aria-labelledby": "compete-variant-label" },
        children: choices.map((choice) =>
          el("button", {
            className: `compete-segment${choice.id === current ? " is-selected" : ""}`,
            text: choice.label,
            attrs: { type: "button", role: "radio", "aria-checked": String(choice.id === current), "data-variant": choice.id },
            on: { click: () => selectVariant(choice.id) },
          }),
        ),
      }),
    );
  }

  function renderHead(): void {
    const mode = COMPETE_MODES.find((item) => item.id === selected)!;
    const group = COMPETE_GROUPS.find((entry) => entry.modes.some((item) => item.id === selected))!.group;
    panel.dataset.group = group.id;
    eyebrow.replaceChildren(el("span", { className: "compete-eyebrow-icon", children: [shellIcon(mode.icon, 15, 1.9)] }), el("span", { text: `${group.label} · Solo timed attempt` }));
    title.textContent = mode.label;
    rules.textContent = TIMED_RULES[selected];
    renderVariants();
  }

  // ---------- Board ----------

  let boardEntries: LeaderboardEntry[] = [];
  let boardUser: BoardStanding | null = null;
  let boardRequest = 0;
  /** `mode|variant` of the board currently shown, once its first page has arrived. */
  let boardLoadedKey: string | null = null;

  function avatar(entry: LeaderboardEntry): HTMLElement {
    return entry.avatarEmoji
      ? el("span", { className: "compete-avatar is-emoji", text: entry.avatarEmoji, attrs: { "aria-hidden": "true" } })
      : el("span", { className: "compete-avatar", text: entry.displayName.charAt(0).toUpperCase(), attrs: { "aria-hidden": "true" } });
  }

  function row(entry: LeaderboardEntry, isYou: boolean): HTMLElement {
    const name = el("span", { className: "compete-row-name", children: [el("span", { className: "compete-row-display", text: entry.displayName })] });
    if (isYou) name.append(el("span", { className: "compete-you", text: "You" }));
    return el("li", {
      className: `compete-row${entry.rank <= 3 ? ` is-podium is-rank-${entry.rank}` : ""}${isYou ? " is-you" : ""}`,
      attrs: { "data-rank": String(entry.rank) },
      children: [
        el("span", { className: "compete-row-rank", text: String(entry.rank), attrs: { "aria-label": `Rank ${entry.rank}` } }),
        avatar(entry),
        name,
        el("span", { className: "compete-row-time", text: formatElapsedTime(entry.timeMs) }),
      ],
    });
  }

  function renderBoard(): void {
    const youId = user?.id ?? null;
    const rows = boardEntries.map((entry) => row(entry, entry.userId === youId));
    // You're on the board but below the rows shown: pin your row under a gap.
    if (user && boardUser && !boardEntries.some((entry) => entry.userId === user!.id)) {
      rows.push(el("li", { className: "compete-row-gap", attrs: { "aria-hidden": "true" }, text: "···" }));
      rows.push(row({ rank: boardUser.rank, userId: user.id, displayName: user.displayName, avatarEmoji: user.avatarEmoji, timeMs: boardUser.timeMs, achievedAt: 0 }, true));
    }
    boardList.replaceChildren(...rows);
    boardList.hidden = rows.length === 0;
  }

  function showBoardState(kind: "loading" | "empty" | "error" | "none"): void {
    board.setAttribute("aria-busy", String(kind === "loading"));
    board.dataset.state = kind;
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
          children: Array.from({ length: 6 }, () => el("span", { className: "compete-skeleton-row" })),
        }),
      );
      return;
    }
    if (kind === "empty") {
      boardState.replaceChildren(
        el("div", {
          className: "compete-empty",
          children: [
            el("span", { className: "compete-empty-icon", children: [shellIcon("trophy", 26, 1.6)] }),
            el("strong", { text: "No times on this board yet" }),
            el("span", { text: "Finish a timed run to take first place." }),
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
          el("span", { text: offline ? "Boards need a connection. Timed runs still work, and your best is saved on this device." : "Check your connection and try again. Timed runs still work." }),
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
      boardList.replaceChildren();
      boardList.hidden = true;
      moreButton.hidden = true;
      boardCaption.textContent = "";
      showBoardState("loading");
    } else {
      moreButton.disabled = true;
      moreButton.textContent = "Loading…";
    }

    const response: LeaderboardResponse | null = await fetchLeaderboard(mode, variant, COMPETE_PAGE_SIZE, offset);
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
    boardLoadedKey = boardKey(mode, variant);
    if (user) {
      standings.set(boardKey(mode, variant), boardUser);
      renderRailItem(mode);
    }
    moreButton.hidden = response.entries.length < COMPETE_PAGE_SIZE;
    boardCaption.textContent = boardEntries.length === 0 ? "" : moreButton.hidden ? `${boardEntries.length} ${boardEntries.length === 1 ? "player" : "players"}` : `Top ${boardEntries.length}`;
    showBoardState(boardEntries.length === 0 ? "empty" : "none");
    renderBoard();
    renderBest();
  }

  // ---------- Your best ----------

  let postMessage = "";
  let posting = false;

  function statBlock(label: string, value: string, extra?: string): HTMLElement {
    return el("div", {
      className: "compete-stat",
      children: [
        el("span", { className: "compete-stat-label", text: label }),
        el("span", { className: "compete-stat-value", text: value }),
        ...(extra ? [el("span", { className: "compete-stat-extra", text: extra })] : []),
      ],
    });
  }

  function renderBest(): void {
    const mode = selected;
    const local = localBest(mode);
    const standing = user ? standings.get(boardKey(mode)) : undefined;
    // Puzzle keeps one best on this device for all continents, so it can't be posted to one board.
    const localIsPerBoard = mode !== "puzzle";
    const children: HTMLElement[] = [];
    const stats: HTMLElement[] = [];

    if (user && standing) stats.push(statBlock("On the board", formatElapsedTime(standing.timeMs), `Rank #${standing.rank}`));
    else if (user && standing === null) stats.push(statBlock("On the board", "—", "Not posted yet"));
    if (local !== null) stats.push(statBlock("On this device", formatElapsedTime(local), localIsPerBoard ? undefined : "Any continent"));
    if (stats.length) children.push(el("div", { className: "compete-stats", children: stats }));

    const canPost = user !== null && standing !== undefined && local !== null && localIsPerBoard && (standing === null || local < standing.timeMs);
    if (canPost) {
      children.push(
        el("button", {
          className: "shell-btn shell-btn-primary compete-post",
          text: posting ? "Posting…" : `Post saved best (${formatElapsedTime(local!)})`,
          attrs: { type: "button", ...(posting ? { disabled: "" } : {}) },
          on: { click: () => void postSavedBest(local!) },
        }),
      );
    } else if (!user && authKnown && local !== null) {
      children.push(el("button", { className: "shell-btn compete-post", text: "Sign in to post it", attrs: { type: "button" }, on: { click: () => shell.openAccount() } }));
    }

    if (!stats.length || (user && standing === null && local === null)) {
      children.push(el("p", { className: "compete-best-hint", text: "No time yet. Start a timed run to set one." }));
    }
    if (postMessage) children.push(el("p", { className: "compete-best-note", text: postMessage, attrs: { role: "status" } }));
    bestBody.replaceChildren(...children);
  }

  async function postSavedBest(timeMs: number): Promise<void> {
    if (!user || posting) return;
    const mode = selected;
    posting = true;
    postMessage = "";
    renderBest();
    const result = await submitBestTime({ gameMode: mode, variant: variantFor(mode), timeMs: Math.round(timeMs) });
    if (destroyed) return;
    posting = false;
    if (result?.accepted) {
      postMessage = "Posted to the leaderboard.";
      if (mode === selected) void loadBoard(true);
    } else {
      postMessage = result ? "The board already has a faster time from you." : "Couldn't post that time. Check your connection and try again.";
    }
    renderBest();
  }

  // ---------- Selection ----------

  function select(mode: LeaderboardGameModeId): void {
    if (mode === selected) return;
    selected = mode;
    postMessage = "";
    renderAll();
    options.onSelect?.(selected, variantFor(selected));
    void loadBoard(true);
    // On phones the panel sits under the chip scroller; keep the chosen chip in view.
    railButtons.get(mode)?.button.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function selectVariant(variant: string): void {
    if (variant === variantFor(selected)) return;
    if (selected === "flags" && isFlagVariant(variant)) flagVariant = variant;
    else if (selected === "puzzle" && isContinent(variant)) continent = variant;
    else return;
    postMessage = "";
    renderAll();
    options.onSelect?.(selected, variantFor(selected));
    void loadBoard(true);
  }

  function renderAll(): void {
    renderHead();
    renderRail();
    renderBest();
  }

  /** Signed in: fetch your standing on each board (one row each) so the rail can show your ranks. */
  async function loadStandings(): Promise<void> {
    if (!user) return;
    await Promise.all(
      COMPETE_MODES.map(async (mode) => {
        const key = boardKey(mode.id);
        if (standings.has(key) || mode.id === selected) return;
        const response = await fetchLeaderboard(mode.id, variantFor(mode.id), 1);
        if (destroyed || !response || !user) return;
        standings.set(key, response.currentUser ?? null);
        renderRailItem(mode.id);
      }),
    );
  }

  function applyAuth(next: AuthUser | null): void {
    user = next;
    authKnown = true;
    banner.hidden = user !== null;
    renderAll();
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

  // ---------- Leaderboards: solo timed attempt ----------

  const leaderboardsPanel = el("section", {
    className: "compete-tabpanel compete-lb",
    attrs: { id: "compete-panel-leaderboards", role: "tabpanel", "aria-labelledby": "compete-tab-leaderboards", tabindex: "-1" },
    children: [
      el("div", {
        className: "compete-lb-intro",
        children: [
          el("p", { className: "compete-kicker is-solo", children: [shellIcon("timer", 15, 2), el("span", { text: "Solo timed attempt" })] }),
          el("p", { className: "compete-lb-lede", children: [el("strong", { text: "Beat the leaderboard. " }), el("span", { text: "Just you against the clock: finish a set as fast as you can and your time posts to a global board." })] }),
        ],
      }),
      banner,
      el("div", { className: "compete-layout", children: [rail, panel] }),
    ],
  });

  // ---------- Tabs ----------

  const TABS: readonly { readonly id: CompeteTab; readonly label: string; readonly sub: string; readonly icon: "users" | "trophy" }[] = [
    { id: "multiplayer", label: "Multiplayer", sub: "Live match with friends", icon: "users" },
    { id: "leaderboards", label: "Leaderboards", sub: "Solo timed attempt", icon: "trophy" },
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
    void loadStandings();
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
    if (tab === "leaderboards") startBoards();
  }

  /** `fromLink`: a cross-link inside a panel, so move focus to the new panel's start. */
  function setTab(next: CompeteTab, fromLink: boolean): void {
    if (next === tab) return;
    tab = next;
    renderTabs();
    options.onTab?.(tab, selected, variantFor(selected));
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

  banner.hidden = shell.signedIn();
  renderAll();
  renderPlayer();
  renderFriends();
  renderTabs();
  const syncAuth = (): void => void fetchAuthState().then((state) => {
    if (destroyed) return;
    // The board response already carries your standing (the session cookie rides along), so a
    // board that arrived before the auth check only needs re-rendering, not re-fetching.
    if (state.user && boardLoadedKey === boardKey(selected)) standings.set(boardLoadedKey, boardUser);
    applyAuth(state.user);
    renderPlayer();
    renderFriends();
    renderBoard();
    if (boardsStarted) void loadStandings();
    void loadFriends();
  });
  syncAuth();
  // Signing in or out from the header while here swaps the guest banner, your best and friends.
  const unsubscribeAuth = shell.onAuthChange?.(() => {
    if (!authKnown || shell.signedIn() !== (user !== null)) syncAuth();
  });
  const unsubscribeFriends = options.subscribeFriends?.(() => void loadFriends());

  // Local bests can change in another tab (a timed run finished there).
  window.addEventListener("storage", () => { renderRail(); renderBest(); }, { signal });

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
