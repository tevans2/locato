import {
  acceptFriendRequest,
  declineFriendRequest,
  fetchFriends,
  fetchFriendProfile,
  removeFriend,
  searchUsers,
  sendFriendRequest,
  type FriendsData,
  type PublicUser,
} from "../../core/auth";
import { buildStats } from "./StatsScreen";
import type { Screen } from "../../app/router";
import { el } from "../dom/createElement";

export interface FriendsScreenOptions {
  readonly onBack: () => void;
  readonly onDailyChallenge?: () => void;
  readonly initialUsername?: string;
  readonly currentUsername?: string | null;
  readonly appOrigin?: string;
  // Invite an online friend to a multiplayer game (wired once presence/invites land).
  readonly onInviteToGame?: (friend: PublicUser) => void;
  // Optional live-update hook: called with a listener, returns an unsubscribe fn.
  readonly subscribe?: (listener: () => void) => () => void;
}

const EMPTY: FriendsData = { friends: [], incoming: [], outgoing: [] };

function avatar(user: PublicUser): HTMLElement {
  return el("span", { className: "friend-avatar", text: user.avatarEmoji ?? user.username.charAt(0).toUpperCase() });
}

export function createFriendsScreen(options: FriendsScreenOptions): Screen {
  let data: FriendsData = EMPTY;
  let busy = false;
  let profileRequestId = 0;

  const addInput = el("input", {
    className: "friend-add-input",
    attrs: { type: "text", placeholder: "Add by username", autocomplete: "off", maxlength: "20", list: "friend-suggestions", "aria-label": "Friend username" },
  });
  if (options.initialUsername) addInput.value = options.initialUsername;
  const suggestions = el("datalist", { attrs: { id: "friend-suggestions" } });
  const addButton = el("button", { className: "primary-action", text: "Add", attrs: { type: "submit" } });
  const copyFriendLinkButton = el("button", { className: "ghost-action", text: "Copy my friend link", attrs: { type: "button" } });
  copyFriendLinkButton.hidden = !options.currentUsername;
  const addFeedback = el("p", { className: "friend-feedback", attrs: { role: "status" } });
  const addForm = el("form", { className: "friend-add-form", children: [addInput, addButton, copyFriendLinkButton, suggestions] });

  const incomingList = el("div", { className: "friend-list" });
  const outgoingList = el("div", { className: "friend-list" });
  const friendsList = el("div", { className: "friend-list" });
  const profileContent = el("div", { className: "stats-content friend-profile-content" });
  const profileTitle = el("h2", { text: "Friend stats" });
  const profileCloseButton = el("button", { className: "ghost-action friend-profile-close", text: "Close", attrs: { type: "button" } });
  const profilePanel = el("section", {
    className: "friend-profile-panel",
    attrs: { hidden: "true" },
    children: [el("header", { className: "friend-profile-header", children: [profileTitle, profileCloseButton] }), profileContent],
  });

  const incomingSection = el("section", { className: "friend-section", children: [el("h2", { text: "Requests" }), incomingList] });
  const outgoingSection = el("section", { className: "friend-section", children: [el("h2", { text: "Sent" }), outgoingList] });
  const friendsSection = el("section", { className: "friend-section", children: [el("h2", { text: "Friends" }), friendsList] });

  const backButton = el("button", { className: "ghost-action screen-back-button", text: "Back", attrs: { type: "button", "aria-label": "Back to game" }, on: { click: () => options.onBack() } });
  const dailyButton = el("button", { className: "ghost-action screen-header-action", text: "Daily Challenge", attrs: { type: "button", "aria-label": "Open daily challenge", ...(options.onDailyChallenge ? {} : { hidden: "true" }) }, on: { click: () => options.onDailyChallenge?.() } });

  const element = el("section", {
    className: "game-screen friends-screen",
    children: [
      ...(options.initialUsername ? [el("p", { className: "friend-link-hint", text: `Friend link opened for ${options.initialUsername}. Send a request when you're signed in.` })] : []),
      el("header", { className: "friends-header", children: [el("h1", { text: "Friends" }), el("div", { className: "screen-header-actions", children: [dailyButton, backButton] })] }),
      el("section", { className: "friend-section", children: [el("h2", { text: "Add a friend" }), addForm, addFeedback] }),
      incomingSection,
      outgoingSection,
      friendsSection,
      profilePanel,
    ],
  });

  function personRow(user: PublicUser, online: boolean | null, actions: readonly HTMLElement[], onProfile?: () => void): HTMLElement {
    const dot = online === null ? [] : [el("span", { className: `friend-status${online ? " is-online" : ""}`, attrs: { title: online ? "Online" : "Offline" } })];
    const nameNode = onProfile
      ? el("button", { className: "friend-name friend-profile-link", text: user.username, attrs: { type: "button" }, on: { click: onProfile } })
      : el("span", { className: "friend-name", text: user.username });
    return el("div", {
      className: "friend-row",
      children: [
        avatar(user),
        nameNode,
        ...dot,
        el("span", { className: "friend-actions", children: actions }),
      ],
    });
  }

  function actionButton(label: string, variant: string, handler: () => void): HTMLElement {
    return el("button", { className: `${variant} friend-action-btn`, text: label, attrs: { type: "button" }, on: { click: handler } });
  }

  async function act(fn: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await fn();
      await refresh();
    } finally {
      busy = false;
    }
  }

  function showProfileLoading(user: PublicUser): number {
    const requestId = ++profileRequestId;
    profileTitle.textContent = `${user.username} stats`;
    profilePanel.hidden = false;
    profileContent.replaceChildren(el("p", { className: "stats-loading", text: "Loading stats…" }));
    return requestId;
  }

  function openProfile(user: PublicUser): void {
    const requestId = showProfileLoading(user);
    void fetchFriendProfile(user.id).then((profile) => {
      if (requestId !== profileRequestId) return;
      if (!profile) {
        profileContent.replaceChildren(el("p", { className: "stats-loading", text: "Could not load this profile. Make sure you are still friends." }));
        return;
      }
      profileTitle.textContent = `${profile.user.avatarEmoji ?? "👤"} ${profile.user.username} ${profile.online ? "· online" : "· offline"}`;
      buildStats(profile.stats, profileContent);
      profilePanel.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  function render(): void {
    incomingList.replaceChildren(
      ...(data.incoming.length === 0
        ? [el("p", { className: "friend-empty", text: "No incoming requests." })]
        : data.incoming.map((r) =>
            personRow(r.user, null, [
              actionButton("Accept", "primary-action", () => void act(() => acceptFriendRequest(r.user.id))),
              actionButton("Decline", "ghost-action", () => void act(() => declineFriendRequest(r.user.id))),
            ]),
          )),
    );

    outgoingSection.hidden = data.outgoing.length === 0;
    outgoingList.replaceChildren(
      ...data.outgoing.map((r) =>
        personRow(r.user, null, [actionButton("Cancel", "ghost-action", () => void act(() => declineFriendRequest(r.user.id)))]),
      ),
    );

    friendsList.replaceChildren(
      ...(data.friends.length === 0
        ? [el("p", { className: "friend-empty", text: "No friends yet. Add someone by username above." })]
        : data.friends.map((f) => {
            const actions: HTMLElement[] = [actionButton("Stats", "secondary-action", () => openProfile(f.user))];
            if (options.onInviteToGame && f.online) actions.push(actionButton("Invite", "primary-action", () => options.onInviteToGame?.(f.user)));
            actions.push(actionButton("Remove", "ghost-action", () => void act(() => removeFriend(f.user.id))));
            return personRow(f.user, f.online, actions, () => openProfile(f.user));
          })),
    );
  }

  async function refresh(): Promise<void> {
    data = (await fetchFriends()) ?? EMPTY;
    render();
  }

  addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = addInput.value.trim();
    if (!username) return;
    void act(async () => {
      const result = await sendFriendRequest(username);
      addFeedback.textContent = result.ok
        ? result.status === "accepted"
          ? `You're now friends with ${username}.`
          : `Request sent to ${username}.`
        : result.error;
      addFeedback.className = `friend-feedback${result.ok ? " is-good" : " is-bad"}`;
      if (result.ok) addInput.value = "";
    });
  });

  profileCloseButton.addEventListener("click", () => {
    profileRequestId += 1;
    profilePanel.hidden = true;
    profileContent.replaceChildren();
  });

  copyFriendLinkButton.addEventListener("click", () => {
    const username = options.currentUsername;
    if (!username) return;
    const origin = options.appOrigin ?? window.location.origin;
    const url = `${origin}/?friend=${encodeURIComponent(username)}`;
    const text = `Add ${username} as a friend on locato: ${url}`;
    void navigator.clipboard?.writeText(text).then(
      () => {
        addFeedback.textContent = "Friend link copied.";
        addFeedback.className = "friend-feedback is-good";
      },
      () => {
        addFeedback.textContent = url;
        addFeedback.className = "friend-feedback";
      },
    );
  });

  // Suggestions as you type (debounced), so users can find the exact handle.
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  addInput.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    const query = addInput.value.trim();
    if (query.length < 2) return;
    searchTimer = setTimeout(() => {
      void searchUsers(query).then((users) => {
        suggestions.replaceChildren(...users.map((u) => el("option", { attrs: { value: u.username } })));
      });
    }, 250);
  });

  const unsubscribe = options.subscribe?.(() => void refresh());
  void refresh();

  return {
    element,
    destroy: () => {
      if (searchTimer) clearTimeout(searchTimer);
      unsubscribe?.();
    },
  };
}
