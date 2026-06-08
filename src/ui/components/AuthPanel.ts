import { fetchAuthState, loginWithPassword, registerWithPassword, signInWithGitHub, signInWithGoogle, signOut, type AuthState, type UserStats } from "../../core/auth";
import { el } from "../dom/createElement";

export interface AuthPanelOptions {
  readonly onAuthChange: (state: AuthState) => void;
}

export interface AuthControls {
  // The button/avatar shown in the header bar.
  readonly trigger: HTMLElement;
  // The dropdown panel itself (absolutely positioned, toggled by trigger).
  readonly panel: HTMLElement;
  // Call after a multiplayer game completes so the panel stats badge refreshes.
  readonly refreshStats: (stats: UserStats) => void;
  readonly destroy: () => void;
}

// Render a small avatar/button for the header and a dropdown with sign-in or account details.
export function createAuthControls(options: AuthPanelOptions): AuthControls {
  const controller = new AbortController();
  let currentState: AuthState = { user: null, stats: null };
  let isOpen = false;

  // --- Trigger (header button) ---
  const triggerAvatar = el("img", { className: "auth-avatar", attrs: { alt: "", src: "" } });
  const triggerInitial = el("span", { className: "auth-initial", text: "?" });
  const trigger = el("button", {
    className: "auth-trigger ghost-action",
    attrs: { type: "button", "aria-haspopup": "true", "aria-label": "Account" },
    children: [triggerAvatar, triggerInitial],
  });

  // --- Sign-in panel ---
  const feedbackEl = el("p", { className: "auth-feedback" });
  const emailInput = el("input", { attrs: { type: "email", placeholder: "Email", autocomplete: "email" } });
  const passwordInput = el("input", { attrs: { type: "password", placeholder: "Password", autocomplete: "current-password" } });
  const displayNameInput = el("input", { attrs: { type: "text", placeholder: "Display name (optional)", maxlength: "32" } });
  const submitButton = el("button", { className: "primary-action auth-submit", text: "Sign in", attrs: { type: "submit" } });
  const toggleLink = el("button", { className: "ghost-action auth-toggle", text: "Create account instead", attrs: { type: "button" } });
  let isRegisterMode = false;

  const oauthSection = el("div", {
    className: "auth-oauth",
    children: [
      el("button", { className: "ghost-action auth-oauth-btn", text: "Sign in with GitHub", attrs: { type: "button", "data-provider": "github" } }),
      el("button", { className: "ghost-action auth-oauth-btn", text: "Sign in with Google", attrs: { type: "button", "data-provider": "google" } }),
    ],
  });

  const signInForm = el("form", {
    className: "auth-form",
    children: [
      oauthSection,
      el("div", { className: "auth-divider", children: [el("span", { text: "or" })] }),
      emailInput,
      passwordInput,
      feedbackEl,
      submitButton,
      toggleLink,
    ],
  });

  // --- Account panel ---
  const accountNameEl = el("p", { className: "auth-account-name" });
  const statsEl = el("p", { className: "auth-stats" });
  const signOutButton = el("button", { className: "ghost-action", text: "Sign out", attrs: { type: "button" } });
  const accountSection = el("div", { className: "auth-account", children: [accountNameEl, statsEl, signOutButton] });

  const panel = el("div", {
    className: "auth-panel",
    attrs: { role: "dialog", "aria-label": "Account" },
    children: [signInForm, accountSection],
  });
  panel.hidden = true;

  function setFeedback(message: string, bad = false): void {
    feedbackEl.textContent = message;
    feedbackEl.classList.toggle("bad", bad);
    feedbackEl.hidden = !message;
  }

  function formatStats(stats: UserStats | null): string {
    if (!stats || stats.games === 0) return "No games yet.";
    const pct = stats.games > 0 ? Math.round(((stats.correctAnswers / (stats.correctAnswers + stats.wrongAnswers)) * 100) || 100) : 100;
    return `${stats.games} games · ${stats.correctAnswers} correct · ${pct}% · best streak ${stats.bestStreak}`;
  }

  function renderTrigger(state: AuthState): void {
    const { user } = state;
    if (user) {
      if (user.avatarUrl) {
        triggerAvatar.setAttribute("src", user.avatarUrl);
        triggerAvatar.hidden = false;
        triggerInitial.hidden = true;
      } else {
        triggerInitial.textContent = (user.displayName.charAt(0) || "?").toUpperCase();
        triggerAvatar.hidden = true;
        triggerInitial.hidden = false;
      }
      trigger.title = user.displayName;
      trigger.setAttribute("aria-label", `Account: ${user.displayName}`);
    } else {
      triggerAvatar.hidden = true;
      triggerInitial.textContent = "Sign in";
      triggerInitial.hidden = false;
      trigger.title = "Sign in";
      trigger.setAttribute("aria-label", "Sign in");
    }
  }

  function renderPanel(state: AuthState): void {
    const { user } = state;
    signInForm.hidden = !!user;
    accountSection.hidden = !user;
    if (user) {
      accountNameEl.textContent = `${user.displayName} · ${user.email}`;
      statsEl.textContent = formatStats(state.stats);
    } else {
      displayNameInput.hidden = !isRegisterMode;
      submitButton.textContent = isRegisterMode ? "Create account" : "Sign in";
      passwordInput.setAttribute("autocomplete", isRegisterMode ? "new-password" : "current-password");
      toggleLink.textContent = isRegisterMode ? "Sign in instead" : "Create account instead";
      setFeedback("");
    }
  }

  function applyState(state: AuthState): void {
    currentState = state;
    renderTrigger(state);
    renderPanel(state);
    options.onAuthChange(state);
  }

  function togglePanel(): void {
    isOpen = !isOpen;
    panel.hidden = !isOpen;
    trigger.setAttribute("aria-expanded", String(isOpen));
    if (isOpen && !currentState.user) emailInput.focus();
  }

  // Insert the display name field into the form only when registering (avoids layout shift).
  function setRegisterMode(value: boolean): void {
    isRegisterMode = value;
    if (value && !signInForm.contains(displayNameInput)) {
      passwordInput.insertAdjacentElement("afterend", displayNameInput);
    } else if (!value && signInForm.contains(displayNameInput)) {
      displayNameInput.remove();
    }
    renderPanel(currentState);
  }

  trigger.addEventListener("click", () => togglePanel(), { signal: controller.signal });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && isOpen) togglePanel();
    },
    { signal: controller.signal },
  );

  // Close panel when clicking outside.
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (isOpen && !panel.contains(event.target as Node) && !trigger.contains(event.target as Node)) {
        isOpen = false;
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
      }
    },
    { signal: controller.signal },
  );

  toggleLink.addEventListener("click", () => setRegisterMode(!isRegisterMode), { signal: controller.signal });

  signInForm.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      setFeedback("");
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const displayName = displayNameInput.value.trim();

      const result = isRegisterMode
        ? await registerWithPassword(email, password, displayName || undefined)
        : await loginWithPassword(email, password);

      submitButton.disabled = false;
      if (!result.ok) {
        setFeedback(result.error, true);
        return;
      }
      emailInput.value = "";
      passwordInput.value = "";
      displayNameInput.value = "";
      isOpen = false;
      panel.hidden = true;
      const state = await fetchAuthState();
      applyState(state);
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
      await signOut();
      applyState({ user: null, stats: null });
      isOpen = false;
      panel.hidden = true;
    },
    { signal: controller.signal },
  );

  // Kick off initial auth check.
  void fetchAuthState().then((state) => applyState(state));

  return {
    trigger,
    panel,
    refreshStats: (stats) => {
      currentState = { ...currentState, stats };
      statsEl.textContent = formatStats(stats);
    },
    destroy: () => controller.abort(),
  };
}
