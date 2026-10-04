/*
 * Multiplayer (docs/navigation.md → "Multiplayer", docs/multiplayer.md). One page, four views:
 *   home     not in a room: pick a game to open one, or join with a code
 *   lobby    in a room before a game: players, link, settings, Start
 *   game     the round view for the room's game (spectators watch)
 *   results  standings, then Play again
 * The room connection lives in `roomSession`; this file renders it and plays the sounds.
 * Leaving the page leaves the room (after a confirm when it matters); a reload reclaims the seat.
 */

import { MAX_CHAT_MESSAGE_LENGTH, type MultiplayerTransport, type PublicChatMessage, type PublicRoomState, type RoomKind, type ServerMessage } from "../../../core/multiplayer";
import type { CountryIndex } from "../../../core/countries";
import type { WorldCountryFeature } from "../../../core/map";
import type { Screen } from "../../../app/router";
import type { AuthControls } from "../../components/AuthPanel";
import { fetchFullStats, inviteFriendToGame } from "../../../core/auth";
import { getLocalAvatar } from "../../../core/auth/avatars";
import { readPlayerName } from "../../../core/multiplayer/localPlayer";
import { el } from "../../dom/createElement";
import { createSitePage, shellIcon, type ShellContext } from "../../shell";
import { flashScreen, playCorrect, playRoundTaken, playTimeUp, playVictory, playWrong } from "../../dom/sfx";
import { createMultiplayerGameView } from "../MultiplayerGameScreen";
import { createMultiplayerMapTapGameView } from "../../components/MultiplayerMapTapGameView";
import { createMultiplayerGeoGuessrGameView } from "../../components/MultiplayerGeoGuessrGameView";
import { createMultiplayerFlyoverGameView } from "../../components/MultiplayerFlyoverGameView";
import { createRoomSession, clearStoredSession, readStoredSession, type RoomNotice, type RoomSessionState } from "./roomSession";
import { createMultiplayerHome } from "./MultiplayerHome";
import { createMultiplayerLobby } from "./MultiplayerLobby";
import { createMultiplayerResults } from "./MultiplayerResults";
import { roomKindInfo } from "./roomModes";
import "../../../styles/multiplayer-hub.css";

export interface MultiplayerScreenOptions {
  readonly shell: ShellContext;
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly createOnlineTransport: () => MultiplayerTransport;
  readonly authControls?: AuthControls;
  /** Remembers the name a guest plays under. */
  readonly storage?: Storage;
  /** Where the seat's reconnect credentials live (default: this tab's sessionStorage). */
  readonly sessionStorage?: Storage;
  /** Join this room on open (`?room=CODE`, invite links and toasts). */
  readonly initialJoinCode?: string;
  /** Open a new room straight away (a Friends-page invite): `kind` defaults to a quiz race. */
  readonly autoCreate?: { readonly kind?: RoomKind; readonly inviteUserId?: string };
  /** The room this tab is in changed (null = none), so the URL can carry `?room=CODE`. */
  readonly onRoomCodeChange?: (roomCode: string | null) => void;
  readonly onFriends?: () => void;
  readonly subscribeFriends?: (listener: () => void) => () => void;
}

const INFO_NOTICE_MS = 5000;

function chatIcon(): HTMLElement {
  const icon = el("span", { className: "multiplayer-chat-toggle-icon" });
  icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.8A2.8 2.8 0 0 1 7.8 4h8.4A2.8 2.8 0 0 1 19 6.8v5.8a2.8 2.8 0 0 1-2.8 2.8h-4.7L7.1 19v-3.7A2.8 2.8 0 0 1 5 12.6V6.8Z"/><path d="M8 8h8M8 11h5.6"/></svg>';
  return icon;
}

function chatRows(messages: readonly PublicChatMessage[], localPlayerId: string | null): readonly HTMLElement[] {
  if (messages.length === 0) return [el("li", { className: "multiplayer-chat-empty", text: "No messages yet. Say hi!" })];
  return messages.map((message) =>
    el("li", {
      className: message.playerId === localPlayerId ? "multiplayer-chat-message is-local" : "multiplayer-chat-message",
      children: [el("span", { className: "multiplayer-chat-author", text: message.playerName }), el("span", { className: "multiplayer-chat-text", text: message.text })],
    }),
  );
}

/** Spectators aren't in this game: the game views only see the people playing it. */
function playingRoom(room: PublicRoomState): PublicRoomState {
  return room.players.some((player) => player.spectator) ? { ...room, players: room.players.filter((player) => !player.spectator) } : room;
}

export function createMultiplayerScreen(options: MultiplayerScreenOptions): Screen {
  const controller = new AbortController();
  const { signal, } = controller;
  const sessionStorage = options.sessionStorage ?? (typeof window !== "undefined" ? window.sessionStorage : undefined);
  const getUser = () => {
    const user = options.authControls?.getUser() ?? null;
    return user ? { displayName: user.displayName, avatarEmoji: user.avatarEmoji } : null;
  };
  let pendingInviteUserId: string | null = null;

  // ---------- Notice: errors and room events, always visible ----------

  let notice: RoomNotice | null = null;
  let lastSessionNotice: RoomNotice | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const noticeText = el("span", { className: "mp-notice-text" });
  const retryButton = el("button", { className: "shell-btn mp-notice-action", text: "Try again", attrs: { type: "button", hidden: "" } });
  const dismissButton = el("button", { className: "mp-notice-dismiss", attrs: { type: "button", "aria-label": "Dismiss" }, children: [shellIcon("x", 16, 2)] });
  const noticeBar = el("div", { className: "mp-notice", attrs: { role: "status", "aria-live": "polite", hidden: "" }, children: [noticeText, retryButton, dismissButton] });

  function showNotice(next: RoomNotice | null): void {
    notice = next;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = next?.tone === "info" ? setTimeout(() => showNotice(null), INFO_NOTICE_MS) : null;
    renderNotice();
  }

  function renderNotice(): void {
    const state = session.state();
    const lost = state.status === "error" && state.room !== null;
    noticeBar.hidden = notice === null;
    noticeBar.classList.toggle("is-error", notice?.tone === "error");
    noticeBar.setAttribute("role", notice?.tone === "error" ? "alert" : "status");
    noticeText.textContent = notice?.text ?? "";
    retryButton.hidden = !lost;
  }

  retryButton.addEventListener("click", () => session.retry(), { signal });
  dismissButton.addEventListener("click", () => {
    showNotice(null);
    session.dismissNotice();
  }, { signal });

  // ---------- Views ----------

  const home = createMultiplayerHome({
    shell: options.shell,
    ...(options.storage ? { storage: options.storage } : {}),
    signal,
    getUser,
    onCreate: (kind, playerName, inviteUserId) => {
      pendingInviteUserId = inviteUserId ?? null;
      session.create({ playerName, avatarEmoji: getLocalAvatar(), categoryIds: roomKindInfo(kind).categoryIds });
    },
    onJoin: (roomCode, playerName) => session.join(roomCode, playerName, getLocalAvatar()),
    ...(options.onFriends ? { onFriends: options.onFriends } : {}),
    ...(options.subscribeFriends ? { subscribeFriends: options.subscribeFriends } : {}),
  });

  const lobby = createMultiplayerLobby({
    signal,
    send: (message) => session.send(message),
    onLeave: () => void confirmLeave().then((leave) => { if (leave) session.leave(); }),
    signedIn: () => getUser() !== null,
    announce: (text, tone = "info") => showNotice({ tone, text }),
  });

  const results = createMultiplayerResults({
    signal,
    send: (message) => session.send(message),
    onLeave: () => session.leave(),
  });

  // Round views are built the first time a room plays that game: MapTap needs WebGL and
  // GeoGuessr loads Street View, and a quiz shouldn't depend on either.
  const spectatorBanner = el("p", {
    className: "mp-spectating",
    attrs: { role: "status", hidden: "" },
    children: [shellIcon("eye", 18, 2), el("span", { text: "You joined mid-game, so you're watching this one. You'll play in the next game." })],
  });
  const gameArea = el("div", { className: "mp-game", children: [spectatorBanner] });
  function lazyView<T extends { readonly element: HTMLElement; readonly destroy: () => void }>(build: () => T): { readonly get: () => T; readonly peek: () => T | null } {
    let view: T | null = null;
    return {
      get: () => {
        if (!view) {
          view = build();
          gameArea.append(view.element);
        }
        return view;
      },
      peek: () => view,
    };
  }
  const quizView = lazyView(() => createMultiplayerGameView({
    countryIndex: options.countryIndex,
    worldCountryFeatures: options.worldCountryFeatures,
    onSubmit: (answer) => session.send({ type: "SUBMIT_ANSWER", answer, clientSentAt: Date.now() }),
    onSkip: () => session.send({ type: "VOTE_SKIP" }),
  }));
  const mapTapView = lazyView(() => createMultiplayerMapTapGameView({
    signal,
    onGuess: (lat, lng) => session.send({ type: "SUBMIT_MAPTAP_GUESS", lat, lng, clientSentAt: Date.now() }),
    onSkip: () => session.send({ type: "VOTE_SKIP" }),
  }));
  const geoGuessrView = lazyView(() => createMultiplayerGeoGuessrGameView({
    signal,
    onGuess: (lat, lng) => session.send({ type: "SUBMIT_GEOGUESSR_GUESS", lat, lng, clientSentAt: Date.now() }),
    onSkip: () => session.send({ type: "VOTE_SKIP" }),
  }));
  const flyoverView = lazyView(() => createMultiplayerFlyoverGameView({
    signal,
    worldCountryFeatures: options.worldCountryFeatures,
    onPosition: (plane) => session.send({ type: "FLYOVER_POSITION", x: plane.x, y: plane.y, heading: plane.heading }),
    onInput: (input) => session.send({ type: "FLYOVER_INPUT", turn: input.turn, towards: input.towards ?? null, boost: input.boost === true }),
    onReach: (index, plane) => session.send({ type: "FLYOVER_REACHED", index, x: plane.x, y: plane.y, clientSentAt: Date.now() }),
    onSkip: (index) => session.send({ type: "FLYOVER_SKIP", index }),
  }));

  // ---------- Chat (in a room) ----------

  let chatOpen = false;
  let seenChat = 0;
  const chatList = el("ol", { className: "multiplayer-chat-list", attrs: { "aria-live": "polite" } });
  const chatInput = el("input", { attrs: { type: "text", autocomplete: "off", maxlength: String(MAX_CHAT_MESSAGE_LENGTH), placeholder: "Message the room", "aria-label": "Message the room" } });
  const chatForm = el("form", { className: "multiplayer-chat-form", children: [chatInput, el("button", { className: "secondary-action", text: "Send", attrs: { type: "submit" } })] });
  const chatBadge = el("span", { className: "multiplayer-chat-badge", attrs: { hidden: "", "aria-hidden": "true" } });
  const chatToggle = el("button", {
    className: "multiplayer-chat-toggle",
    attrs: { type: "button", "aria-label": "Open room chat", "aria-expanded": "false", title: "Room chat" },
    children: [chatIcon(), chatBadge],
  });
  const chatPanel = el("aside", {
    className: "multiplayer-chat-panel",
    attrs: { hidden: "", "aria-label": "Room chat" },
    children: [el("div", { className: "multiplayer-chat-header", children: [el("span", { className: "eyebrow", text: "Room chat" })] }), chatList, chatForm],
  });
  const chatDock = el("div", { className: "multiplayer-chat-dock", attrs: { hidden: "" }, children: [chatPanel, chatToggle] });
  chatToggle.addEventListener("click", () => {
    chatOpen = !chatOpen;
    render(session.state());
    if (chatOpen) chatInput.focus();
  }, { signal });
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    session.send({ type: "SEND_CHAT_MESSAGE", text });
    chatInput.value = "";
  }, { signal });

  // ---------- Page ----------

  const homeHeading = el("div", {
    className: "mp-heading",
    children: [
      el("h1", { className: "mp-title", text: "Play with friends" }),
      el("p", { className: "mp-lede", text: "Real-time games for 2 to 8 players. Open a room, share the link, and race." }),
    ],
  });
  const roomHeading = el("h1", { className: "mp-sr", text: "Multiplayer room" });
  const page = createSitePage(options.shell, {
    section: "multiplayer",
    id: "multiplayer",
    className: "mp-page",
    leaveGuard: () => leaveMessage(),
    content: [homeHeading, roomHeading, noticeBar, home.element, lobby.element, gameArea, results.element],
  });
  page.element.append(chatDock);

  /** What to ask before leaving the room, or null when it's safe to just go. */
  function leaveMessage(): string | null {
    const { room, localPlayerId } = session.state();
    if (!room) return null;
    if (room.status === "playing" || room.status === "round-result") return "Leave this game? You'll drop out of the match in progress.";
    return room.players.some((player) => player.id !== localPlayerId && player.connected) ? `Leave room ${room.roomCode}? The others can carry on without you.` : null;
  }

  function confirmLeave(): Promise<boolean> {
    const message = leaveMessage();
    return message ? options.shell.confirmLeave(message, { confirmLabel: "Leave room", cancelLabel: "Stay" }) : Promise.resolve(true);
  }

  function render(state: RoomSessionState): void {
    if (state.notice !== lastSessionNotice) {
      lastSessionNotice = state.notice;
      showNotice(state.notice);
    } else {
      renderNotice();
    }

    const { room, localPlayerId } = state;
    const view = !room ? "home" : room.status === "lobby" ? "lobby" : room.status === "complete" && state.finalResults ? "results" : "game";
    if (page.element.dataset.view !== view) page.element.scrollTop = 0;
    page.element.dataset.view = view;
    // App-level exits (another invite, the browser Back button) read this to ask first.
    const message = leaveMessage();
    if (message) page.element.dataset.leaveConfirm = message;
    else delete page.element.dataset.leaveConfirm;

    homeHeading.hidden = view !== "home";
    roomHeading.hidden = view === "home";
    home.element.hidden = view !== "home";
    lobby.element.hidden = view !== "lobby";
    gameArea.hidden = view !== "game";
    results.element.hidden = view !== "results";
    home.update({ pending: state.pending });

    chatDock.hidden = !room;
    chatPanel.hidden = !room || !chatOpen;
    chatDock.classList.toggle("is-open", Boolean(room) && chatOpen);
    chatToggle.setAttribute("aria-expanded", String(Boolean(room) && chatOpen));
    chatToggle.setAttribute("aria-label", chatOpen ? "Close room chat" : "Open room chat");
    if (!room) {
      chatOpen = false;
      seenChat = 0;
      return;
    }
    chatList.replaceChildren(...chatRows(room.chatMessages, localPlayerId));
    chatList.scrollTop = chatList.scrollHeight;
    if (chatOpen) seenChat = room.chatMessages.length;
    const unread = Math.max(0, room.chatMessages.length - seenChat);
    chatBadge.hidden = chatOpen || unread === 0;
    chatBadge.textContent = unread > 9 ? "9+" : String(unread);
    chatInput.disabled = state.status !== "connected";

    if (pendingInviteUserId && room.status === "lobby" && localPlayerId === room.hostPlayerId) {
      const invitee = pendingInviteUserId;
      pendingInviteUserId = null;
      void inviteFriendToGame(invitee, room.roomCode).then((ok) => {
        if (!signal.aborted) showNotice(ok ? { tone: "info", text: "Invite sent. They'll see it wherever they are in locato." } : { tone: "error", text: "Couldn't send that invite. Share the link instead." });
      });
    }

    if (view === "lobby") lobby.update({ room, localPlayerId });
    if (view === "results" && state.finalResults) results.update({ room, localPlayerId, results: state.finalResults });

    const me = room.players.find((player) => player.id === localPlayerId);
    const spectating = Boolean(me?.spectator);
    const kind = room.kind;
    spectatorBanner.hidden = view !== "game" || !spectating || kind === "flyover";
    for (const [viewKind, lazy] of [["quiz", quizView], ["map-tap", mapTapView], ["geoguessr", geoGuessrView], ["flyover", flyoverView]] as const) {
      const built = lazy.peek();
      if (built) built.element.hidden = view !== "game" || kind !== viewKind;
    }
    if (view !== "game") return;
    const shown = playingRoom(room);
    const canSubmit = room.status === "playing" && state.status === "connected" && !spectating;
    const feedback = spectating && !state.feedback ? "Watching this game." : state.feedback;
    if (kind === "flyover") flyoverView.get().update({ room: shown, localPlayerId, round: state.round, canSubmit, spectating });
    else if (kind === "map-tap") mapTapView.get().update({ room: shown, localPlayerId, round: state.round, reveal: state.mapTapReveal, finalResults: null, feedback, canSubmit });
    else if (kind === "geoguessr") geoGuessrView.get().update({ room: shown, localPlayerId, round: state.round, reveal: state.geoGuessrReveal, finalResults: null, feedback, canSubmit });
    else quizView.get().update({ room: shown, localPlayerId, round: state.round, roundResult: state.quizReveal, finalResults: null, feedback, canSubmit });
  }

  /** Sounds, stats and Flyover's live traffic: everything a message does besides changing state. */
  function onServerMessage(message: ServerMessage, before: RoomSessionState): void {
    const me = before.localPlayerId;
    switch (message.type) {
      case "FLYOVER_PLANES":
        flyoverView.peek()?.setPlanes(message.planes);
        return;
      case "FLYOVER_PROGRESS":
        flyoverView.peek()?.applyProgress(message);
        return;
      case "ANSWER_ACCEPTED":
        if (message.playerId === me) {
          playCorrect();
          flashScreen("good");
        } else {
          playRoundTaken();
        }
        return;
      case "ANSWER_REJECTED":
        playWrong();
        flashScreen("bad");
        return;
      case "ROUND_ENDED":
        // A taken round already played its cue on ANSWER_ACCEPTED.
        if (!message.results.some((result) => result.correct)) playTimeUp();
        return;
      case "MAPTAP_ROUND_ENDED":
      case "GEOGUESSR_ROUND_ENDED": {
        const top = message.results[0];
        if (top?.guess && top.playerId === me) {
          playCorrect();
          flashScreen("good");
        } else if (top?.guess) {
          playRoundTaken();
        } else {
          playTimeUp();
        }
        return;
      }
      case "GAME_COMPLETED": {
        playVictory();
        // Account records are written from server standings, never uploaded from this page.
        void fetchFullStats().then((stats) => { if (stats) options.authControls?.refreshStats(stats); });
        return;
      }
      default:
        return;
    }
  }

  const session = createRoomSession({
    createTransport: options.createOnlineTransport,
    onChange: render,
    onServerMessage,
    ...(options.onRoomCodeChange ? { onRoomCodeChange: options.onRoomCodeChange } : {}),
    ...(sessionStorage ? { storage: sessionStorage } : {}),
  });

  // Closing the tab mid-game asks first (a reload still reclaims the seat).
  window.addEventListener("beforeunload", (event) => {
    const status = session.state().room?.status;
    if (status === "playing" || status === "round-result") event.preventDefault();
  }, { signal });

  const unsubscribeAuth = options.shell.onAuthChange?.(() => home.refreshUser());

  // ---------- Where to start ----------

  const stored = readStoredSession(sessionStorage);
  const playerName = getUser()?.displayName ?? readPlayerName(options.storage);
  if (options.initialJoinCode) {
    const code = options.initialJoinCode;
    if (stored?.roomCode === code) {
      session.resume(stored);
    } else {
      // A link to another room wins over the seat this tab had: that seat is let go.
      clearStoredSession(sessionStorage);
      if (playerName) session.join(code, playerName, getLocalAvatar());
      else home.prepareJoin(code);
    }
  } else if (stored) {
    session.resume(stored);
  } else if (options.autoCreate && playerName) {
    pendingInviteUserId = options.autoCreate.inviteUserId ?? null;
    session.create({ playerName, avatarEmoji: getLocalAvatar(), categoryIds: roomKindInfo(options.autoCreate.kind ?? "quiz").categoryIds });
  }
  render(session.state());

  return {
    element: page.element,
    destroy: () => {
      // Navigating away leaves the room for good (the header and App asked first when it mattered).
      if (session.state().room || session.state().pending) session.leave();
      controller.abort();
      if (noticeTimer) clearTimeout(noticeTimer);
      session.destroy();
      unsubscribeAuth?.();
      home.destroy();
      for (const lazy of [quizView, mapTapView, geoGuessrView, flyoverView]) lazy.peek()?.destroy();
      page.destroy();
    },
  };
}
