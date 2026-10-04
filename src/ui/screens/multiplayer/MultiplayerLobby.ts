/*
 * The room before a game: who's in, the link to share, and the game settings (the host edits
 * them in place; everyone else reads a summary). One button starts the game: there is no ready
 * check, and anyone who arrives mid-game watches and plays the next one.
 */

import { MAP_TAP_CATEGORIES } from "../../../core/maptap";
import type { ClientMessage, PublicRoomState, RoomKind } from "../../../core/multiplayer";
import { fetchFriends, inviteFriendToGame, type FriendInfo } from "../../../core/auth";
import { getPlayerEmoji } from "../../../core/auth/avatars";
import { el } from "../../dom/createElement";
import { shellIcon } from "../../shell";
import { describeRoom, quizModesFromCategoryIds, quizModeToCategoryId, ROOM_KIND_INFO, roomKindInfo, ROUND_CHOICES, TIMER_CHOICES, withCurrent, type Choice } from "./roomModes";
import { createMapTapCategorySelector, createQuizModeSelector } from "./settingsControls";

type RoomOptionsMessage = Extract<ClientMessage, { type: "SET_ROOM_OPTIONS" }>;

export interface MultiplayerLobbyOptions {
  readonly signal: AbortSignal;
  readonly send: (message: ClientMessage) => void;
  readonly onLeave: () => void;
  /** Signed-in players can invite online friends. */
  readonly signedIn: () => boolean;
  /** Tell the player something happened ("Link copied."). */
  readonly announce: (text: string, tone?: "info" | "error") => void;
}

export interface MultiplayerLobbyState {
  readonly room: PublicRoomState;
  readonly localPlayerId: string | null;
}

export interface MultiplayerLobby {
  readonly element: HTMLElement;
  readonly update: (state: MultiplayerLobbyState) => void;
}

export function roomLink(roomCode: string): string {
  return `${window.location.origin}/?room=${encodeURIComponent(roomCode)}`;
}

function createChoiceSelect(label: string, onChange: (value: number) => void, signal: AbortSignal): { readonly field: HTMLElement; readonly set: (choices: readonly Choice[], value: number) => void } {
  const select = el("select", { className: "mp-select", attrs: { "aria-label": label } });
  select.addEventListener("change", () => onChange(Number(select.value)), { signal });
  const field = el("label", { className: "mp-setting", children: [el("span", { className: "mp-field-label", text: label }), select] });
  let signature = "";
  return {
    field,
    set: (choices, value) => {
      const next = choices.map((choice) => `${choice.value}`).join(",");
      if (next !== signature) {
        signature = next;
        select.replaceChildren(...choices.map((choice) => el("option", { text: choice.label, attrs: { value: String(choice.value) } })));
      }
      select.value = String(value);
    },
  };
}

export function createMultiplayerLobby(options: MultiplayerLobbyOptions): MultiplayerLobby {
  const { signal } = options;
  let room: PublicRoomState | null = null;
  let localPlayerId: string | null = null;

  /** Every settings change resends the room's categories: the server reads the game type from them. */
  function sendOptions(patch: Omit<RoomOptionsMessage, "type" | "categoryIds"> & { readonly categoryIds?: readonly string[] }): void {
    if (!room) return;
    options.send({ type: "SET_ROOM_OPTIONS", categoryIds: patch.categoryIds ?? room.categoryIds, ...patch });
  }

  // ---------- Header: the code and the link ----------

  const codeText = el("strong", { className: "mp-room-code", text: "·····" });
  const copyButton = el("button", { className: "shell-btn mp-copy", attrs: { type: "button" }, children: [shellIcon("copy", 17, 2), el("span", { text: "Copy invite link" })] });
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const shareButton = el("button", { className: "shell-btn shell-btn-quiet mp-share", attrs: { type: "button", ...(canShare ? {} : { hidden: "" }) }, children: [shellIcon("share-2", 17, 2), el("span", { text: "Share" })] });
  copyButton.addEventListener("click", () => {
    if (!room) return;
    const link = roomLink(room.roomCode);
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      options.announce(`Copy this link: ${link}`);
      return;
    }
    void clipboard.writeText(link).then(
      () => {
        copyButton.classList.add("is-done");
        copyButton.lastElementChild!.textContent = "Link copied";
        setTimeout(() => {
          copyButton.classList.remove("is-done");
          copyButton.lastElementChild!.textContent = "Copy invite link";
        }, 2200);
      },
      () => options.announce(`Couldn't copy. The link is ${link}`, "error"),
    );
  }, { signal });
  shareButton.addEventListener("click", () => {
    if (!room) return;
    void navigator.share({ title: "Play locato with me", text: `Join my locato room ${room.roomCode}`, url: roomLink(room.roomCode) }).catch(() => undefined);
  }, { signal });

  const header = el("header", {
    className: "mp-room-head",
    children: [
      el("div", { className: "mp-room-id", children: [el("span", { className: "mp-field-label", text: "Room code" }), codeText] }),
      el("p", { className: "mp-room-hint", text: "Friends open the link (or type the code under Multiplayer) to join." }),
      el("div", { className: "mp-room-actions", children: [copyButton, shareButton] }),
    ],
  });

  // ---------- Players ----------

  const playerCount = el("span", { className: "mp-count" });
  const playerList = el("ul", { className: "mp-players" });
  const inviteBody = el("div", { className: "mp-invites" });
  const inviteBlock = el("div", { className: "mp-invite-block", attrs: { hidden: "" }, children: [el("h3", { className: "mp-subtitle", text: "Invite friends online" }), inviteBody] });
  const playersCard = el("section", {
    className: "mp-card mp-players-card",
    attrs: { "aria-labelledby": "mp-players-title" },
    children: [el("header", { className: "mp-card-head", children: [el("h2", { className: "mp-card-title", text: "Players", attrs: { id: "mp-players-title" } }), playerCount] }), playerList, inviteBlock],
  });

  function renderPlayers(): void {
    if (!room) return;
    playerCount.textContent = `${room.players.length} / 8`;
    playerList.replaceChildren(
      ...room.players.map((player) => {
        const isYou = player.id === localPlayerId;
        const tags = [
          ...(player.id === room!.hostPlayerId ? [el("span", { className: "mp-tag is-host", text: "Host" })] : []),
          ...(player.spectator ? [el("span", { className: "mp-tag", text: "Watching" })] : []),
          ...(!player.connected ? [el("span", { className: "mp-tag is-offline", text: "Offline" })] : []),
        ];
        return el("li", {
          className: `mp-player${isYou ? " is-you" : ""}${player.connected ? "" : " is-offline"}`,
          children: [
            el("span", { className: "mp-avatar is-emoji", text: getPlayerEmoji(player, isYou), attrs: { "aria-hidden": "true" } }),
            el("span", { className: "mp-player-name", children: [el("span", { text: player.name }), ...(isYou ? [el("span", { className: "mp-you", text: "you" })] : [])] }),
            el("span", { className: "mp-player-tags", children: tags }),
          ],
        });
      }),
    );
  }

  // Online friends, fetched once per room; anyone already in the room isn't offered.
  let invitesFor: string | null = null;
  let onlineFriends: readonly FriendInfo[] = [];
  const invited = new Set<string>();

  function renderInvites(): void {
    if (!room) return;
    const inRoom = new Set(room.players.map((player) => player.name));
    const eligible = onlineFriends.filter((friend) => !inRoom.has(friend.user.username));
    inviteBlock.hidden = eligible.length === 0;
    inviteBody.replaceChildren(
      ...eligible.map((friend) => {
        const done = invited.has(friend.user.id);
        const button = el("button", { className: "shell-btn shell-btn-quiet mp-invite", text: done ? "Invited" : "Invite", attrs: { type: "button", "aria-label": `Invite ${friend.user.username}` } });
        button.disabled = done;
        button.addEventListener("click", () => {
          if (!room) return;
          button.disabled = true;
          void inviteFriendToGame(friend.user.id, room.roomCode).then((ok) => {
            if (ok) invited.add(friend.user.id);
            else options.announce(`Couldn't invite ${friend.user.username}. Send them the link instead.`, "error");
            renderInvites();
          });
        }, { signal });
        return el("div", {
          className: "mp-online-row",
          children: [
            el("span", { className: `mp-avatar is-online${friend.user.avatarEmoji ? " is-emoji" : ""}`, text: friend.user.avatarEmoji ?? friend.user.username.charAt(0).toUpperCase(), attrs: { "aria-hidden": "true" } }),
            el("span", { className: "mp-online-name", text: friend.user.username }),
            button,
          ],
        });
      }),
    );
  }

  function loadInvites(): void {
    if (!room || !options.signedIn() || invitesFor === room.roomCode) {
      renderInvites();
      return;
    }
    invitesFor = room.roomCode;
    onlineFriends = [];
    invited.clear();
    void fetchFriends().then((data) => {
      if (signal.aborted) return;
      onlineFriends = (data?.friends ?? []).filter((friend) => friend.online);
      renderInvites();
    });
  }

  // ---------- Game settings ----------

  const kindButtons = ROOM_KIND_INFO.map((info) => {
    const button = el("button", {
      className: `mp-kind-pill is-${info.kind}`,
      attrs: { type: "button", role: "radio", "aria-checked": "false" },
      children: [shellIcon(info.icon, 16, 2), el("span", { text: info.label })],
      on: { click: () => switchKind(info.kind) },
    });
    return { info, button };
  });
  const kindGroup = el("div", { className: "mp-kind-pills", attrs: { role: "radiogroup", "aria-label": "Game" }, children: kindButtons.map((entry) => entry.button) });

  function switchKind(kind: RoomKind): void {
    if (!room || room.kind === kind) return;
    sendOptions({ categoryIds: roomKindInfo(kind).categoryIds });
  }

  const quizModes = createQuizModeSelector({ signal, onChange: (modes) => sendOptions({ categoryIds: modes.map(quizModeToCategoryId) }) });
  const quizModesField = el("div", { className: "mp-setting is-wide", children: [el("span", { className: "mp-field-label", text: "Modes" }), quizModes.element] });
  // Flag rounds: countries only, or every flag with territories mixed in ("both" on the server).
  const territoriesSwitch = el("input", { className: "mp-switch-input", attrs: { type: "checkbox", role: "switch" } });
  territoriesSwitch.addEventListener("change", () => sendOptions({ flagPool: territoriesSwitch.checked ? "both" : "countries" }), { signal });
  const flagPoolField = el("label", {
    className: "mp-setting is-wide mp-switch",
    children: [
      el("span", { className: "mp-switch-copy", children: [el("strong", { text: "Include territories" }), el("span", { className: "mp-muted mp-small", text: "Adds flags like Greenland, Puerto Rico and Hong Kong." })] }),
      territoriesSwitch,
      el("span", { className: "mp-switch-track", attrs: { "aria-hidden": "true" } }),
    ],
  });
  const mapTapPlaces = createMapTapCategorySelector({ signal, onChange: (categories) => sendOptions({ mapTapCategories: categories }) });
  const mapTapField = el("div", { className: "mp-setting is-wide", children: [el("span", { className: "mp-field-label", text: "Places" }), mapTapPlaces.element] });
  const rounds = createChoiceSelect("Rounds", (value) => sendOptions({ roundLimit: value }), signal);
  const timer = createChoiceSelect("Time per round", (value) => sendOptions({ roundDurationMs: value }), signal);
  const flight = createChoiceSelect("Flight length", (value) => sendOptions({ roundDurationMs: value }), signal);

  const editor = el("div", {
    className: "mp-settings-editor",
    children: [kindGroup, el("div", { className: "mp-settings-grid", children: [quizModesField, flagPoolField, mapTapField, rounds.field, timer.field, flight.field] })],
  });
  const summaryIcon = el("span", { className: "mp-kind-icon" });
  const summaryLabel = el("strong", { className: "mp-summary-label" });
  const summaryFacts = el("ul", { className: "mp-facts" });
  const summary = el("div", {
    className: "mp-settings-summary",
    children: [el("div", { className: "mp-summary-head", children: [summaryIcon, summaryLabel] }), summaryFacts, el("p", { className: "mp-muted mp-small", text: "The host picks the game." })],
  });
  const settingsCard = el("section", {
    className: "mp-card mp-settings-card",
    attrs: { "aria-labelledby": "mp-settings-title" },
    children: [el("header", { className: "mp-card-head", children: [el("h2", { className: "mp-card-title", text: "Game", attrs: { id: "mp-settings-title" } })] }), editor, summary],
  });

  function renderSettings(isHost: boolean): void {
    if (!room) return;
    const { kind, settings } = room;
    editor.hidden = !isHost;
    summary.hidden = isHost;
    const info = roomKindInfo(kind);
    summaryIcon.replaceChildren(shellIcon(info.icon, 20, 1.9));
    summaryLabel.textContent = info.label;
    summaryFacts.replaceChildren(...describeRoom(room).map((fact) => el("li", { text: fact })));
    if (!isHost) return;

    for (const entry of kindButtons) {
      const active = entry.info.kind === kind;
      entry.button.classList.toggle("is-active", active);
      entry.button.setAttribute("aria-checked", String(active));
    }
    const modes = quizModesFromCategoryIds(room.categoryIds);
    quizModesField.hidden = kind !== "quiz";
    quizModes.setValue(modes);
    flagPoolField.hidden = kind !== "quiz" || !modes.includes("flags");
    territoriesSwitch.checked = settings.flagPool !== undefined && settings.flagPool !== "countries";
    mapTapField.hidden = kind !== "map-tap";
    mapTapPlaces.setValue(settings.mapTapCategories ?? MAP_TAP_CATEGORIES);
    rounds.field.hidden = kind === "flyover";
    timer.field.hidden = kind === "flyover";
    flight.field.hidden = kind !== "flyover";
    if (kind === "flyover") {
      flight.set(TIMER_CHOICES.flyover, settings.roundDurationMs);
    } else {
      rounds.set(withCurrent(ROUND_CHOICES[kind].map((value) => ({ value, label: `${value} rounds` })), settings.roundLimit, (value) => `${value} rounds`), settings.roundLimit);
      timer.set(withCurrent(TIMER_CHOICES[kind], settings.roundDurationMs, (value) => `${Math.round(value / 1000)} sec`), settings.roundDurationMs);
    }
  }

  // ---------- The one button ----------

  const startButton = el("button", { className: "shell-btn mp-start-game", attrs: { type: "button" }, children: [shellIcon("play", 18, 2.2), el("span", { text: "Start game" })] });
  const startNote = el("p", { className: "mp-start-note" });
  const waiting = el("p", { className: "mp-waiting", children: [el("span", { className: "mp-live-dot", attrs: { "aria-hidden": "true" } }), el("span")] });
  const leaveButton = el("button", { className: "shell-btn shell-btn-quiet mp-leave", text: "Leave room", attrs: { type: "button" } });
  startButton.addEventListener("click", () => options.send({ type: "START_GAME" }), { signal });
  leaveButton.addEventListener("click", () => options.onLeave(), { signal });
  const actionBar = el("div", { className: "mp-action-bar", children: [el("div", { className: "mp-action-main", children: [startButton, startNote, waiting] }), leaveButton] });

  function renderActions(isHost: boolean): void {
    if (!room) return;
    const others = room.players.filter((player) => player.id !== localPlayerId && player.connected).length;
    startButton.hidden = !isHost;
    startNote.hidden = !isHost;
    waiting.hidden = isHost;
    startNote.textContent = others === 0 ? "You can start on your own, or wait for friends to join." : `${others + 1} players in. Anyone who joins later watches, then plays the next game.`;
    const host = room.players.find((player) => player.id === room!.hostPlayerId);
    waiting.lastElementChild!.textContent = `Waiting for ${host?.name ?? "the host"} to start the game…`;
  }

  const element = el("div", {
    className: "mp-lobby",
    children: [header, el("div", { className: "mp-lobby-grid", children: [playersCard, settingsCard] }), actionBar],
  });

  return {
    element,
    update: (state) => {
      room = state.room;
      localPlayerId = state.localPlayerId;
      const isHost = localPlayerId === room.hostPlayerId;
      codeText.textContent = room.roomCode;
      renderPlayers();
      renderSettings(isHost);
      renderActions(isHost);
      loadInvites();
    },
  };
}
