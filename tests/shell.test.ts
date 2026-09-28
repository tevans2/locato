// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME_MODE_GROUPS, gameModeOptions, isLeaderboardMode, LEADERBOARD_GAME_MODE_IDS } from "../src/core/gameModes";
import { GAME_MODE_IDS } from "../server/leaderboard/validation";
import { confirmDialog } from "../src/ui/shell/confirmDialog";
import { createFocusBar } from "../src/ui/shell/FocusBar";
import { createGameBar } from "../src/ui/shell/GameBar";
import { openGamePicker } from "../src/ui/shell/GamePicker";
import { createResultsCard } from "../src/ui/shell/ResultsCard";
import { createSiteHeader, createSitePage, createTabBar } from "../src/ui/shell/SiteHeader";
import type { ShellContext } from "../src/ui/shell/types";

function makeContext(overrides: Partial<ShellContext> = {}): ShellContext & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openSection: (section) => calls.push(`section:${section}`),
    goHome: () => calls.push("home"),
    goBack: (fallback) => calls.push(`back:${fallback ?? ""}`),
    openGame: (mode, run) => calls.push(`game:${mode}:${run ?? "practice"}`),
    openGamePicker: () => calls.push("picker"),
    openCountry: (code) => calls.push(`country:${code}`),
    openCompete: (mode) => calls.push(`compete:${mode ?? ""}`),
    openAccount: () => calls.push("account"),
    controls: document.createElement("div"),
    confirmLeave: vi.fn(async () => true),
    signedIn: () => false,
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function keydown(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("game mode catalogue", () => {
  it("groups all 14 modes as Clues, Map and Street View exactly once", () => {
    expect(GAME_MODE_GROUPS.map((group) => group.label)).toEqual(["Clues", "Map", "Street View"]);
    const ids = GAME_MODE_GROUPS.flatMap((group) => group.modes.map((mode) => mode.id));
    expect(ids).toHaveLength(14);
    expect(new Set(ids)).toEqual(new Set(gameModeOptions.map((option) => option.id)));
    expect(GAME_MODE_GROUPS[0]!.modes.map((mode) => mode.id)).toEqual(["flags", "flag-colors", "shapes", "codes", "capitals", "capital-recall"]);
    expect(GAME_MODE_GROUPS[2]!.modes.map((mode) => mode.id)).toEqual(["geoguessr", "streetview-country"]);
  });

  it("marks exactly the server's leaderboard modes as timed-capable", () => {
    expect([...LEADERBOARD_GAME_MODE_IDS].sort()).toEqual([...GAME_MODE_IDS].sort());
    expect(isLeaderboardMode("flags")).toBe(true);
    expect(isLeaderboardMode("flag-colors")).toBe(false);
    expect(isLeaderboardMode("geoguessr")).toBe(false);
    for (const group of GAME_MODE_GROUPS) for (const mode of group.modes) expect(mode.leaderboard).toBe(isLeaderboardMode(mode.id));
  });
});

describe("SiteHeader and TabBar", () => {
  it("marks only the active section with aria-current and routes section clicks through ctx", () => {
    const ctx = makeContext();
    const header = createSiteHeader(ctx, { section: "learn" });
    document.body.append(header.element);
    const nav = header.element.querySelector(".shell-site-nav")!;
    const current = [...nav.querySelectorAll("a[aria-current]")];
    expect(current.map((link) => link.textContent)).toEqual(["Learn"]);
    expect([...nav.querySelectorAll("a")].map((link) => link.textContent)).toEqual(["Play", "Daily", "Learn", "Compete", "You"]);
    expect(nav.querySelector<HTMLAnchorElement>('a[data-section="compete"]')!.getAttribute("href")).toBe("/?view=compete");

    nav.querySelector<HTMLAnchorElement>('a[data-section="daily"]')!.click();
    header.element.querySelector<HTMLButtonElement>(".shell-brand")!.click();
    expect(ctx.calls).toEqual(["section:daily", "home"]);

    header.setSection("you");
    expect(nav.querySelector('a[aria-current="page"]')!.getAttribute("data-section")).toBe("you");
  });

  it("moves the shared controls cluster into the header and releases it on destroy", () => {
    const ctx = makeContext();
    const header = createSiteHeader(ctx, { section: "play" });
    expect(header.element.contains(ctx.controls)).toBe(true);
    header.destroy();
    expect(ctx.controls.isConnected).toBe(false);
  });

  it("renders the heading band with a back link that says where it goes", () => {
    const onBack = vi.fn();
    const header = createSiteHeader(makeContext(), { section: "learn", title: "Atlas", subtitle: "Every country", back: { label: "Back to Academy", onClick: onBack } });
    expect(header.heading!.querySelector("h1")!.textContent).toBe("Atlas");
    const back = header.heading!.querySelector<HTMLButtonElement>(".shell-back")!;
    expect(back.textContent).toBe("Back to Academy");
    back.click();
    expect(onBack).toHaveBeenCalledOnce();
    expect(createSiteHeader(makeContext(), { section: "play" }).heading).toBeNull();
  });

  it("builds a tab bar with five labelled tabs and the current one marked", () => {
    const ctx = makeContext();
    const tabs = createTabBar(ctx, "compete");
    expect(tabs.element.getAttribute("aria-label")).toBe("Sections");
    expect([...tabs.element.querySelectorAll(".shell-tab-label")].map((label) => label.textContent)).toEqual(["Play", "Daily", "Learn", "Compete", "You"]);
    expect(tabs.element.querySelector('[aria-current="page"]')!.getAttribute("data-section")).toBe("compete");
    tabs.element.querySelector<HTMLAnchorElement>('[data-section="play"]')!.click();
    expect(ctx.calls).toEqual(["section:play"]);
  });

  it("lets modified clicks through so section links open in a new tab", () => {
    const ctx = makeContext();
    const tabs = createTabBar(ctx, "play");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true });
    tabs.element.querySelector('[data-section="learn"]')!.dispatchEvent(event);
    expect(ctx.calls).toEqual([]);
  });

  it("wraps content in a site page marked for the shell", () => {
    const content = document.createElement("p");
    const page = createSitePage(makeContext(), { section: "compete", title: "Compete", content: [content] });
    expect(page.element.dataset.shell).toBe("site");
    expect(page.main.contains(content)).toBe(true);
    expect(page.main.querySelector("h1")!.textContent).toBe("Compete");
  });
});

describe("GameBar and game picker", () => {
  it("opens the picker from the switcher and starts the chosen game through ctx", async () => {
    const ctx = makeContext();
    const bar = createGameBar(ctx, { gameMode: "shapes", run: "practice", onBack: () => ctx.calls.push("onBack") });
    document.body.append(bar.element);
    expect(bar.element.querySelector(".shell-switcher-name")!.textContent).toBe("Country outlines");
    expect(bar.element.querySelector(".shell-run-pill")!.textContent).toContain("Practice");

    bar.element.querySelector<HTMLButtonElement>(".shell-switcher")!.click();
    const picker = document.querySelector<HTMLElement>(".shell-picker")!;
    expect(picker.getAttribute("role")).toBe("dialog");
    expect([...picker.querySelectorAll(".shell-picker-group h3")].map((heading) => heading.textContent)).toEqual(["Clues", "Map", "Street View"]);
    expect(picker.querySelector(".shell-picker-row.is-current [data-mode]")!.getAttribute("data-mode")).toBe("shapes");
    // Timed is offered for leaderboard modes only.
    expect(picker.querySelector('.shell-picker-timed[data-mode="flags"]')).not.toBeNull();
    expect(picker.querySelector('.shell-picker-timed[data-mode="flag-colors"]')).toBeNull();

    picker.querySelector<HTMLButtonElement>('.shell-picker-timed[data-mode="capitals"]')!.click();
    await flush();
    expect(ctx.calls).toEqual(["game:capitals:timed"]);
    expect(document.querySelector(".shell-picker")).toBeNull();
  });

  it("asks before leaving when the guard reports unsaved progress", async () => {
    const confirmLeave = vi.fn(async () => false);
    const ctx = makeContext({ confirmLeave });
    const onBack = vi.fn();
    const bar = createGameBar(ctx, { gameMode: "flags", run: "timed", onBack, leaveGuard: () => "Your timed run will end." });
    document.body.append(bar.element);
    bar.element.querySelector<HTMLButtonElement>(".shell-gamebar-back")!.click();
    await flush();
    expect(confirmLeave).toHaveBeenCalledWith("Your timed run will end.", expect.objectContaining({ confirmLabel: "Leave" }));
    expect(onBack).not.toHaveBeenCalled();

    confirmLeave.mockResolvedValueOnce(true);
    bar.element.querySelector<HTMLButtonElement>(".shell-switcher")!.click();
    document.querySelector<HTMLButtonElement>('.shell-picker-main[data-mode="puzzle"]')!.click();
    await flush();
    expect(ctx.calls).toEqual(["game:puzzle:practice"]);
  });

  it("shows the clock in the timed pill and keeps section links in the ⋯ menu", () => {
    const ctx = makeContext();
    const clock = document.createElement("span");
    clock.textContent = "01:24";
    const onHowToPlay = vi.fn();
    const bar = createGameBar(ctx, { gameMode: "name-all", run: "timed", clock, onBack: () => undefined, onHowToPlay });
    document.body.append(bar.element);
    const pill = bar.element.querySelector(".shell-run-pill")!;
    expect(pill.textContent).toBe("Timed01:24");
    expect(pill.classList.contains("has-clock")).toBe(true);

    const more = bar.element.querySelector<HTMLButtonElement>(".shell-gamebar-more")!;
    const menu = bar.element.querySelector<HTMLElement>(".shell-menu")!;
    expect(menu.hidden).toBe(true);
    more.click();
    expect(menu.hidden).toBe(false);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect([...menu.querySelectorAll("[data-section]")].map((item) => item.textContent)).toEqual(["Play", "Daily", "Learn", "Compete", "You"]);
    expect(menu.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(2);

    menu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click(); // How to play is first
    expect(onHowToPlay).toHaveBeenCalledOnce();
    expect(menu.hidden).toBe(true);

    more.click();
    keydown("Escape");
    expect(menu.hidden).toBe(true);
    bar.destroy();
  });

  it("works standalone and closes on Escape without picking", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    openGamePicker({ onPick, onClose });
    expect(document.querySelectorAll(".shell-picker-row")).toHaveLength(14);
    keydown("Escape");
    expect(document.querySelector(".shell-picker")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("FocusBar", () => {
  it("reports progress accessibly and swaps the trailing slot", () => {
    const onClose = vi.fn();
    const bar = createFocusBar({ onClose, closeLabel: "Back to Academy", progress: 0.25 });
    const progress = bar.element.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(progress.getAttribute("aria-valuenow")).toBe("25");
    bar.setProgress(0.5, "5 of 10 steps");
    expect(progress.getAttribute("aria-valuenow")).toBe("50");
    expect(progress.getAttribute("aria-valuetext")).toBe("5 of 10 steps");
    const streak = document.createElement("span");
    bar.setTrailing(streak);
    expect(bar.progressWrap.lastElementChild).toBe(streak);
    bar.close.click();
    expect(onClose).toHaveBeenCalledOnce();
    expect(bar.close.getAttribute("aria-label")).toBe("Back to Academy");
  });
});

describe("confirmDialog", () => {
  it("resolves true on confirm and restores focus", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const answer = confirmDialog("Leave the lesson?", { confirmLabel: "Leave", cancelLabel: "Stay" });
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement?.textContent).toBe("Stay");
    dialog.querySelector<HTMLButtonElement>('[data-action="confirm"]')!.click();
    await expect(answer).resolves.toBe(true);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("resolves false on Escape and traps Tab inside", async () => {
    const answer = confirmDialog("Discard your run?");
    const [cancel, confirm] = [...document.querySelectorAll<HTMLButtonElement>(".shell-dialog button")];
    confirm!.focus();
    keydown("Tab");
    expect(document.activeElement).toBe(cancel);
    keydown("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(confirm);
    keydown("Escape");
    await expect(answer).resolves.toBe(false);
  });
});

describe("results card", () => {
  it("wires play again, try another game, missed countries and the cross-link", () => {
    const ctx = makeContext();
    const playAgain = vi.fn();
    const timed = vi.fn();
    const card = createResultsCard(ctx, {
      title: "Nicely done",
      stats: [{ label: "Score", value: "8/10" }, { label: "Time", value: "1:42", note: "personal best" }],
      missed: [{ code: "TD", name: "Chad", flagSrc: "/flags/td.svg" }],
      primary: { label: "Play again", onClick: playAgain },
      crossLink: { label: "Try it timed →", onClick: timed },
    });
    document.body.append(card.element);
    expect([...card.element.querySelectorAll("dt")].map((term) => term.textContent)).toEqual(["Score", "Time"]);
    card.element.querySelector<HTMLButtonElement>(".shell-results-primary")!.click();
    [...card.element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Try another game")!.click();
    card.element.querySelector<HTMLButtonElement>('[data-country="TD"]')!.click();
    card.element.querySelector<HTMLButtonElement>(".shell-results-cross")!.click();
    expect(playAgain).toHaveBeenCalledOnce();
    expect(timed).toHaveBeenCalledOnce();
    expect(ctx.calls).toEqual(["picker", "country:TD"]);
    expect(card.element.querySelector(".shell-results-cross")!.textContent).toBe("Try it timed");
  });

  it("shares through navigator.share, falling back to the clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const card = createResultsCard(makeContext(), { title: "Done", stats: [], primary: { label: "Play again", onClick: () => undefined }, share: { text: "Locato 8/10" } });
    document.body.append(card.element);
    card.element.querySelector<HTMLButtonElement>(".shell-results-share")!.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith("Locato 8/10");
    expect(card.element.querySelector(".shell-results-status")!.textContent).toBe("Copied to your clipboard.");

    const share = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    card.element.querySelector<HTMLButtonElement>(".shell-results-share")!.click();
    await flush();
    expect(share).toHaveBeenCalledWith({ text: "Locato 8/10" });
  });
});
