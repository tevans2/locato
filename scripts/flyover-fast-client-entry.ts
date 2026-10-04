import { createFlyoverScreen } from "../src/ui/screens/FlyoverScreen";
import { createSeededRandom } from "../src/core/game/random";
import { fetchAuthState } from "../src/core/auth";
import { postRankedAttempt, type TimedRunPosting } from "../src/core/timer/leaderboardSync";
import { shellOrFallback } from "../src/ui/screens/practiceRun";
// The build script turns the console autopilot into an importable installer.
// @ts-expect-error The generated installer is JavaScript.
import installAutopilot from "./flyover-autopilot.js";

(async () => {
  const previous = (window as any).flyoverFastClient;
  previous?.restore();
  const original = document.querySelector<HTMLElement>("#app > .flyover-screen");
  if (!original?.parentElement) throw new Error("Open solo Flyover and stay on the Take off screen before pasting this script.");
  if (original.querySelector(".flyover-stage.is-flying")) throw new Error("Restart the current flight before installing the fast test client.");
  (window as any).flyoverAutopilot?.stop();

  const auth = await fetchAuthState();
  if (!auth.user) throw new Error("Sign in to Locato before installing this client so your finished score can be posted.");

  const response = await fetch("/assets/world-map.json");
  if (!response.ok) throw new Error(`Map request failed: ${response.status}`);
  const features = await response.json();
  const parent = original.parentElement;
  let lastScore: number | null = null;
  let posting: TimedRunPosting | null = null;
  let restored = false;
  let autopilot: { stop: () => void } | undefined;
  const screen = createFlyoverScreen({
    worldCountryFeatures: features,
    storage: window.localStorage,
    shell: {
      ...shellOrFallback(undefined, () => restore()),
      signedIn: () => true,
      storage: window.localStorage,
      openCompete: () => {
        restore();
        window.location.href = `${window.location.pathname}?view=compete&mode=flyover`;
      },
    },
    onHome: () => restore(),
  }, {
    rng: createSeededRandom("solo-one"),
    postAttempt: async (input) => {
      lastScore = input.value;
      posting = await postRankedAttempt(input);
      console.info(`[Flyover fast test] Finished: ${lastScore}.`, posting);
      return posting;
    },
  });

  function restore() {
    if (restored) return;
    restored = true;
    autopilot?.stop();
    screen.destroy();
    if (screen.element.parentElement === parent) screen.element.replaceWith(original);
    console.info("[Flyover fast test] Original game restored. Reloading also restores it.");
  }

  const label = document.createElement("div");
  label.textContent = "Fast solo flight · speed ×3 · turning ×3 · touch radius ×3 · finished scores submit to your leaderboard";
  label.style.cssText = "padding:8px 12px;text-align:center;background:#31583f;color:white;font:600 13px system-ui";
  screen.element.prepend(label);
  const readyText = screen.element.querySelector(".flyover-ready-card p");
  if (readyText) readyText.textContent = `90 seconds with altered client physics. Your finished score submits to ${auth.user.displayName}'s Flyover leaderboard.`;
  original.replaceWith(screen.element);
  try {
    autopilot = await installAutopilot();
  } catch (error) {
    restore();
    throw error;
  }
  const api = {
    settings: { speed: 126, boost: 1.9, turnRate: Math.PI * 2.85, touchRadius: 6.6, durationSeconds: 90, seed: "solo-one" },
    status: () => ({ restored, lastScore, posting, currentScore: Number(screen.element.querySelector(".flyover-score-value")?.textContent ?? 0) }),
    stop: () => autopilot?.stop(),
    restore,
  };
  (window as any).flyoverFastClient = api;
  console.info("[Flyover fast test] Installed. Click Take off and keep this tab active. Restore with flyoverFastClient.restore().", api.settings);
  return api;
})().catch((error) => console.error("[Flyover fast test] Could not start.", error));
