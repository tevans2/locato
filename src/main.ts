import { createApp } from "./app/createApp";
import { indexCountries, rawCountries, validateCountries } from "./core/countries";
import { initializeTheme } from "./ui/theme";
import { initAnalytics } from "./app/analytics";
import { isAppleTouchDevice } from "./ui/dom/mobileKeyboard";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/game.css";
import "./styles/geoguessr.css";
import "./styles/worldsplit.css";
import "./styles/board.css";
import "./styles/multiplayer.css";
import "./styles/auth.css";
import "./styles/stats.css";
import "./styles/friends.css";
import "./styles/responsive.css";
import "./styles/theme-refresh.css";
import "./styles/experience-refresh.css";
import "./styles/sfx.css";
import "./styles/design-system.css";
import "./styles/landing.css";
import "./styles/geoguessr-play.css";

const root = document.getElementById("app");

initializeTheme(window.localStorage);
// iPhone browsers put their toolbar at the bottom, so phone tabs go in the header there (shell.css).
// Not in a home-screen install, which has no browser toolbar.
const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
document.documentElement.classList.toggle("has-top-tabs", isAppleTouchDevice() && !standalone);
// Before the app rewrites the URL, so UTM tags and ?ref= are still there to read.
initAnalytics();

if (!root) {
  throw new Error("Missing #app root element.");
}

const countryIndex = indexCountries(rawCountries);
const validation = validateCountries(countryIndex);

if (!validation.valid) {
  root.replaceChildren(document.createTextNode(validation.issues.map((issue) => issue.message).join("\n")));
} else {
  createApp({ root, countryIndex, storage: window.localStorage }).start();
}
