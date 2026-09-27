import type { GameModeId } from "../../core/gameModes";
import type { ShellIconName } from "./icons";

/**
 * The five places the site is organised into (docs/navigation.md → "Sections").
 * Every screen belongs to exactly one; SiteHeader/TabBar mark it with `aria-current`.
 */
export type SiteSection = "play" | "daily" | "learn" | "compete" | "you";

/** Practice runs have no clock and post nothing; timed runs post to a leaderboard. */
export type RunType = "practice" | "timed";

export interface SiteSectionInfo {
  readonly id: SiteSection;
  /** Sentence-case label used in the header, tab bar and ⋯ menu. */
  readonly label: string;
  readonly icon: ShellIconName;
}

export const SITE_SECTIONS: readonly SiteSectionInfo[] = [
  { id: "play", label: "Play", icon: "gamepad-2" },
  { id: "daily", label: "Daily", icon: "calendar-days" },
  { id: "learn", label: "Learn", icon: "graduation-cap" },
  { id: "compete", label: "Compete", icon: "trophy" },
  { id: "you", label: "You", icon: "user-round" },
];

export interface ConfirmOptions {
  /** Optional bold heading above the message. */
  readonly title?: string;
  /** Default "Leave". */
  readonly confirmLabel?: string;
  /** Default "Stay". */
  readonly cancelLabel?: string;
  /** "danger" paints the confirm button in the warning colour (discarding progress). */
  readonly tone?: "default" | "danger";
}

/**
 * Everything a screen needs to navigate and to render the shared chrome. App builds one
 * instance at start-up and passes it to every screen as `shell`. Screens never import App.
 *
 * All navigation methods push a history entry (see the History rule in docs/navigation.md);
 * none of them ask for confirmation — call `confirmLeave` first when leaving would discard
 * progress (GameBar does this for you through its `leaveGuard` option).
 */
export interface ShellContext {
  /** Open a section's home: play → landing, daily → Daily challenge, learn → Academy, compete → Compete, you → Stats. */
  readonly openSection: (section: SiteSection) => void;
  /** The logo's target. Always `/`. */
  readonly goHome: () => void;
  /** Browser Back. On a cold start (nothing to pop) opens `fallback`'s section home (default "play"). */
  readonly goBack: (fallback?: SiteSection) => void;
  /**
   * Start a mode. Practice resumes that mode's saved run; "timed" opens `&run=timed` (leaderboard
   * modes only; others fall back to practice). `variant` is the leaderboard variant: a flag set
   * ("territories" / "both") for flags, or a continent for puzzle.
   */
  readonly openGame: (mode: GameModeId, run?: RunType, variant?: string) => void;
  /** Open the game picker sheet; choosing a game calls `openGame`. `current` is marked "Playing". */
  readonly openGamePicker: (options?: { readonly current?: GameModeId; readonly run?: RunType }) => void;
  /** Open a country's Atlas profile (`?country=xx`). */
  readonly openCountry: (code: string) => void;
  /** Open Compete, optionally focused on one mode's board (and variant, e.g. a flag set or continent). */
  readonly openCompete: (mode?: GameModeId, variant?: string) => void;
  /** Open the sign-in / account panel. */
  readonly openAccount: () => void;
  /**
   * The sound · theme · account cluster. It is a single shared element, so whichever
   * SiteHeader was built last owns it (it sits on the header's right). GameBar does not use
   * it — its ⋯ menu renders its own sound / theme / account rows. Don't append it yourself.
   */
  readonly controls: HTMLElement;
  /** Accessible in-app confirmation (never `window.confirm`). Resolves true when the player confirms. */
  readonly confirmLeave: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  /** Whether a player is signed in right now (read it at the moment you need it). */
  readonly signedIn: () => boolean;
  /** App storage, for preference toggles rendered by the shell. */
  readonly storage?: Storage;
}

/**
 * Screens that render a shell header set `data-shell` on their root element so App stops
 * overlaying the legacy fixed top-right controls: "site" (SiteHeader), "game" (GameBar),
 * "focus" (FocusBar). `markShellScreen(element, layout)` sets it for you.
 */
export type ShellLayout = "site" | "game" | "focus";

export function markShellScreen(element: HTMLElement, layout: ShellLayout): HTMLElement {
  element.dataset.shell = layout;
  return element;
}

export function sectionInfo(section: SiteSection): SiteSectionInfo {
  return SITE_SECTIONS.find((item) => item.id === section) ?? SITE_SECTIONS[0]!;
}
