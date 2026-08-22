import { createApp } from "./app/createApp";
import { indexCountries, rawCountries, validateCountries } from "./core/countries";
import { initializeTheme } from "./ui/theme";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/landing.css";
import "./styles/game.css";
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

const root = document.getElementById("app");

initializeTheme(window.localStorage);

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
