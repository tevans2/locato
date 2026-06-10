import { createApp } from "./app/createApp";
import { indexCountries, rawCountries, validateCountries } from "./core/countries";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/game.css";
import "./styles/board.css";
import "./styles/multiplayer.css";
import "./styles/responsive.css";
import "./styles/auth.css";
import "./styles/stats.css";

const root = document.getElementById("app");

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
