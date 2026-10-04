/*
 * Multiplayer, before you're in a room: pick a game to open a room straight away, or join one
 * with a code. Friends online can be invited in one tap. Everything else (settings, who's in)
 * lives in the lobby once the room exists.
 */

import type { RoomKind } from "../../../core/multiplayer";
import { cleanJoinCode, MAX_PLAYER_NAME_LENGTH, readPlayerName, writePlayerName } from "../../../core/multiplayer/localPlayer";
import { fetchFriends, type FriendInfo } from "../../../core/auth";
import { getLocalAvatar } from "../../../core/auth/avatars";
import { el } from "../../dom/createElement";
import { shellIcon, type ShellContext } from "../../shell";
import { ROOM_KIND_INFO } from "./roomModes";

export interface HomeUser {
  readonly displayName: string;
  readonly avatarEmoji: string | null;
}

export interface MultiplayerHomeOptions {
  readonly shell: ShellContext;
  readonly storage?: Storage;
  readonly signal: AbortSignal;
  readonly getUser: () => HomeUser | null;
  /** Open a room of this kind (optionally inviting a friend once it exists). The name is saved. */
  readonly onCreate: (kind: RoomKind, playerName: string, inviteUserId?: string) => void;
  readonly onJoin: (roomCode: string, playerName: string) => void;
  readonly onFriends?: () => void;
  /** Live presence changes; the listener refetches friends. Returns an unsubscribe. */
  readonly subscribeFriends?: (listener: () => void) => () => void;
}

export interface MultiplayerHomeState {
  readonly pending: "create" | "join" | "rejoin" | null;
}

export interface MultiplayerHome {
  readonly element: HTMLElement;
  readonly update: (state: MultiplayerHomeState) => void;
  /** Prefill the join box (an invite link for a guest who still needs a name). */
  readonly prepareJoin: (roomCode: string) => void;
  /** The signed-in player changed: swap the name field for "Playing as". */
  readonly refreshUser: () => void;
  readonly destroy: () => void;
}

export function createMultiplayerHome(options: MultiplayerHomeOptions): MultiplayerHome {
  const { signal } = options;
  let pending: MultiplayerHomeState["pending"] = null;
  let creatingKind: RoomKind | null = null;

  // ---------- Who you are ----------

  const nameId = "mp-name";
  const nameInput = el("input", {
    className: "mp-input",
    attrs: { id: nameId, type: "text", autocomplete: "nickname", maxlength: String(MAX_PLAYER_NAME_LENGTH), placeholder: "e.g. Sam", enterkeyhint: "done", value: readPlayerName(options.storage) ?? "" },
  });
  const nameError = el("p", { className: "mp-field-error", attrs: { id: `${nameId}-error`, role: "alert", hidden: "" } });
  const nameField = el("div", {
    className: "mp-name-field",
    children: [
      el("label", { className: "mp-field-label", text: "Your name", attrs: { for: nameId } }),
      nameInput,
      el("span", { className: "mp-field-hint", text: "Shown to everyone in the room. No account needed." }),
      nameError,
    ],
  });
  const playingAs = el("p", { className: "mp-playing-as", attrs: { hidden: "" } });

  function renderUser(): void {
    const user = options.getUser();
    nameField.hidden = user !== null;
    playingAs.hidden = user === null;
    if (user) {
      playingAs.replaceChildren(
        el("span", { className: "mp-avatar is-emoji", text: user.avatarEmoji ?? getLocalAvatar(), attrs: { "aria-hidden": "true" } }),
        el("span", { children: [el("span", { className: "mp-muted", text: "Playing as " }), el("strong", { text: user.displayName })] }),
      );
    }
  }

  /** The name to play under, or null (and a nudge) when a guest hasn't picked one. */
  function claimName(): string | null {
    const user = options.getUser();
    if (user) return user.displayName;
    const value = nameInput.value.trim();
    if (!value) {
      nameError.textContent = "Pick a name first, so friends know who's who.";
      nameError.hidden = false;
      nameInput.setAttribute("aria-invalid", "true");
      nameInput.setAttribute("aria-describedby", `${nameId}-error`);
      nameInput.focus();
      return null;
    }
    writePlayerName(options.storage, value);
    return value;
  }

  nameInput.addEventListener("input", () => {
    nameError.hidden = true;
    nameInput.removeAttribute("aria-invalid");
    nameInput.removeAttribute("aria-describedby");
  }, { signal });

  // ---------- Start a game: one tap opens a room ----------

  const kindButtons = ROOM_KIND_INFO.map((info) => {
    const status = el("span", { className: "mp-kind-status", attrs: { "aria-live": "polite" } });
    const button = el("button", {
      className: `mp-kind is-${info.kind}`,
      attrs: { type: "button", "data-kind": info.kind },
      children: [
        el("span", { className: "mp-kind-icon", children: [shellIcon(info.icon, 22, 1.9)] }),
        el("span", { className: "mp-kind-copy", children: [el("strong", { className: "mp-kind-label", text: info.label }), el("span", { className: "mp-kind-pitch", text: info.pitch })] }),
        status,
        el("span", { className: "mp-kind-go", children: [shellIcon("arrow-right", 18, 2)] }),
      ],
      on: {
        click: () => {
          if (pending) return;
          const name = claimName();
          if (!name) return;
          creatingKind = info.kind;
          options.onCreate(info.kind, name);
        },
      },
    });
    return { info, button, status };
  });

  const startCard = el("section", {
    className: "mp-card mp-start",
    attrs: { "aria-labelledby": "mp-start-title" },
    children: [
      el("header", {
        className: "mp-start-head",
        children: [
          el("p", { className: "mp-kicker", children: [el("span", { className: "mp-live-dot", attrs: { "aria-hidden": "true" } }), el("span", { text: "Live · 2 to 8 players" })] }),
          el("h2", { className: "mp-start-title", text: "Start a game", attrs: { id: "mp-start-title" } }),
          el("p", { className: "mp-muted", text: "Pick a game and your room opens straight away. Share the link, and change anything once you're in." }),
        ],
      }),
      nameField,
      playingAs,
      el("div", { className: "mp-kinds", attrs: { role: "group", "aria-label": "Games" }, children: kindButtons.map((entry) => entry.button) }),
    ],
  });

  // ---------- Join with a code ----------

  const joinId = "mp-join-code";
  const joinInput = el("input", {
    className: "mp-input mp-join-input",
    attrs: { id: joinId, type: "text", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", maxlength: "64", placeholder: "ABCDE", enterkeyhint: "go", "aria-describedby": `${joinId}-hint` },
  });
  const joinHint = el("span", { className: "mp-field-hint", text: "Paste a code or an invite link.", attrs: { id: `${joinId}-hint` } });
  const joinButton = el("button", { className: "shell-btn mp-join-button", attrs: { type: "submit" }, children: [el("span", { text: "Join" }), shellIcon("arrow-right", 16, 2)] });
  const joinTitle = el("h2", { className: "mp-card-title", text: "Got a code?", attrs: { id: "mp-join-title" } });
  const joinLede = el("p", { className: "mp-muted", attrs: { hidden: "" } });
  const joinNameSlot = el("div", { className: "mp-join-name" });
  const joinForm = el("form", {
    className: "mp-card mp-join",
    attrs: { "aria-labelledby": "mp-join-title" },
    children: [
      joinTitle,
      joinLede,
      joinNameSlot,
      el("label", { className: "mp-field-label", text: "Room code", attrs: { for: joinId } }),
      el("div", { className: "mp-join-row", children: [joinInput, joinButton] }),
      joinHint,
    ],
  });

  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (pending) return;
    const code = cleanJoinCode(joinInput.value);
    if (code.length < 4) {
      joinHint.textContent = "Room codes are 5 letters and numbers, like K7QMR.";
      joinHint.classList.add("is-error");
      joinInput.setAttribute("aria-invalid", "true");
      joinInput.focus();
      return;
    }
    joinInput.value = code;
    const name = claimName();
    if (!name) return;
    options.onJoin(code, name);
  }, { signal });
  joinInput.addEventListener("input", () => {
    joinHint.textContent = "Paste a code or an invite link.";
    joinHint.classList.remove("is-error");
    joinInput.removeAttribute("aria-invalid");
  }, { signal });

  // ---------- Friends online ----------

  const onlineCount = el("span", { className: "mp-count", attrs: { hidden: "" } });
  const onlineBody = el("div", { className: "mp-online-body", attrs: { "aria-live": "polite" } });
  const onlineCard = el("section", {
    className: "mp-card mp-online",
    attrs: { "aria-labelledby": "mp-online-title" },
    children: [el("header", { className: "mp-card-head", children: [el("h2", { className: "mp-card-title", text: "Friends online", attrs: { id: "mp-online-title" } }), onlineCount] }), onlineBody],
  });
  let friends: readonly FriendInfo[] | null = null;
  let friendsError = false;
  let friendsRequest = 0;

  function renderFriends(): void {
    const user = options.getUser();
    const online = (friends ?? []).filter((friend) => friend.online);
    onlineCount.hidden = !user || online.length === 0;
    onlineCount.textContent = String(online.length);
    if (!user) {
      onlineBody.replaceChildren(
        el("p", { className: "mp-muted", text: "Sign in to see which friends are online and invite them in one tap." }),
        el("button", { className: "shell-btn shell-btn-quiet mp-signin", text: "Sign in", attrs: { type: "button" }, on: { click: () => options.shell.openAccount() } }),
      );
      return;
    }
    if (friends === null) {
      onlineBody.replaceChildren(
        friendsError
          ? el("p", { className: "mp-muted", text: "Couldn't load your friends. You can still start a game and share the link." })
          : el("div", { className: "mp-skeleton", attrs: { "aria-hidden": "true" }, children: [el("span"), el("span")] }),
      );
      return;
    }
    if (online.length === 0) {
      const none = friends.length === 0;
      onlineBody.replaceChildren(
        el("p", { className: "mp-muted", text: none ? "Add friends to see when they're online and invite them in one tap." : "Nobody's online right now. Start a game and send them the link." }),
        ...(options.onFriends ? [el("button", { className: "mp-link", attrs: { type: "button" }, children: [el("span", { text: none ? "Find friends" : "Open Friends" }), shellIcon("arrow-right", 15, 2)], on: { click: () => options.onFriends?.() } })] : []),
      );
      return;
    }
    onlineBody.replaceChildren(
      el("ul", {
        className: "mp-online-list",
        children: online.map((friend) =>
          el("li", {
            className: "mp-online-row",
            children: [
              el("span", { className: `mp-avatar is-online${friend.user.avatarEmoji ? " is-emoji" : ""}`, text: friend.user.avatarEmoji ?? friend.user.username.charAt(0).toUpperCase(), attrs: { "aria-hidden": "true" } }),
              el("span", { className: "mp-online-name", text: friend.user.username }),
              el("button", {
                className: "shell-btn shell-btn-quiet mp-invite",
                text: "Invite",
                attrs: { type: "button", "aria-label": `Start a quiz race and invite ${friend.user.username}` },
                on: {
                  click: () => {
                    if (pending) return;
                    const name = claimName();
                    if (!name) return;
                    creatingKind = "quiz";
                    options.onCreate("quiz", name, friend.user.id);
                  },
                },
              }),
            ],
          }),
        ),
      }),
      el("p", { className: "mp-muted mp-small", text: "Invite opens a quiz race and sends them the link. You can switch the game in the room." }),
    );
  }

  async function loadFriends(): Promise<void> {
    if (!options.getUser()) {
      friends = null;
      renderFriends();
      return;
    }
    const request = ++friendsRequest;
    const data = await fetchFriends();
    if (signal.aborted || request !== friendsRequest) return;
    friendsError = data === null;
    friends = data ? data.friends : friends;
    renderFriends();
  }

  const steps = el("section", {
    className: "mp-card mp-steps",
    attrs: { "aria-labelledby": "mp-steps-title" },
    children: [
      el("h2", { className: "mp-card-title", text: "How it works", attrs: { id: "mp-steps-title" } }),
      el("ol", {
        className: "mp-steps-list",
        children: [
          ["Pick a game", "Your room opens with a short code."],
          ["Share the link", "Friends join from any device, no account needed."],
          ["Start when you like", "Late arrivals watch, then play the next game."],
        ].map(([title, body], index) =>
          el("li", { children: [el("span", { className: "mp-step-num", text: String(index + 1) }), el("span", { className: "mp-step-copy", children: [el("strong", { text: title! }), el("span", { text: body! })] })] }),
        ),
      }),
    ],
  });

  const homeMain = el("div", { className: "mp-home-main", children: [startCard, joinForm] });
  const element = el("div", {
    className: "mp-home",
    children: [
      homeMain,
      el("div", { className: "mp-home-side", children: [onlineCard, steps] }),
    ],
  });

  function update(state: MultiplayerHomeState): void {
    pending = state.pending;
    if (!pending) creatingKind = null;
    for (const entry of kindButtons) {
      const busy = pending === "create" && creatingKind === entry.info.kind;
      entry.button.disabled = pending !== null;
      entry.button.classList.toggle("is-busy", busy);
      entry.button.setAttribute("aria-busy", String(busy));
      entry.status.textContent = busy ? "Opening room…" : "";
    }
    joinButton.disabled = pending !== null;
    joinButton.firstElementChild!.textContent = pending === "join" ? "Joining…" : joinForm.classList.contains("is-invite") ? "Join room" : "Join";
  }

  renderUser();
  renderFriends();
  void loadFriends();
  const unsubscribeFriends = options.subscribeFriends?.(() => void loadFriends());

  return {
    element,
    update,
    prepareJoin: (roomCode) => {
      // Someone opened an invite link: joining is the point, so it goes first and carries the name.
      joinInput.value = roomCode;
      joinTitle.textContent = `Join room ${roomCode}`;
      joinLede.textContent = "Pick a name so the others know who you are.";
      joinLede.hidden = false;
      joinForm.classList.add("is-invite");
      joinNameSlot.append(nameField);
      homeMain.prepend(joinForm);
      joinButton.firstElementChild!.textContent = "Join room";
      if (!options.getUser() && !nameInput.value.trim()) {
        nameError.textContent = `Pick a name to join room ${roomCode}.`;
        nameError.hidden = false;
        requestAnimationFrame(() => nameInput.focus());
      }
    },
    refreshUser: () => {
      renderUser();
      void loadFriends();
    },
    destroy: () => unsubscribeFriends?.(),
  };
}
