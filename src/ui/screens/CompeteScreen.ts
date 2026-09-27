import { fetchAuthState, fetchLeaderboard, submitBestTime, type AuthUser, type LeaderboardEntry, type LeaderboardResponse } from "../../core/auth";
import { CONTINENTS } from "../../core/countries";
import { GAME_MODE_GROUPS, isLeaderboardMode, type GameModeCatalogueEntry, type GameModeGroup, type GameModeId, type LeaderboardGameModeId } from "../../core/gameModes";
import { timerKeysForMode } from "../../core/timer/keys";
import { formatElapsedTime, readStoredTime } from "../../core/timer/playTimer";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";
import { createSitePage, shellIcon, type ShellContext } from "../shell";
import "../../styles/compete.css";

/*
 * Compete (docs/navigation.md → "Practice vs timed"): every leaderboard mode, its board and your
 * best, and the way into a timed run. Practice lives in Play; this page only starts timed runs
 * (plus a "Practise first" shortcut back to Play).
 */

export interface CompeteScreenOptions {
  readonly shell: ShellContext;
  readonly storage: Storage;
  /** Mode to open on (from `?mode=`). Non-leaderboard modes fall back to the first board. */
  readonly mode?: GameModeId;
  /** Variant to open on (from `?variant=`): "territories" / "both" for flags, a continent for puzzle. */
  readonly variant?: string;
  /** Called when the player picks another board or variant. App mirrors it into the URL with history *replace*. */
  readonly onSelect?: (mode: LeaderboardGameModeId, variant: string) => void;
  /** Opens the multiplayer lobby. The "Race friends" card is hidden without it. */
  readonly onMultiplayer?: () => void;
}

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

  const friendsCard = options.onMultiplayer
    ? el("section", {
        className: "compete-card compete-friends",
        children: [
          el("span", { className: "compete-friends-icon", children: [shellIcon("users", 20, 1.8)] }),
          el("h3", { className: "compete-card-title", text: "Race friends" }),
          el("p", { text: "Open a private room and share its short code. Everyone gets the same questions at once and the standings update every round." }),
          el("button", {
            className: "shell-btn compete-friends-action",
            attrs: { type: "button" },
            children: [el("span", { text: "Open multiplayer" }), shellIcon("arrow-right", 16, 2)],
            on: { click: () => options.onMultiplayer?.() },
          }),
        ],
      })
    : null;

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
        children: [board, el("div", { className: "compete-side", children: [bestCard, ...(friendsCard ? [friendsCard] : [])] })],
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
    eyebrow.replaceChildren(el("span", { className: "compete-eyebrow-icon", children: [shellIcon(mode.icon, 15, 1.9)] }), el("span", { text: `${group.label} · Timed` }));
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

  // ---------- Page ----------

  const page = createSitePage(shell, {
    section: "compete",
    id: "compete",
    className: "compete-page",
    title: "Compete",
    subtitle: "Timed runs post to the leaderboards. Practice lives in Play: no clock, nothing posted.",
    content: [banner, el("div", { className: "compete-layout", children: [rail, panel] })],
  });

  banner.hidden = shell.signedIn();
  renderAll();
  void loadBoard(true);
  void fetchAuthState().then((state) => {
    if (destroyed) return;
    // The board response already carries your standing (the session cookie rides along), so a
    // board that arrived before the auth check only needs re-rendering, not re-fetching.
    if (state.user && boardLoadedKey === boardKey(selected)) standings.set(boardLoadedKey, boardUser);
    applyAuth(state.user);
    renderBoard();
    void loadStandings();
  });

  // Local bests can change in another tab (a timed run finished there).
  window.addEventListener("storage", () => { renderRail(); renderBest(); }, { signal });

  return {
    element: page.element,
    destroy: () => {
      destroyed = true;
      controller.abort();
      page.destroy();
    },
  };
}
