import type { MultiplayerTransport, PublicRoomState, PublicRoundState, RoundResult, FinalResult, ServerMessage, TransportStatus } from "../../core/multiplayer";
import { gameModeOptions, type GameModeOption } from "../../core/gameModes";
import type { CountryIndex } from "../../core/countries";
import type { WorldCountryFeature } from "../../core/map";
import type { Screen } from "../../app/router";
import type { AuthControls } from "../components/AuthPanel";
import { getPlayerEmoji } from "../../core/auth/avatars";
import { fetchFriends, inviteFriendToGame, recordGame, type FriendInfo } from "../../core/auth";
import { el } from "../dom/createElement";
import { enhanceDropdown } from "../dom/dropdown";
import { createMultiplayerGameView } from "./MultiplayerGameScreen";
import { createEndGameModal } from "./MultiplayerEndGameModal";

export interface MultiplayerLobbyScreenOptions {
  readonly countryIndex: CountryIndex;
  readonly worldCountryFeatures: readonly WorldCountryFeature[];
  readonly createOnlineTransport: () => MultiplayerTransport;
  readonly onBackToSolo: () => void;
  readonly onDailyChallenge: () => void;
  readonly authControls?: AuthControls;
  // When set, auto-join this room code on mount (used by friend game invites).
  readonly initialJoinCode?: string;
}

// Ephemeral reconnect credentials. Kept in sessionStorage so a page reload or a dropped socket
// can reclaim the same server-side player slot (and score) instead of spawning a new identity.
const SESSION_STORAGE_KEY = "locato.mp.session";

interface StoredSession {
  readonly roomCode: string;
  readonly playerId: string;
  readonly sessionToken: string;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.roomCode !== "string" || typeof parsed.playerId !== "string" || typeof parsed.sessionToken !== "string") return null;
    return { roomCode: parsed.roomCode, playerId: parsed.playerId, sessionToken: parsed.sessionToken };
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession): void {
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage may be unavailable (private mode); reconnect simply degrades to a fresh join.
  }
}

function clearStoredSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore: nothing actionable if storage is unavailable.
  }
}

interface RoundReveal {
  readonly answer: string;
  readonly results: readonly RoundResult[];
}

type MultiplayerPlayMode = "flags" | "flag-colors" | "shapes" | "codes" | "capitals" | "click-country" | "spot-country";

type MultiplayerModeOption = Omit<GameModeOption, "id"> & { readonly id: MultiplayerPlayMode };

const MULTIPLAYER_MODE_IDS: readonly MultiplayerPlayMode[] = ["flags", "flag-colors", "shapes", "codes", "capitals", "click-country", "spot-country"];

const MULTIPLAYER_MODE_OPTIONS: readonly MultiplayerModeOption[] = gameModeOptions
  .filter((option) => MULTIPLAYER_MODE_IDS.includes(option.id as MultiplayerPlayMode))
  .map((option) => ({ ...option, id: option.id as MultiplayerPlayMode }));

function getMultiplayerModeOption(mode: MultiplayerPlayMode): MultiplayerModeOption {
  return MULTIPLAYER_MODE_OPTIONS.find((option) => option.id === mode) ?? MULTIPLAYER_MODE_OPTIONS[0]!;
}

function modeToCategoryId(mode: MultiplayerPlayMode): string {
  return mode === "click-country" ? "pick-country" : mode;
}

function categoryIdToMode(categoryId: string): MultiplayerPlayMode | null {
  if (categoryId === "pick-country") return "click-country";
  return MULTIPLAYER_MODE_IDS.includes(categoryId as MultiplayerPlayMode) ? (categoryId as MultiplayerPlayMode) : null;
}

function categoryIdsForModes(modes: readonly MultiplayerPlayMode[]): readonly string[] {
  return [...new Set(modes.map(modeToCategoryId))];
}

function modesFromCategoryIds(categoryIds: readonly string[]): readonly MultiplayerPlayMode[] {
  const modes = categoryIds.map(categoryIdToMode).filter((mode): mode is MultiplayerPlayMode => mode !== null);
  return modes.length > 0 ? [...new Set(modes)] : ["flags"];
}

function modeSelectionSummary(modes: readonly MultiplayerPlayMode[]): string {
  if (modes.length === 0) return "No modes";
  if (modes.length === 1) return getMultiplayerModeOption(modes[0]!).label;
  return `${modes.length} modes selected`;
}

function modeSelectionDescription(modes: readonly MultiplayerPlayMode[]): string {
  if (modes.length === 0) return "Select at least one mode.";
  return modes.map((mode) => getMultiplayerModeOption(mode).label).join(", ");
}

function createMultiplayerModeSelector(options: {
  readonly selectedModes: readonly MultiplayerPlayMode[];
  readonly signal: AbortSignal;
  readonly name: string;
  readonly label?: string;
  readonly onChange: (modes: readonly MultiplayerPlayMode[]) => void;
}): { readonly element: HTMLElement; readonly selectedModes: () => readonly MultiplayerPlayMode[]; readonly setSelectedModes: (modes: readonly MultiplayerPlayMode[]) => void; readonly setDisabled: (disabled: boolean) => void } {
  let selectedModes = modesFromCategoryIds(categoryIdsForModes(options.selectedModes));
  let disabled = false;
  let element: HTMLDetailsElement;
  const selectedText = el("span", { className: "category-dropdown-selected" });
  const selectedDescription = el("span", { className: "category-dropdown-selected-description" });

  const modeControls = MULTIPLAYER_MODE_OPTIONS.map((modeOption) => {
    const checkbox = el("input", { attrs: { type: "checkbox", name: options.name, value: modeOption.id } });
    const label = el("label", {
      className: "category-option game-mode-option",
      attrs: { title: modeOption.description },
      children: [
        checkbox,
        el("span", {
          className: "game-mode-option-copy",
          children: [el("span", { className: "game-mode-option-label", text: modeOption.label }), el("span", { className: "game-mode-option-description", text: modeOption.description })],
        }),
      ],
    });
    return { modeOption, checkbox, label };
  });

  function setSelectedModes(modes: readonly MultiplayerPlayMode[]): void {
    selectedModes = modesFromCategoryIds(categoryIdsForModes(modes));
    selectedText.textContent = modeSelectionSummary(selectedModes);
    selectedDescription.textContent = modeSelectionDescription(selectedModes);
    for (const control of modeControls) control.checkbox.checked = selectedModes.includes(control.modeOption.id);
  }

  function setDisabled(nextDisabled: boolean): void {
    disabled = nextDisabled;
    element.classList.toggle("is-disabled", disabled);
    for (const control of modeControls) control.checkbox.disabled = disabled;
    if (disabled && element instanceof HTMLDetailsElement) element.open = false;
  }

  for (const control of modeControls) {
    control.checkbox.addEventListener(
      "change",
      () => {
        if (disabled) return;
        const next = modeControls.filter((item) => item.checkbox.checked).map((item) => item.modeOption.id);
        if (next.length === 0) {
          control.checkbox.checked = true;
          return;
        }
        setSelectedModes(next);
        options.onChange(selectedModes);
      },
      { signal: options.signal },
    );
  }

  const menuChildren: HTMLElement[] = [];
  let activeGroup: string | null = null;
  for (const control of modeControls) {
    if (control.modeOption.group !== activeGroup) {
      activeGroup = control.modeOption.group;
      menuChildren.push(el("div", { className: "game-mode-group-label", text: activeGroup }));
    }
    menuChildren.push(control.label);
  }

  const summary = el("summary", {
    className: "category-dropdown-summary",
    children: [
      el("span", { className: "category-row-label", text: options.label ?? "Game modes" }),
      el("span", { className: "game-mode-selected-copy", children: [selectedText, selectedDescription] }),
    ],
  });

  element = el("details", {
    className: "category-dropdown game-mode-dropdown multiplayer-mode-dropdown",
    children: [
      summary,
      el("div", { className: "category-dropdown-menu", attrs: { role: "group", "aria-label": "Multiplayer game modes" }, children: menuChildren }),
    ],
  });

  summary.addEventListener(
    "click",
    (event) => {
      if (!disabled) return;
      event.preventDefault();
    },
    { signal: options.signal },
  );

  setSelectedModes(selectedModes);
  enhanceDropdown(element, { signal: options.signal, closeOnSelect: false });

  return { element, selectedModes: () => selectedModes, setSelectedModes, setDisabled };
}

function setupCopyForModes(modes: readonly MultiplayerPlayMode[]): { readonly title: string; readonly description: string } {
  const selected: readonly MultiplayerPlayMode[] = modes.length > 0 ? modes : ["flags"];
  const hasMapMode = selected.some((mode) => mode === "click-country" || mode === "spot-country");
  return {
    title: hasMapMode ? "Host or join a mixed map race" : selected.length > 1 ? "Host or join a mixed prompt race" : "Host or join a prompt race",
    description: `${modeSelectionDescription(selected)}. Create a room or join a code to race friends in real time.`,
  };
}

function createBrand(): HTMLElement {
  return el("div", {
    className: "brand-lockup compact",
    children: [el("img", { className: "brand-logo", attrs: { src: "logo.svg", alt: "" } }), el("span", { className: "brand-name", text: "locato" })],
  });
}

function ownPlayer(room: PublicRoomState | null, playerId: string | null) {
  return room && playerId ? room.players.find((player) => player.id === playerId) ?? null : null;
}

function allConnectedPlayersReady(room: PublicRoomState): boolean {
  return room.players.every((player) => player.id === room.hostPlayerId || !player.connected || player.ready);
}

function createPlayerRows(room: PublicRoomState, localPlayerId: string | null): readonly HTMLElement[] {
  return room.players.map((player) => {
    const emoji = getPlayerEmoji(player.id, player.id === localPlayerId);
    return el("li", {
      className: player.id === localPlayerId ? "player-row is-local" : "player-row",
      children: [
        el("span", { className: "player-emoji", text: emoji, attrs: { "aria-hidden": "true" } }),
        el("span", { className: "player-name", text: `${player.name}${player.id === room.hostPlayerId ? " · host" : ""}` }),
        el("span", { className: player.connected ? "player-status" : "player-status offline", text: player.connected ? (player.ready ? "ready" : "not ready") : "offline" }),
      ],
    });
  });
}

function safeConnect(transport: MultiplayerTransport, afterConnect: () => void, onError: (message: string) => void): void {
  transport
    .connect()
    .then(afterConnect)
    .catch((error: unknown) => onError(error instanceof Error ? error.message : "Unable to connect to multiplayer."));
}

export function createMultiplayerLobbyScreen(options: MultiplayerLobbyScreenOptions): Screen {
  const controller = new AbortController();
  let transport: MultiplayerTransport | null = null;
  let cleanupMessageHandler: (() => void) | null = null;
  let cleanupStatusHandler: (() => void) | null = null;
  let status: TransportStatus = "idle";
  let localPlayerId: string | null = null;
  let room: PublicRoomState | null = null;
  let activeRound: PublicRoundState | null = null;
  let roundReveal: RoundReveal | null = null;
  let finalResults: readonly FinalResult[] | null = null;
  let sessionToken: string | null = null;
  let joinedRoomCode: string | null = null;
  // Only online create/join flows are worth persisting; a reload should not try to rejoin a
  // stale session against the real server.
  let allowSessionPersistence = false;
  let feedback = "Create a room or join with a code.";

  const nameInput = el("input", { attrs: { type: "text", autocomplete: "nickname", maxlength: "32", placeholder: "Player name", value: "Player" } });
  const joinCodeInput = el("input", { attrs: { type: "text", autocomplete: "off", maxlength: "12", placeholder: "Room code" } });
  const roundLimitSelect = el("select", {
    attrs: { "aria-label": "Rounds" },
    children: [5, 10, 15, 20].map((count) => el("option", { text: `${count} rounds`, attrs: { value: String(count), ...(count === 10 ? { selected: "" } : {}) } })),
  });
  const roundDurationSelect = el("select", {
    attrs: { "aria-label": "Timer" },
    children: [
      { label: "15 sec", value: 15_000 },
      { label: "30 sec", value: 30_000 },
      { label: "45 sec", value: 45_000 },
      { label: "60 sec", value: 60_000 },
    ].map((option) => el("option", { text: option.label, attrs: { value: String(option.value), ...(option.value === 30_000 ? { selected: "" } : {}) } })),
  });
  let playModes: readonly MultiplayerPlayMode[] = ["flags"];
  const initialSetupCopy = setupCopyForModes(playModes);
  const setupTitle = el("h1", { text: initialSetupCopy.title });
  const setupDescription = el("p", {
    className: "muted",
    text: initialSetupCopy.description,
  });
  const modeDropdown = createMultiplayerModeSelector({
    selectedModes: playModes,
    signal: controller.signal,
    name: "multiplayer-setup-mode",
    onChange: (modes) => {
      playModes = modes;
      const setupCopy = setupCopyForModes(modes);
      setupTitle.textContent = setupCopy.title;
      setupDescription.textContent = setupCopy.description;
    },
  });
  const lobbyModeDropdown = createMultiplayerModeSelector({
    selectedModes: playModes,
    signal: controller.signal,
    name: "multiplayer-lobby-mode",
    label: "Room modes",
    onChange: (modes) => {
      if (!room || room.status !== "lobby" || localPlayerId !== room.hostPlayerId) return;
      transport?.send({ type: "SET_ROOM_OPTIONS", categoryIds: categoryIdsForModes(modes) });
    },
  });
  const statusText = el("p", { className: "multiplayer-status", text: feedback });
  const roomCode = el("strong", { className: "room-code", text: "----" });
  const roomSettings = el("p", { className: "room-settings", text: "" });
  const playerList = el("ul", { className: "player-list" });
  const inviteList = el("div", { className: "invite-list" });
  const inviteSection = el("div", { className: "invite-section", attrs: { hidden: "true" }, children: [el("p", { className: "eyebrow", text: "INVITE FRIENDS" }), inviteList] });
  const readyButton = el("button", { className: "secondary-action", text: "Ready", attrs: { type: "button" } });
  const startButton = el("button", { className: "primary-action", text: "Start game", attrs: { type: "button" } });
  const leaveButton = el("button", { className: "ghost-action", text: "Leave room", attrs: { type: "button" } });
  const createButton = el("button", { className: "primary-action", text: "Create online room", attrs: { type: "button" } });
  const joinButton = el("button", { className: "secondary-action", text: "Join online room", attrs: { type: "button" } });
  const copyButton = el("button", { className: "ghost-action copy-code", text: "Copy code", attrs: { type: "button" } });
  const dailyButton = el("button", { className: "ghost-action screen-header-action", text: "Daily Challenge", attrs: { type: "button", "aria-label": "Open daily challenge" } });
  const backButton = el("button", { className: "ghost-action screen-back-button", text: "Back", attrs: { type: "button", "aria-label": "Back to game" } });

  const setupPanel = el("section", {
    className: "multiplayer-card multiplayer-setup",
    children: [
      el("p", { className: "eyebrow", text: "MULTIPLAYER" }),
      setupTitle,
      setupDescription,
      el("div", { className: "multiplayer-form-grid", children: [nameInput, modeDropdown.element, roundLimitSelect, roundDurationSelect, joinCodeInput] }),
      el("div", { className: "actions", children: [createButton, joinButton] }),
    ],
  });

  const lobbyPanel = el("section", {
    className: "multiplayer-card lobby-panel",
    children: [
      el("p", { className: "eyebrow", text: "ROOM" }),
      el("div", { className: "room-code-row", children: [el("span", { text: "Code" }), roomCode, copyButton] }),
      roomSettings,
      lobbyModeDropdown.element,
      playerList,
      inviteSection,
      el("div", { className: "actions", children: [readyButton, startButton, leaveButton] }),
    ],
  });

  const gameView = createMultiplayerGameView({
    countryIndex: options.countryIndex,
    worldCountryFeatures: options.worldCountryFeatures,
    onSubmit: (answer) => {
      transport?.send({ type: "SUBMIT_ANSWER", answer, clientSentAt: Date.now() });
    },
    onSkip: () => {
      transport?.send({ type: "VOTE_SKIP" });
    },
  });

  function disconnectCurrentTransport(): void {
    cleanupMessageHandler?.();
    cleanupStatusHandler?.();
    cleanupMessageHandler = null;
    cleanupStatusHandler = null;
    transport?.disconnect();
    transport = null;
  }

  function playerName(playerId: string): string {
    return room?.players.find((player) => player.id === playerId)?.name ?? "A player";
  }

  function resetMultiplayerState(): void {
    room = null;
    activeRound = null;
    roundReveal = null;
    finalResults = null;
    localPlayerId = null;
    sessionToken = null;
    joinedRoomCode = null;
  }

  function leaveRoomFlow(): void {
    transport?.send({ type: "LEAVE_ROOM" });
    disconnectCurrentTransport();
    clearStoredSession();
    resetMultiplayerState();
    allowSessionPersistence = false;
    status = "idle";
    feedback = "Left the room.";
    render();
  }

  const endGameModal = createEndGameModal({
    onPlayAgain: () => transport?.send({ type: "PLAY_AGAIN" }),
    onLeave: leaveRoomFlow,
  });
  // Online friends fetched once per room; the list is re-filtered on every render so anyone
  // already in (or who joins) the lobby is never offered as an invite target.
  let invitesLoadedFor: string | null = null;
  let onlineFriends: readonly FriendInfo[] = [];
  let inviteSignature = "";
  const invited = new Set<string>();

  function renderInvites(): void {
    const inRoom = new Set((room?.players ?? []).map((player) => player.name));
    const eligible = onlineFriends.filter((friend) => friend.online && !inRoom.has(friend.user.username));
    const signature = `${eligible.map((friend) => friend.user.id).join(",")}|${[...invited].join(",")}`;
    if (signature === inviteSignature) return; // nothing relevant changed; keep the current buttons
    inviteSignature = signature;
    if (eligible.length === 0) {
      inviteList.replaceChildren(el("p", { className: "invite-empty", text: "No friends available to invite." }));
      return;
    }
    inviteList.replaceChildren(
      ...eligible.map((friend) => {
        const done = invited.has(friend.user.id);
        const button = el("button", { className: "secondary-action invite-btn", text: done ? `Invited ${friend.user.username} ✓` : `Invite ${friend.user.username}`, attrs: { type: "button" } });
        button.disabled = done;
        button.addEventListener(
          "click",
          () => {
            button.disabled = true;
            void inviteFriendToGame(friend.user.id, room?.roomCode ?? "").then((ok) => {
              if (ok) {
                invited.add(friend.user.id);
                button.textContent = `Invited ${friend.user.username} ✓`;
              } else {
                button.disabled = false;
                button.textContent = `Invite ${friend.user.username}`;
              }
            });
          },
          { signal: controller.signal },
        );
        return button;
      }),
    );
  }

  async function loadInviteFriends(): Promise<void> {
    onlineFriends = ((await fetchFriends())?.friends ?? []).filter((friend) => friend.online);
    inviteSignature = ""; // force a rebuild now that data has arrived
    renderInvites();
  }

  function render(): void {
    const hasRoom = room !== null;
    statusText.hidden = !hasRoom;
    statusText.textContent = `${status}: ${feedback}`;
    setupPanel.hidden = hasRoom;
    lobbyPanel.hidden = !hasRoom || room?.status !== "lobby";
    gameView.element.hidden = !hasRoom || room?.status === "lobby";

    // Toggle the modal before the no-room early return so leaving the room also dismisses it.
    if (room && room.status === "complete" && finalResults) {
      endGameModal.show({ localPlayerId, results: finalResults, canPlayAgain: localPlayerId === room.hostPlayerId });
    } else {
      endGameModal.hide();
    }

    if (!room) return;

    roomCode.textContent = room.roomCode;
    const roomModes = modesFromCategoryIds(room.categoryIds);
    const localIsHost = localPlayerId === room.hostPlayerId;
    lobbyModeDropdown.setSelectedModes(roomModes);
    lobbyModeDropdown.setDisabled(room.status !== "lobby" || !localIsHost);
    roomSettings.textContent = `${modeSelectionDescription(roomModes)} · ${room.settings.roundLimit} rounds · ${Math.round(room.settings.roundDurationMs / 1000)} sec timer`;
    playerList.replaceChildren(...createPlayerRows(room, localPlayerId));
    // Show "invite friends" only to signed-in users while waiting in the lobby. Friends are fetched
    // once per room, then re-filtered every render so anyone in the lobby is excluded live.
    const authed = options.authControls?.getUser() != null;
    const showInvites = room.status === "lobby" && authed;
    inviteSection.hidden = !showInvites;
    if (showInvites) {
      if (invitesLoadedFor !== room.roomCode) {
        invitesLoadedFor = room.roomCode;
        onlineFriends = [];
        invited.clear();
        inviteSignature = "";
        void loadInviteFriends();
      } else {
        renderInvites();
      }
    } else {
      invitesLoadedFor = null;
    }
    const currentPlayer = ownPlayer(room, localPlayerId);
    readyButton.textContent = currentPlayer?.ready ? "Unready" : "Ready";
    readyButton.disabled = room.status !== "lobby" || !currentPlayer;
    startButton.disabled = room.status !== "lobby" || localPlayerId !== room.hostPlayerId || !allConnectedPlayersReady(room);

    const canSubmit = room.status === "playing" && status === "connected";
    gameView.update({ room, localPlayerId, round: activeRound, roundResult: roundReveal, finalResults, feedback, canSubmit });
  }

  function handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case "SESSION_ASSIGNED":
        localPlayerId = message.playerId;
        sessionToken = message.sessionToken;
        joinedRoomCode = message.roomCode;
        if (allowSessionPersistence) writeStoredSession({ roomCode: message.roomCode, playerId: message.playerId, sessionToken: message.sessionToken });
        feedback = `Connected to room ${message.roomCode}.`;
        break;
      case "ROOM_SNAPSHOT":
        room = message.room;
        activeRound = message.room.round;
        if (message.room.status === "playing") roundReveal = null;
        // A host rematch returns the room to the lobby; drop the stale final standings so the
        // game-over modal does not flash back up before the next game starts.
        if (message.room.status === "lobby") finalResults = null;
        break;
      case "GAME_STARTED":
      case "ROUND_STARTED":
        activeRound = message.round;
        roundReveal = null;
        finalResults = null;
        feedback = `Round ${message.round.roundNumber} is live.`;
        break;
      case "ANSWER_ACCEPTED":
        feedback = message.playerId === localPlayerId ? `You took the round for ${message.points} points.` : `${playerName(message.playerId)} took the round.`;
        break;
      case "ANSWER_REJECTED":
        feedback = message.reason;
        break;
      case "ROUND_ENDED": {
        roundReveal = { answer: message.answer, results: message.results };
        const winner = message.results.find((result) => result.correct);
        feedback = winner ? `${message.answer} — ${winner.name} took it.` : `${message.answer} — nobody got it.`;
        break;
      }
      case "GAME_COMPLETED": {
        finalResults = message.results;
        feedback = "Game complete.";
        // Record this player's stats to their account if they're signed in.
        // The server has already validated the results; we just forward our own row.
        const myResult = message.results.find((result) => result.playerId === localPlayerId);
        if (myResult) {
          void recordGame({
            mode: "multiplayer",
            categoryIds: room?.categoryIds ?? [],
            correctAnswers: myResult.correctAnswers,
            wrongAnswers: myResult.wrongAnswers,
            score: myResult.score,
            bestStreak: 0,
            rank: myResult.rank,
            totalPlayers: message.results.length,
          }).then((stats) => {
            if (stats) options.authControls?.refreshStats(stats);
          });
        }
        break;
      }
      case "PLAYER_JOINED":
        feedback = `${message.player.name} joined.`;
        break;
      case "PLAYER_LEFT":
        feedback = `${message.name} left.`;
        break;
      case "ERROR":
        feedback = message.message;
        // A failed (re)join must drop us back to setup instead of looping against a dead seat.
        if (message.code === "session-expired" || message.code === "room-not-found") {
          clearStoredSession();
          resetMultiplayerState();
        }
        break;
    }
    render();
  }

  function bindTransport(nextTransport: MultiplayerTransport): void {
    disconnectCurrentTransport();
    transport = nextTransport;
    cleanupMessageHandler = nextTransport.onMessage(handleMessage);
    cleanupStatusHandler = nextTransport.onStatusChange((nextStatus) => {
      status = nextStatus;
      // A reconnect lands here with credentials already in hand: reclaim the seat automatically.
      // The initial connect has no token yet, so the create/join path is left untouched.
      if (nextStatus === "connected" && sessionToken && joinedRoomCode && localPlayerId) {
        nextTransport.send({ type: "REJOIN_ROOM", roomCode: joinedRoomCode, playerId: localPlayerId, sessionToken });
      }
      render();
    });
  }

  function connectWith(nextTransport: MultiplayerTransport, afterConnect: () => void): void {
    bindTransport(nextTransport);
    safeConnect(nextTransport, afterConnect, (message) => {
      feedback = message;
      render();
    });
  }

  createButton.addEventListener(
    "click",
    () => {
      allowSessionPersistence = true;
      const playerName = nameInput.value.trim() || "Player";
      connectWith(options.createOnlineTransport(), () =>
        transport?.send({
          type: "CREATE_ROOM",
          playerName,
          categoryIds: categoryIdsForModes(modeDropdown.selectedModes()),
          roundLimit: Number(roundLimitSelect.value),
          roundDurationMs: Number(roundDurationSelect.value),
        }),
      );
    },
    { signal: controller.signal },
  );

  joinButton.addEventListener(
    "click",
    () => {
      allowSessionPersistence = true;
      const playerName = nameInput.value.trim() || "Player";
      const roomCodeValue = joinCodeInput.value.trim();
      if (!roomCodeValue) {
        feedback = "Enter a room code to join online.";
        render();
        return;
      }
      connectWith(options.createOnlineTransport(), () => transport?.send({ type: "JOIN_ROOM", roomCode: roomCodeValue, playerName }));
    },
    { signal: controller.signal },
  );

  copyButton.addEventListener(
    "click",
    () => {
      const code = room?.roomCode;
      if (!code) return;
      const clipboard = navigator.clipboard;
      if (!clipboard) {
        feedback = "Clipboard unavailable — copy the code manually.";
        render();
        return;
      }
      const origin = window.location.origin;
      const username = options.authControls?.getUser()?.displayName ?? null;
      const roomUrl = `${origin}/?room=${encodeURIComponent(code)}`;
      const shareText = username
        ? `${username} invited you to play locato.\nJoin here: ${roomUrl}\nRoom code: ${code}`
        : `Join my locato multiplayer room.\nJoin here: ${roomUrl}\nRoom code: ${code}`;
      void clipboard.writeText(shareText).then(
        () => {
          feedback = "Room invite link copied.";
          render();
        },
        () => {
          feedback = "Copy failed — copy the code manually.";
          render();
        },
      );
    },
    { signal: controller.signal },
  );

  readyButton.addEventListener(
    "click",
    () => {
      const currentPlayer = ownPlayer(room, localPlayerId);
      if (currentPlayer) transport?.send({ type: "SET_READY", ready: !currentPlayer.ready });
    },
    { signal: controller.signal },
  );

  startButton.addEventListener("click", () => transport?.send({ type: "START_GAME" }), { signal: controller.signal });
  leaveButton.addEventListener("click", () => leaveRoomFlow(), { signal: controller.signal });
  dailyButton.addEventListener(
    "click",
    () => {
      disconnectCurrentTransport();
      clearStoredSession();
      options.onDailyChallenge();
    },
    { signal: controller.signal },
  );
  backButton.addEventListener(
    "click",
    () => {
      disconnectCurrentTransport();
      clearStoredSession();
      options.onBackToSolo();
    },
    { signal: controller.signal },
  );

  const element = el("section", {
    className: "game-screen multiplayer-screen",
    children: [
      el("header", { className: "stats-header multiplayer-header", children: [createBrand(), el("div", { className: "screen-header-actions", children: [dailyButton, backButton] })] }),
      statusText,
      el("div", { className: "multiplayer-layout", children: [setupPanel, lobbyPanel, gameView.element] }),
      endGameModal.element,
    ],
  });

  const storedSession = readStoredSession();
  if (storedSession) {
    allowSessionPersistence = true;
    localPlayerId = storedSession.playerId;
    sessionToken = storedSession.sessionToken;
    joinedRoomCode = storedSession.roomCode;
    feedback = `Reconnecting to room ${storedSession.roomCode}…`;
    // bindTransport's status handler fires REJOIN_ROOM the moment the socket opens.
    connectWith(options.createOnlineTransport(), () => {});
  } else if (options.initialJoinCode) {
    // Arrived via a friend's game invite: join their room straight away.
    const code = options.initialJoinCode;
    joinCodeInput.value = code;
    const playerName = nameInput.value.trim() || "Player";
    connectWith(options.createOnlineTransport(), () => transport?.send({ type: "JOIN_ROOM", roomCode: code, playerName }));
  }

  render();

  return {
    element,
    destroy: () => {
      controller.abort();
      disconnectCurrentTransport();
      gameView.destroy();
    },
  };
}
