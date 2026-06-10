import { fetchAuthState, loginWithPassword, registerWithPassword, saveAvatarToServer, signInWithGitHub, signInWithGoogle, signOut, type AuthState, type UserStats } from "../../core/auth";
import { AVATAR_OPTIONS, getStoredAvatar, storeAvatar } from "../../core/auth/avatars";
import { el } from "../dom/createElement";

// Inline SVG icons — no external requests, no asset pipeline needed.
const GITHUB_SVG = `<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
const GOOGLE_SVG = `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/><path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>`;

function svgIcon(svgMarkup: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "auth-icon";
  span.innerHTML = svgMarkup;
  return span;
}


export interface AuthPanelOptions {
  readonly onAuthChange: (state: AuthState) => void;
  readonly onViewStats?: () => void;
}

export interface AuthControls {
  // Fixed top-right button: "Sign in" for guests, avatar/profile icon for signed-in users.
  readonly trigger: HTMLElement;
  // Fixed popup attached next to the trigger. It is kept outside screens so navigation cannot reset it.
  readonly panel: HTMLElement;
  // Call after a multiplayer game completes so the panel stats refreshes.
  readonly refreshStats: (stats: UserStats) => void;
  readonly getUser: () => AuthState["user"];
  readonly openPanel: () => void;
  readonly destroy: () => void;
}

type AuthMode = "login" | "register";

function statText(stats: UserStats | null, key: keyof UserStats): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(stats?.[key] ?? 0);
}

// Render a persistent account control and popup for sign-in, registration, and account status.
export function createAuthControls(options: AuthPanelOptions): AuthControls {
  const controller = new AbortController();
  let currentState: AuthState = { user: null, stats: null };
  let isOpen = false;
  let mode: AuthMode = "login";

  const triggerAvatar = el("img", { className: "auth-avatar", attrs: { alt: "", src: "" } });
  const triggerInitial = el("span", { className: "auth-initial", text: "" });
  const triggerLabel = el("span", { className: "auth-trigger-label", text: "Sign in" });
  const trigger = el("button", {
    className: "auth-trigger",
    attrs: { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false", "aria-label": "Sign in" },
    children: [triggerAvatar, triggerInitial, triggerLabel],
  });
  triggerAvatar.hidden = true;
  triggerInitial.hidden = true;

  const panelTitle = el("h2", { className: "auth-title", text: "Sign in" });
  const panelSubtitle = el("p", { className: "auth-subtitle", text: "Save stats and keep your multiplayer name across devices." });
  const closeButton = el("button", { className: "auth-close", text: "×", attrs: { type: "button", "aria-label": "Close account popup" } });

  const loginTab = el("button", { className: "auth-mode-tab", text: "Log in", attrs: { type: "button", role: "tab" } });
  const registerTab = el("button", { className: "auth-mode-tab", text: "Create account", attrs: { type: "button", role: "tab" } });
  const feedbackEl = el("p", { className: "auth-feedback", attrs: { role: "status" } });

  const emailInput = el("input", { attrs: { id: "auth-email", type: "email", placeholder: "Email", autocomplete: "email", "aria-label": "Email" } });
  const passwordInput = el("input", { attrs: { id: "auth-password", type: "password", placeholder: "Password", autocomplete: "current-password", "aria-label": "Password" } });
  const displayNameInput = el("input", { attrs: { id: "auth-display-name", type: "text", placeholder: "Display name", autocomplete: "nickname", maxlength: "32", "aria-label": "Display name" } });
  const submitButton = el("button", { className: "primary-action auth-submit", text: "Sign in", attrs: { type: "submit" } });

  const oauthSection = el("div", {
    className: "auth-oauth",
    children: [
      el("button", {
        className: "secondary-action auth-oauth-btn",
        attrs: { type: "button", "data-provider": "github" },
        children: [svgIcon(GITHUB_SVG), document.createTextNode("Continue with GitHub")],
      }),
      el("button", {
        className: "secondary-action auth-oauth-btn",
        attrs: { type: "button", "data-provider": "google" },
        children: [svgIcon(GOOGLE_SVG), document.createTextNode("Continue with Google")],
      }),
    ],
  });

  const signInForm = el("form", {
    className: "auth-form",
    children: [
      el("div", { className: "auth-mode-tabs", attrs: { role: "tablist", "aria-label": "Account action" }, children: [loginTab, registerTab] }),
      displayNameInput,
      emailInput,
      passwordInput,
      feedbackEl,
      submitButton,
      el("div", { className: "auth-divider", children: [el("span", { text: "or" })] }),
      oauthSection,
    ],
  });

  const accountAvatar = el("img", { className: "auth-avatar auth-account-avatar", attrs: { alt: "", src: "" } });
  const accountInitial = el("span", { className: "auth-initial auth-account-initial", text: "?" });
  const accountNameEl = el("p", { className: "auth-account-name" });
  const accountEmailEl = el("p", { className: "auth-account-email" });
  const gamesValue = el("strong", { text: "0" });
  const correctValue = el("strong", { text: "0" });
  const streakValue = el("strong", { text: "0" });
  const viewStatsButton = el("button", { className: "secondary-action auth-view-stats", text: "View full stats →", attrs: { type: "button" } });
  const signOutButton = el("button", { className: "ghost-action auth-sign-out", text: "Sign out", attrs: { type: "button" } });

  const avatarPicker = el("div", { className: "avatar-picker", attrs: { role: "group", "aria-label": "Choose avatar", hidden: "true" } });
  avatarPicker.append(...AVATAR_OPTIONS.map((emoji) => {
    const btn = el("button", { className: "avatar-option", text: emoji, attrs: { type: "button", "aria-label": emoji } });
    return btn;
  }));
  const accountSection = el("div", {
    className: "auth-account",
    children: [
      el("div", {
        className: "auth-account-header",
        children: [
          el("button", { className: "auth-account-avatar-wrap", attrs: { type: "button", "aria-label": "Change avatar" }, children: [accountAvatar, accountInitial] }),
          el("div", { className: "auth-account-copy", children: [accountNameEl, accountEmailEl] }),
        ],
      }),
      avatarPicker,
      el("div", {
        className: "auth-stat-grid",
        children: [
          el("span", { children: [gamesValue, el("small", { text: "games" })] }),
          el("span", { children: [correctValue, el("small", { text: "correct" })] }),
          el("span", { children: [streakValue, el("small", { text: "best streak" })] }),
        ],
      }),
      viewStatsButton,
      signOutButton,
    ],
  });

  const panel = el("div", {
    className: "auth-panel",
    attrs: { role: "dialog", "aria-modal": "false", "aria-labelledby": "auth-title" },
    children: [
      el("div", { className: "auth-panel-header", children: [el("div", { children: [panelTitle, panelSubtitle] }), closeButton] }),
      signInForm,
      accountSection,
    ],
  });
  panelTitle.id = "auth-title";
  panel.hidden = true;

  function setFeedback(message: string): void {
    feedbackEl.textContent = message;
    feedbackEl.hidden = message.length === 0;
  }

  function clearFormFields(): void {
    emailInput.value = "";
    passwordInput.value = "";
    displayNameInput.value = "";
    setFeedback("");
  }

  function clearAccountDetails(): void {
    accountAvatar.removeAttribute("src");
    accountAvatar.hidden = true;
    accountInitial.textContent = "?";
    accountNameEl.textContent = "";
    accountEmailEl.textContent = "";
    gamesValue.textContent = "0";
    correctValue.textContent = "0";
    streakValue.textContent = "0";
  }


  function setMode(nextMode: AuthMode): void {
    mode = nextMode;
    const registering = nextMode === "register";
    loginTab.classList.toggle("is-active", !registering);
    registerTab.classList.toggle("is-active", registering);
    loginTab.setAttribute("aria-selected", String(!registering));
    registerTab.setAttribute("aria-selected", String(registering));
    displayNameInput.hidden = !registering;
    submitButton.textContent = registering ? "Create account" : "Sign in";
    passwordInput.setAttribute("autocomplete", registering ? "new-password" : "current-password");
    panelTitle.textContent = registering ? "Create account" : "Sign in";
    panelSubtitle.textContent = registering ? "Create an account to save your results and multiplayer identity." : "Save stats and keep your multiplayer name across devices.";
    setFeedback("");
  }

  function setAvatar(user: AuthState["user"], image: HTMLImageElement, initial: HTMLElement): void {
    const emoji = getStoredAvatar();
    if (emoji) {
      image.hidden = true;
      initial.textContent = emoji;
      initial.hidden = false;
      initial.className = initial.className.replace(/\bis-emoji\b/, "") + " is-emoji";
      return;
    }
    if (user?.avatarUrl) {
      image.src = user.avatarUrl;
      image.hidden = false;
      initial.hidden = true;
      return;
    }
    image.hidden = true;
    initial.textContent = (user?.displayName.charAt(0) || "?").toUpperCase();
    initial.hidden = false;
    initial.className = initial.className.replace(/\s*is-emoji\b/, "");
  }

  function updatePickerSelection(selectedEmoji: string | null): void {
    for (const btn of avatarPicker.querySelectorAll<HTMLButtonElement>(".avatar-option")) {
      btn.classList.toggle("is-selected", btn.textContent === selectedEmoji);
    }
  }

  function renderTrigger(state: AuthState): void {
    const { user } = state;
    trigger.classList.toggle("is-authenticated", !!user);
    if (user) {
      setAvatar(user, triggerAvatar, triggerInitial);
      triggerLabel.hidden = true;
      triggerLabel.textContent = "";
      trigger.title = user.displayName;
      trigger.setAttribute("aria-label", `Account: ${user.displayName}`);
    } else {
      triggerAvatar.hidden = true;
      triggerInitial.hidden = true;
      triggerAvatar.removeAttribute("src");
      triggerInitial.textContent = "";
      triggerLabel.hidden = false;
      triggerLabel.textContent = "Sign in";
      trigger.title = "Sign in";
      trigger.setAttribute("aria-label", "Sign in");
    }
  }

  function renderAccount(state: AuthState): void {
    if (!state.user) return;
    setAvatar(state.user, accountAvatar, accountInitial);
    updatePickerSelection(getStoredAvatar());
    accountNameEl.textContent = state.user.displayName;
    accountEmailEl.textContent = state.user.email;
    gamesValue.textContent = statText(state.stats, "totalGames");
    correctValue.textContent = statText(state.stats, "totalCorrect");
    streakValue.textContent = statText(state.stats, "bestStreak");
  }

  function renderPanel(state: AuthState): void {
    signInForm.hidden = !!state.user;
    accountSection.hidden = !state.user;
    if (state.user) {
      panelTitle.textContent = "Account";
      panelSubtitle.textContent = "Your saved Locato profile and multiplayer stats.";
      renderAccount(state);
    } else {
      clearAccountDetails();
      setMode(mode);
    }
  }

  function applyState(state: AuthState): void {
    // Server emoji always wins on sign-in — reflects the user's last pick on any device.
    if (state.user?.avatarEmoji) storeAvatar(state.user.avatarEmoji);
    currentState = state;
    renderTrigger(state);
    renderPanel(state);
    options.onAuthChange(state);
  }

  function openPanel(): void {
    isOpen = true;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (currentState.user) signOutButton.focus();
    else emailInput.focus();
  }

  function closePanel(): void {
    isOpen = false;
    panel.hidden = true;
    avatarPicker.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }

  trigger.addEventListener("click", () => (isOpen ? closePanel() : openPanel()), { signal: controller.signal });
  closeButton.addEventListener("click", closePanel, { signal: controller.signal });
  loginTab.addEventListener("click", () => setMode("login"), { signal: controller.signal });
  registerTab.addEventListener("click", () => setMode("register"), { signal: controller.signal });

  accountSection.querySelector(".auth-account-avatar-wrap")?.addEventListener(
    "click",
    () => { avatarPicker.hidden = !avatarPicker.hidden; },
    { signal: controller.signal },
  );

  avatarPicker.addEventListener(
    "click",
    (event) => {
      const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(".avatar-option");
      if (!btn || !currentState.user) return;
      const emoji = btn.textContent ?? "";
      storeAvatar(emoji);
      saveAvatarToServer(emoji);
      updatePickerSelection(emoji);
      setAvatar(currentState.user, triggerAvatar, triggerInitial);
      setAvatar(currentState.user, accountAvatar, accountInitial);
      avatarPicker.hidden = true;
    },
    { signal: controller.signal },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && isOpen) closePanel();
    },
    { signal: controller.signal },
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (isOpen && !panel.contains(event.target as Node) && !trigger.contains(event.target as Node)) closePanel();
    },
    { signal: controller.signal },
  );

  signInForm.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      setFeedback("");
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const displayName = displayNameInput.value.trim();
      const result = mode === "register" ? await registerWithPassword(email, password, displayName || undefined) : await loginWithPassword(email, password);
      submitButton.disabled = false;
      if (!result.ok) {
        setFeedback(result.error);
        return;
      }
      clearFormFields();
      applyState(await fetchAuthState());
      closePanel();
    },
    { signal: controller.signal },
  );

  panel.addEventListener(
    "click",
    (event) => {
      const button = (event.target as HTMLElement).closest(".auth-oauth-btn");
      if (!(button instanceof HTMLButtonElement)) return;
      const provider = button.dataset.provider;
      if (provider === "github") signInWithGitHub();
      if (provider === "google") signInWithGoogle();
    },
    { signal: controller.signal },
  );

  signOutButton.addEventListener(
    "click",
    async () => {
      signOutButton.disabled = true;
      await signOut();
      clearFormFields();
      clearAccountDetails();
      signOutButton.disabled = false;
      applyState({ user: null, stats: null });
      closePanel();
    },
    { signal: controller.signal },
  );

  viewStatsButton.addEventListener(
    "click",
    () => {
      closePanel();
      options.onViewStats?.();
    },
    { signal: controller.signal },
  );

  setMode("login");
  void fetchAuthState().then((state) => applyState(state));

  return {
    trigger,
    panel,
    refreshStats: (stats) => {
      currentState = { ...currentState, stats };
      if (currentState.user) renderAccount(currentState);
    },
    getUser: () => currentState.user,
    openPanel: () => openPanel(),
    destroy: () => controller.abort(),
  };
}
