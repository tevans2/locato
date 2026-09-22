import { el } from "./createElement";
import { createMobileMenu, type MobileMenu } from "./mobileMenu";

/** Shared mobile navigation for map modes that do not need the full account menu. */
export function createMobileGameNav(options: {
  readonly onHome: () => void;
  readonly onDailyChallenge?: () => void;
  readonly onMultiplayer?: () => void;
}, signal: AbortSignal): MobileMenu {
  return createMobileMenu("Explore", [{ title: "Play", items: [
    el("button", { className: "mobile-nav-item", text: "All games", attrs: { type: "button" }, on: { click: options.onHome } }),
    ...(options.onDailyChallenge ? [el("button", { className: "mobile-nav-item", text: "Daily challenge", attrs: { type: "button" }, on: { click: options.onDailyChallenge } })] : []),
    ...(options.onMultiplayer ? [el("button", { className: "mobile-nav-item", text: "Multiplayer", attrs: { type: "button" }, on: { click: options.onMultiplayer } })] : []),
  ] }], signal);
}
