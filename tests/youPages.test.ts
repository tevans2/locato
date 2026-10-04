// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStatsScreen } from "../src/ui/screens/StatsScreen";
import { createFriendsScreen } from "../src/ui/screens/FriendsScreen";
import { ACHIEVEMENTS, recordDailyAchievement } from "../src/storage/achievements";
import type { ShellContext } from "../src/ui/shell/types";

function makeShell(signedIn = false): ShellContext {
  return {
    openSection: vi.fn(),
    goHome: vi.fn(),
    goBack: vi.fn(),
    openGame: vi.fn(),
    openGamePicker: vi.fn(),
    openCountry: vi.fn(),
    openLeaderboards: vi.fn(),
    openAccount: vi.fn(),
    controls: document.createElement("div"),
    confirmLeave: vi.fn(async () => true),
    signedIn: () => signedIn,
  };
}

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

const screens: { destroy: () => void }[] = [];
afterEach(() => {
  for (const screen of screens.splice(0)) screen.destroy();
  document.body.replaceChildren();
});

function mountStats(options: Partial<Parameters<typeof createStatsScreen>[0]> = {}) {
  const shell = options.shell ?? makeShell();
  const onFriends = vi.fn();
  const screen = createStatsScreen({ shell, onFriends, fetchStats: async () => null, ...options });
  screens.push(screen);
  document.body.append(screen.element);
  const root = screen.element;
  const tab = (id: string) => root.querySelector<HTMLButtonElement>(`.you-tab[data-tab="${id}"]`)!;
  return { shell, onFriends, root, tab };
}

describe("Stats page", () => {
  it("is a You site page with Stats · Friends · Achievements tabs", () => {
    const ui = mountStats();
    expect(ui.root.dataset.shell).toBe("site");
    expect(ui.root.querySelector('.shell-nav-link[aria-current="page"]')?.textContent).toBe("You");
    expect([...ui.root.querySelectorAll(".you-tab")].map((b) => b.textContent)).toEqual(["Stats", "Friends", "Achievements"]);
    expect(ui.tab("stats").getAttribute("aria-current")).toBe("page");
    expect(ui.root.querySelector("h1")?.textContent).toBe("Stats");
  });

  it("asks guests to sign in", () => {
    const ui = mountStats();
    const signIn = ui.root.querySelector<HTMLButtonElement>(".you-guest button")!;
    expect(ui.root.querySelector(".you-guest-title")?.textContent).toBe("Sign in to see your stats");
    signIn.click();
    expect(ui.shell.openAccount).toHaveBeenCalled();
  });

  it("switches to the achievements gallery in place, and Friends opens its page", () => {
    const storage = memoryStorage();
    recordDailyAchievement(storage, "2026-09-27");
    const onTabChange = vi.fn();
    const ui = mountStats({ storage, onTabChange });
    ui.tab("achievements").click();
    expect(onTabChange).toHaveBeenCalledWith("achievements");
    expect(ui.tab("achievements").getAttribute("aria-current")).toBe("page");
    expect(ui.tab("stats").hasAttribute("aria-current")).toBe(false);
    expect(ui.root.querySelector("h1")?.textContent).toBe("Achievements");
    expect(ui.root.querySelector<HTMLElement>("#stats-panel")?.hidden).toBe(true);
    const cards = [...ui.root.querySelectorAll<HTMLElement>(".you-achievement")];
    expect(cards).toHaveLength(ACHIEVEMENTS.length);
    expect(cards[0]?.dataset.achievement).toBe("daily-first");
    expect(cards[0]?.classList.contains("is-unlocked")).toBe(true);
    expect(ui.root.querySelectorAll(".you-achievement.is-locked")).toHaveLength(ACHIEVEMENTS.length - 1);
    expect(ui.root.querySelector(".you-achievements-count")?.textContent).toBe(`1 of ${ACHIEVEMENTS.length} unlocked`);
    ui.tab("friends").click();
    expect(ui.onFriends).toHaveBeenCalled();
  });

  it("can open on the achievements tab", () => {
    const ui = mountStats({ initialTab: "achievements", storage: memoryStorage() });
    expect(ui.tab("achievements").getAttribute("aria-current")).toBe("page");
    expect(ui.root.querySelectorAll(".you-achievement.is-unlocked")).toHaveLength(0);
  });
});

describe("Friends page", () => {
  it("has the site header, the You tabs and a guest sign-in prompt", () => {
    const shell = makeShell(false);
    const onOpenTab = vi.fn();
    const screen = createFriendsScreen({ shell, onOpenTab, initialUsername: "amy" });
    screens.push(screen);
    document.body.append(screen.element);
    const root = screen.element;
    expect(root.dataset.shell).toBe("site");
    expect(root.querySelector(".shell-brand")).not.toBeNull();
    expect(root.querySelector('.you-tab[data-tab="friends"]')?.getAttribute("aria-current")).toBe("page");
    expect(root.querySelector(".you-guest-title")?.textContent).toBe("Sign in to add amy");
    expect(root.querySelector(".friend-add-form")).toBeNull();
    root.querySelector<HTMLButtonElement>(".you-guest button")!.click();
    expect(shell.openAccount).toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>('.you-tab[data-tab="achievements"]')!.click();
    expect(onOpenTab).toHaveBeenCalledWith("achievements");
  });
});
