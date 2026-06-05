import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = resolve("outputs/country-guessing-game.html");

const countries = [
  ["Afghanistan", "AF", ["Islamic Republic of Afghanistan"]],
  ["Albania", "AL", ["Republic of Albania"]],
  ["Algeria", "DZ", ["People's Democratic Republic of Algeria"]],
  ["Andorra", "AD", ["Principality of Andorra"]],
  ["Angola", "AO", ["Republic of Angola"]],
  ["Antigua and Barbuda", "AG", []],
  ["Argentina", "AR", ["Argentine Republic"]],
  ["Armenia", "AM", ["Republic of Armenia"]],
  ["Australia", "AU", ["Commonwealth of Australia"]],
  ["Austria", "AT", ["Republic of Austria"]],
  ["Azerbaijan", "AZ", ["Republic of Azerbaijan"]],
  ["Bahamas", "BS", ["The Bahamas", "Commonwealth of The Bahamas", "Bahamas (The)"]],
  ["Bahrain", "BH", ["Kingdom of Bahrain"]],
  ["Bangladesh", "BD", ["People's Republic of Bangladesh"]],
  ["Barbados", "BB", []],
  ["Belarus", "BY", ["Republic of Belarus"]],
  ["Belgium", "BE", ["Kingdom of Belgium"]],
  ["Belize", "BZ", []],
  ["Benin", "BJ", ["Republic of Benin"]],
  ["Bhutan", "BT", ["Kingdom of Bhutan"]],
  ["Bolivia", "BO", ["Plurinational State of Bolivia", "Bolivia (Plurinational State of)"]],
  ["Bosnia and Herzegovina", "BA", ["Bosnia"]],
  ["Botswana", "BW", ["Republic of Botswana"]],
  ["Brazil", "BR", ["Federative Republic of Brazil"]],
  ["Brunei", "BN", ["Brunei Darussalam", "Nation of Brunei"]],
  ["Bulgaria", "BG", ["Republic of Bulgaria"]],
  ["Burkina Faso", "BF", []],
  ["Burundi", "BI", ["Republic of Burundi"]],
  ["Cabo Verde", "CV", ["Cape Verde", "Republic of Cabo Verde"]],
  ["Cambodia", "KH", ["Kingdom of Cambodia"]],
  ["Cameroon", "CM", ["Republic of Cameroon"]],
  ["Canada", "CA", []],
  ["Central African Republic", "CF", ["CAR"]],
  ["Chad", "TD", ["Republic of Chad"]],
  ["Chile", "CL", ["Republic of Chile"]],
  ["China", "CN", ["People's Republic of China", "PRC"]],
  ["Colombia", "CO", ["Republic of Colombia"]],
  ["Comoros", "KM", ["Union of the Comoros"]],
  ["Congo", "CG", ["Republic of the Congo", "Congo-Brazzaville", "Congo Brazzaville"]],
  ["Costa Rica", "CR", ["Republic of Costa Rica"]],
  ["Cote d'Ivoire", "CI", ["Ivory Coast", "Côte d'Ivoire", "Republic of Côte d'Ivoire"]],
  ["Croatia", "HR", ["Republic of Croatia"]],
  ["Cuba", "CU", ["Republic of Cuba"]],
  ["Cyprus", "CY", ["Republic of Cyprus"]],
  ["Czechia", "CZ", ["Czech Republic"]],
  ["Democratic Republic of the Congo", "CD", ["DR Congo", "DRC", "Congo-Kinshasa", "Congo Kinshasa", "Democratic Republic of Congo"]],
  ["Denmark", "DK", ["Kingdom of Denmark"]],
  ["Djibouti", "DJ", ["Republic of Djibouti"]],
  ["Dominica", "DM", ["Commonwealth of Dominica"]],
  ["Dominican Republic", "DO", []],
  ["Ecuador", "EC", ["Republic of Ecuador"]],
  ["Egypt", "EG", ["Arab Republic of Egypt"]],
  ["El Salvador", "SV", ["Republic of El Salvador"]],
  ["Equatorial Guinea", "GQ", ["Republic of Equatorial Guinea"]],
  ["Eritrea", "ER", ["State of Eritrea"]],
  ["Estonia", "EE", ["Republic of Estonia"]],
  ["Eswatini", "SZ", ["Swaziland", "Kingdom of Eswatini"]],
  ["Ethiopia", "ET", ["Federal Democratic Republic of Ethiopia"]],
  ["Fiji", "FJ", ["Republic of Fiji"]],
  ["Finland", "FI", ["Republic of Finland"]],
  ["France", "FR", ["French Republic"]],
  ["Gabon", "GA", ["Gabonese Republic"]],
  ["Gambia", "GM", ["The Gambia", "Republic of The Gambia", "Gambia (The)"]],
  ["Georgia", "GE", []],
  ["Germany", "DE", ["Federal Republic of Germany"]],
  ["Ghana", "GH", ["Republic of Ghana"]],
  ["Greece", "GR", ["Hellenic Republic"]],
  ["Grenada", "GD", []],
  ["Guatemala", "GT", ["Republic of Guatemala"]],
  ["Guinea", "GN", ["Republic of Guinea"]],
  ["Guinea-Bissau", "GW", ["Guinea Bissau", "Republic of Guinea-Bissau"]],
  ["Guyana", "GY", ["Co-operative Republic of Guyana", "Cooperative Republic of Guyana"]],
  ["Haiti", "HT", ["Republic of Haiti"]],
  ["Honduras", "HN", ["Republic of Honduras"]],
  ["Hungary", "HU", []],
  ["Iceland", "IS", ["Republic of Iceland"]],
  ["India", "IN", ["Republic of India"]],
  ["Indonesia", "ID", ["Republic of Indonesia"]],
  ["Iran", "IR", ["Islamic Republic of Iran", "Iran (Islamic Republic of)"]],
  ["Iraq", "IQ", ["Republic of Iraq"]],
  ["Ireland", "IE", []],
  ["Israel", "IL", ["State of Israel"]],
  ["Italy", "IT", ["Italian Republic"]],
  ["Jamaica", "JM", []],
  ["Japan", "JP", []],
  ["Jordan", "JO", ["Hashemite Kingdom of Jordan"]],
  ["Kazakhstan", "KZ", ["Republic of Kazakhstan"]],
  ["Kenya", "KE", ["Republic of Kenya"]],
  ["Kiribati", "KI", ["Republic of Kiribati"]],
  ["Kuwait", "KW", ["State of Kuwait"]],
  ["Kyrgyzstan", "KG", ["Kyrgyz Republic"]],
  ["Laos", "LA", ["Lao People's Democratic Republic", "Lao PDR"]],
  ["Latvia", "LV", ["Republic of Latvia"]],
  ["Lebanon", "LB", ["Lebanese Republic"]],
  ["Lesotho", "LS", ["Kingdom of Lesotho"]],
  ["Liberia", "LR", ["Republic of Liberia"]],
  ["Libya", "LY", ["State of Libya"]],
  ["Liechtenstein", "LI", ["Principality of Liechtenstein"]],
  ["Lithuania", "LT", ["Republic of Lithuania"]],
  ["Luxembourg", "LU", ["Grand Duchy of Luxembourg"]],
  ["Madagascar", "MG", ["Republic of Madagascar"]],
  ["Malawi", "MW", ["Republic of Malawi"]],
  ["Malaysia", "MY", []],
  ["Maldives", "MV", ["Republic of Maldives"]],
  ["Mali", "ML", ["Republic of Mali"]],
  ["Malta", "MT", ["Republic of Malta"]],
  ["Marshall Islands", "MH", ["Republic of the Marshall Islands"]],
  ["Mauritania", "MR", ["Islamic Republic of Mauritania"]],
  ["Mauritius", "MU", ["Republic of Mauritius"]],
  ["Mexico", "MX", ["United Mexican States"]],
  ["Micronesia", "FM", ["Federated States of Micronesia"]],
  ["Moldova", "MD", ["Republic of Moldova"]],
  ["Monaco", "MC", ["Principality of Monaco"]],
  ["Mongolia", "MN", []],
  ["Montenegro", "ME", []],
  ["Morocco", "MA", ["Kingdom of Morocco"]],
  ["Mozambique", "MZ", ["Republic of Mozambique"]],
  ["Myanmar", "MM", ["Burma", "Republic of the Union of Myanmar"]],
  ["Namibia", "NA", ["Republic of Namibia"]],
  ["Nauru", "NR", ["Republic of Nauru"]],
  ["Nepal", "NP", ["Federal Democratic Republic of Nepal"]],
  ["Netherlands", "NL", ["Kingdom of the Netherlands", "Holland"]],
  ["New Zealand", "NZ", []],
  ["Nicaragua", "NI", ["Republic of Nicaragua"]],
  ["Niger", "NE", ["Republic of the Niger"]],
  ["Nigeria", "NG", ["Federal Republic of Nigeria"]],
  ["North Korea", "KP", ["Democratic People's Republic of Korea", "DPRK", "Korea DPR"]],
  ["North Macedonia", "MK", ["Republic of North Macedonia", "Macedonia"]],
  ["Norway", "NO", ["Kingdom of Norway"]],
  ["Oman", "OM", ["Sultanate of Oman"]],
  ["Pakistan", "PK", ["Islamic Republic of Pakistan"]],
  ["Palau", "PW", ["Republic of Palau"]],
  ["Panama", "PA", ["Republic of Panama"]],
  ["Papua New Guinea", "PG", []],
  ["Paraguay", "PY", ["Republic of Paraguay"]],
  ["Peru", "PE", ["Republic of Peru"]],
  ["Philippines", "PH", ["Republic of the Philippines"]],
  ["Poland", "PL", ["Republic of Poland"]],
  ["Portugal", "PT", ["Portuguese Republic"]],
  ["Qatar", "QA", ["State of Qatar"]],
  ["Romania", "RO", []],
  ["Russia", "RU", ["Russian Federation"]],
  ["Rwanda", "RW", ["Republic of Rwanda"]],
  ["Saint Kitts and Nevis", "KN", ["St Kitts and Nevis", "St. Kitts and Nevis"]],
  ["Saint Lucia", "LC", ["St Lucia", "St. Lucia"]],
  ["Saint Vincent and the Grenadines", "VC", ["St Vincent and the Grenadines", "St. Vincent and the Grenadines"]],
  ["Samoa", "WS", ["Independent State of Samoa"]],
  ["San Marino", "SM", ["Republic of San Marino"]],
  ["Sao Tome and Principe", "ST", ["São Tomé and Príncipe", "Sao Tome", "São Tomé"]],
  ["Saudi Arabia", "SA", ["Kingdom of Saudi Arabia"]],
  ["Senegal", "SN", ["Republic of Senegal"]],
  ["Serbia", "RS", ["Republic of Serbia"]],
  ["Seychelles", "SC", ["Republic of Seychelles"]],
  ["Sierra Leone", "SL", ["Republic of Sierra Leone"]],
  ["Singapore", "SG", ["Republic of Singapore"]],
  ["Slovakia", "SK", ["Slovak Republic"]],
  ["Slovenia", "SI", ["Republic of Slovenia"]],
  ["Solomon Islands", "SB", []],
  ["Somalia", "SO", ["Federal Republic of Somalia"]],
  ["South Africa", "ZA", ["Republic of South Africa"]],
  ["South Korea", "KR", ["Republic of Korea", "Korea", "Korea Republic"]],
  ["South Sudan", "SS", ["Republic of South Sudan"]],
  ["Spain", "ES", ["Kingdom of Spain"]],
  ["Sri Lanka", "LK", ["Democratic Socialist Republic of Sri Lanka"]],
  ["Sudan", "SD", ["Republic of the Sudan"]],
  ["Suriname", "SR", ["Republic of Suriname"]],
  ["Sweden", "SE", ["Kingdom of Sweden"]],
  ["Switzerland", "CH", ["Swiss Confederation"]],
  ["Syria", "SY", ["Syrian Arab Republic"]],
  ["Tajikistan", "TJ", ["Republic of Tajikistan"]],
  ["Tanzania", "TZ", ["United Republic of Tanzania"]],
  ["Thailand", "TH", ["Kingdom of Thailand"]],
  ["Timor-Leste", "TL", ["East Timor", "Democratic Republic of Timor-Leste"]],
  ["Togo", "TG", ["Togolese Republic"]],
  ["Tonga", "TO", ["Kingdom of Tonga"]],
  ["Trinidad and Tobago", "TT", []],
  ["Tunisia", "TN", ["Republic of Tunisia"]],
  ["Turkiye", "TR", ["Turkey", "Türkiye", "Republic of Türkiye"]],
  ["Turkmenistan", "TM", []],
  ["Tuvalu", "TV", []],
  ["Uganda", "UG", ["Republic of Uganda"]],
  ["Ukraine", "UA", []],
  ["United Arab Emirates", "AE", ["UAE"]],
  ["United Kingdom", "GB", ["UK", "Great Britain", "Britain", "United Kingdom of Great Britain and Northern Ireland"]],
  ["United States", "US", ["USA", "US", "U.S.A.", "America", "United States of America"]],
  ["Uruguay", "UY", ["Oriental Republic of Uruguay"]],
  ["Uzbekistan", "UZ", ["Republic of Uzbekistan"]],
  ["Vanuatu", "VU", ["Republic of Vanuatu"]],
  ["Venezuela", "VE", ["Bolivarian Republic of Venezuela", "Venezuela (Bolivarian Republic of)"]],
  ["Vietnam", "VN", ["Viet Nam", "Socialist Republic of Viet Nam"]],
  ["Yemen", "YE", ["Republic of Yemen"]],
  ["Zambia", "ZM", ["Republic of Zambia"]],
  ["Zimbabwe", "ZW", ["Republic of Zimbabwe"]],
  ["Holy See", "VA", ["Vatican", "Vatican City", "Holy See (Vatican City State)"]],
  ["Palestine", "PS", ["State of Palestine", "Palestinian State"]],
  ["Taiwan", "TW", ["Republic of China", "Chinese Taipei"]],
];

const continentOrder = ["Africa", "Asia", "Europe", "North America", "Oceania", "South America"];

const continentByCode = {
  DZ: "Africa", AO: "Africa", BJ: "Africa", BW: "Africa", BF: "Africa", BI: "Africa",
  CV: "Africa", CM: "Africa", CF: "Africa", TD: "Africa", KM: "Africa", CG: "Africa",
  CI: "Africa", CD: "Africa", DJ: "Africa", EG: "Africa", GQ: "Africa", ER: "Africa",
  SZ: "Africa", ET: "Africa", GA: "Africa", GM: "Africa", GH: "Africa", GN: "Africa",
  GW: "Africa", KE: "Africa", LS: "Africa", LR: "Africa", LY: "Africa", MG: "Africa",
  MW: "Africa", ML: "Africa", MR: "Africa", MU: "Africa", MA: "Africa", MZ: "Africa",
  NA: "Africa", NE: "Africa", NG: "Africa", RW: "Africa", ST: "Africa", SN: "Africa",
  SC: "Africa", SL: "Africa", SO: "Africa", ZA: "Africa", SS: "Africa", SD: "Africa",
  TZ: "Africa", TG: "Africa", TN: "Africa", UG: "Africa", ZM: "Africa", ZW: "Africa",

  AF: "Asia", AM: "Asia", AZ: "Asia", BH: "Asia", BD: "Asia", BT: "Asia",
  BN: "Asia", KH: "Asia", CN: "Asia", CY: "Asia", GE: "Asia", IN: "Asia",
  ID: "Asia", IR: "Asia", IQ: "Asia", IL: "Asia", JP: "Asia", JO: "Asia",
  KZ: "Asia", KW: "Asia", KG: "Asia", LA: "Asia", LB: "Asia", MY: "Asia",
  MV: "Asia", MN: "Asia", MM: "Asia", NP: "Asia", KP: "Asia", OM: "Asia",
  PK: "Asia", PS: "Asia", PH: "Asia", QA: "Asia", SA: "Asia", SG: "Asia",
  KR: "Asia", LK: "Asia", SY: "Asia", TW: "Asia", TJ: "Asia", TH: "Asia",
  TL: "Asia", TR: "Asia", TM: "Asia", AE: "Asia", UZ: "Asia", VN: "Asia",
  YE: "Asia",

  AL: "Europe", AD: "Europe", AT: "Europe", BY: "Europe", BE: "Europe", BA: "Europe",
  BG: "Europe", HR: "Europe", CZ: "Europe", DK: "Europe", EE: "Europe", FI: "Europe",
  FR: "Europe", DE: "Europe", GR: "Europe", HU: "Europe", IS: "Europe", IE: "Europe",
  IT: "Europe", LV: "Europe", LI: "Europe", LT: "Europe", LU: "Europe", MT: "Europe",
  MD: "Europe", MC: "Europe", ME: "Europe", NL: "Europe", MK: "Europe", NO: "Europe",
  PL: "Europe", PT: "Europe", RO: "Europe", RU: "Europe", SM: "Europe", RS: "Europe",
  SK: "Europe", SI: "Europe", ES: "Europe", SE: "Europe", CH: "Europe", UA: "Europe",
  GB: "Europe", VA: "Europe",

  AG: "North America", BS: "North America", BB: "North America", BZ: "North America",
  CA: "North America", CR: "North America", CU: "North America", DM: "North America",
  DO: "North America", SV: "North America", GD: "North America", GT: "North America",
  HT: "North America", HN: "North America", JM: "North America", MX: "North America",
  NI: "North America", PA: "North America", KN: "North America", LC: "North America",
  VC: "North America", TT: "North America", US: "North America",

  AU: "Oceania", FJ: "Oceania", KI: "Oceania", MH: "Oceania", FM: "Oceania",
  NR: "Oceania", NZ: "Oceania", PW: "Oceania", PG: "Oceania", WS: "Oceania",
  SB: "Oceania", TO: "Oceania", TV: "Oceania", VU: "Oceania",

  AR: "South America", BO: "South America", BR: "South America", CL: "South America",
  CO: "South America", EC: "South America", GY: "South America", PY: "South America",
  PE: "South America", SR: "South America", UY: "South America", VE: "South America",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadFlag(code) {
  const path = resolve("work/flags", `${code.toLowerCase()}.svg`);
  const svg = await readFile(path, "utf8");
  const cleanSvg = svg
    .replace(/<\?xml[^>]*>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `data:image/svg+xml;base64,${Buffer.from(cleanSvg).toString("base64")}`;
}

function makeHtml(data) {
  const encodedData = JSON.stringify(data);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Country Flag Guessing Game</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #17212b;
      --muted: #5b6570;
      --line: #d7dde3;
      --surface: #ffffff;
      --panel: #f6f7f4;
      --accent: #0c7c59;
      --accent-dark: #085d43;
      --warn: #b43434;
      --shadow: 0 18px 42px rgba(24, 36, 46, 0.16);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      min-height: 100%;
      margin: 0;
    }

    body {
      background: linear-gradient(180deg, #f4f8f6 0%, #eef3f4 58%, #e8edf0 100%);
      color: var(--ink);
      padding: 24px;
    }

    main {
      min-height: calc(100vh - 48px);
      display: grid;
      grid-template-rows: minmax(360px, 1fr) minmax(210px, 30vh);
      gap: 18px;
      max-width: 1180px;
      margin: 0 auto;
    }

    .game-shell {
      display: grid;
      grid-template-columns: minmax(280px, 1fr) minmax(280px, 420px);
      gap: 20px;
      align-items: stretch;
    }

    .flag-stage,
    .answer-panel,
    .guessed-panel {
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(160, 174, 184, 0.46);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }

    .flag-stage {
      min-height: 360px;
      display: grid;
      place-items: center;
      padding: 28px;
      position: relative;
      overflow: hidden;
    }

    .flag-stage::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(23, 33, 43, 0.04) 1px, transparent 1px),
        linear-gradient(180deg, rgba(23, 33, 43, 0.04) 1px, transparent 1px);
      background-size: 32px 32px;
      pointer-events: none;
    }

    .flag-wrap {
      width: min(88%, 640px);
      aspect-ratio: 3 / 2;
      display: grid;
      place-items: center;
      position: relative;
      z-index: 1;
      filter: drop-shadow(0 14px 22px rgba(19, 28, 36, 0.22));
    }

    .flag-image {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      border: 1px solid rgba(23, 33, 43, 0.14);
      background: #fff;
    }

    .answer-panel {
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 18px;
      justify-content: space-between;
    }

    .topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    h1 {
      margin: 0;
      font-size: 1.55rem;
      line-height: 1.15;
      letter-spacing: 0;
    }

    .counter {
      flex: 0 0 auto;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 12px;
      color: var(--muted);
      font-weight: 700;
      font-size: 0.9rem;
      background: #fbfcfc;
    }

    form {
      display: grid;
      gap: 12px;
    }

    label {
      color: var(--muted);
      font-weight: 700;
      font-size: 0.92rem;
    }

    .input-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
    }

    input {
      min-width: 0;
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 13px 14px;
      font: inherit;
      color: var(--ink);
      background: #fff;
    }

    input:focus {
      outline: 3px solid rgba(12, 124, 89, 0.18);
      border-color: var(--accent);
    }

    button {
      border: 0;
      border-radius: 8px;
      padding: 0 16px;
      min-height: 48px;
      font: inherit;
      font-weight: 800;
      color: #fff;
      background: var(--accent);
      cursor: pointer;
    }

    button:hover {
      background: var(--accent-dark);
    }

    .secondary {
      color: var(--ink);
      background: #e8ecef;
      border: 1px solid #cbd4dc;
    }

    .secondary:hover {
      background: #dfe6ea;
    }

    .feedback {
      min-height: 44px;
      margin: 0;
      color: var(--muted);
      line-height: 1.35;
      font-weight: 650;
    }

    .feedback.good {
      color: var(--accent-dark);
    }

    .feedback.bad {
      color: var(--warn);
    }

    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .guessed-panel {
      min-height: 0;
      overflow: hidden;
      display: grid;
      grid-template-rows: auto 1fr;
    }

    .table-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--line);
      background: #fbfcfc;
    }

    h2 {
      margin: 0;
      font-size: 1rem;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .table-note {
      color: var(--muted);
      font-size: 0.9rem;
      font-weight: 700;
    }

    .table-scroll {
      min-height: 0;
      overflow: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 0.94rem;
    }

    th,
    td {
      text-align: left;
      padding: 10px 16px;
      border-bottom: 1px solid #e7ebee;
      vertical-align: middle;
      overflow-wrap: anywhere;
    }

    th {
      position: sticky;
      top: 0;
      background: #f6f7f4;
      color: var(--muted);
      z-index: 1;
      font-size: 0.82rem;
      text-transform: uppercase;
    }

    .slot-number {
      width: 56px;
      color: #8b96a0;
      font-variant-numeric: tabular-nums;
    }

    .continent-row td {
      background: #edf3f4;
      color: var(--ink);
      font-weight: 800;
      letter-spacing: 0;
      border-bottom-color: #d3dee3;
    }

    .continent-row span {
      color: var(--muted);
      font-weight: 700;
      margin-left: 10px;
      font-size: 0.9rem;
    }

    .mini-flag {
      width: 38px;
      height: 25px;
      display: inline-grid;
      place-items: center;
      vertical-align: middle;
      margin-right: 10px;
      box-shadow: 0 0 0 1px rgba(23, 33, 43, 0.12);
      background: #fff;
    }

    .mini-flag img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
    }

    .empty-row {
      color: var(--muted);
      font-style: italic;
    }

    .empty-slot td {
      height: 46px;
      background: rgba(246, 247, 244, 0.52);
    }

    .empty-slot td:not(.slot-number)::after {
      content: "";
      display: block;
      width: min(100%, 180px);
      height: 9px;
      border-radius: 999px;
      background: #e0e6ea;
    }

    @media (max-width: 820px) {
      body {
        padding: 14px;
      }

      main {
        min-height: calc(100vh - 28px);
        grid-template-rows: auto minmax(230px, 34vh);
      }

      .game-shell {
        grid-template-columns: 1fr;
      }

      .flag-stage {
        min-height: 250px;
        padding: 20px;
      }

      .answer-panel {
        padding: 18px;
      }

      h1 {
        font-size: 1.28rem;
      }

      .input-row {
        grid-template-columns: 1fr;
      }

      button {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="game-shell" aria-label="Country flag guessing game">
      <div class="flag-stage">
        <div class="flag-wrap" id="flagWrap" aria-live="polite"></div>
      </div>
      <aside class="answer-panel">
        <div class="topline">
          <h1>Country Flag Guessing Game</h1>
          <div class="counter" id="counter">0 / 196</div>
        </div>
        <form id="guessForm" autocomplete="off">
          <label for="guessInput">Type the country name</label>
          <div class="input-row">
            <input id="guessInput" name="guess" type="text" autocomplete="off" autocapitalize="words" spellcheck="false" required>
            <button type="submit">Guess</button>
          </div>
        </form>
        <p class="feedback" id="feedback">A flag is waiting. Take your shot.</p>
        <div class="actions">
          <button class="secondary" type="button" id="hintButton">Hint</button>
          <button class="secondary" type="button" id="skipButton">Skip flag</button>
          <button class="secondary" type="button" id="resetButton">Reset game</button>
        </div>
      </aside>
    </section>

    <section class="guessed-panel" aria-label="Guessed countries">
      <div class="table-head">
        <h2>Guessed Countries</h2>
        <span class="table-note" id="remaining">196 remaining</span>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th class="slot-number">#</th>
              <th style="width: 62%">Country</th>
              <th style="width: 30%">Code</th>
            </tr>
          </thead>
          <tbody id="guessedBody">
            <tr><td class="empty-row" colspan="3">Loading country slots...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <script>
    const COUNTRIES = ${encodedData};
    const TOTAL = COUNTRIES.length;
    const guessed = new Set();
    let current = null;
    let lastIndex = -1;

    const flagWrap = document.getElementById("flagWrap");
    const counter = document.getElementById("counter");
    const remaining = document.getElementById("remaining");
    const feedback = document.getElementById("feedback");
    const guessedBody = document.getElementById("guessedBody");
    const guessForm = document.getElementById("guessForm");
    const guessInput = document.getElementById("guessInput");
    const hintButton = document.getElementById("hintButton");
    const skipButton = document.getElementById("skipButton");
    const resetButton = document.getElementById("resetButton");
    const CONTINENT_ORDER = ${JSON.stringify(continentOrder)};

    function normalize(value) {
      return String(value)
        .normalize("NFD")
        .replace(/[\\u0300-\\u036f]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/\\b(st|saint)\\./g, " saint ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\\b(the|republic|state|kingdom|federal|democratic|people|peoples|islamic|commonwealth|plurinational|bolivarian|united|of|and)\\b/g, " ")
        .replace(/\\s+/g, " ")
        .trim();
    }

    function aliasesFor(country) {
      const values = [country.name, country.code, ...country.aliases];
      return new Set(values.map(normalize).filter(Boolean));
    }

    function fullNameFor(country) {
      return normalize(country.name);
    }

    function setFeedback(text, type = "") {
      feedback.textContent = text;
      feedback.className = "feedback" + (type ? " " + type : "");
    }

    function pickNext() {
      const available = COUNTRIES
        .map((country, index) => ({ country, index }))
        .filter(({ country }) => !guessed.has(country.name));

      if (!available.length) {
        current = null;
        flagWrap.innerHTML = "";
        flagWrap.setAttribute("aria-label", "All countries complete");
        guessInput.disabled = true;
        hintButton.disabled = true;
        skipButton.disabled = true;
        setFeedback("Complete. All 196 countries have been guessed.", "good");
        return;
      }

      let choice = available[Math.floor(Math.random() * available.length)];
      if (available.length > 1) {
        while (choice.index === lastIndex) {
          choice = available[Math.floor(Math.random() * available.length)];
        }
      }
      current = choice.country;
      lastIndex = choice.index;
      flagWrap.innerHTML = '<img class="flag-image" src="' + current.src + '" alt="Flag to guess">';
      flagWrap.setAttribute("aria-label", "Flag to guess");
      guessInput.disabled = false;
      hintButton.disabled = false;
      skipButton.disabled = false;
      guessInput.focus();
    }

    function compareByContinentThenName(a, b) {
      const continentDelta = CONTINENT_ORDER.indexOf(a.continent) - CONTINENT_ORDER.indexOf(b.continent);
      if (continentDelta !== 0) return continentDelta;
      return a.name.localeCompare(b.name);
    }

    function renderGuessed() {
      const guessedCountries = COUNTRIES
        .filter((country) => guessed.has(country.name))
        .sort(compareByContinentThenName);
      const continentSlots = [...COUNTRIES].sort(compareByContinentThenName);

      counter.textContent = guessedCountries.length + " / " + TOTAL;
      remaining.textContent = guessedCountries.length + " guessed, " + (TOTAL - guessedCountries.length) + " blank slots";

      let activeContinent = "";
      guessedBody.innerHTML = continentSlots
        .flatMap((country, index) => {
          const rows = [];
          if (country.continent !== activeContinent) {
            activeContinent = country.continent;
            const continentCountries = continentSlots.filter((item) => item.continent === activeContinent);
            const continentGuessed = continentCountries.filter((item) => guessed.has(item.name)).length;
            rows.push('<tr class="continent-row"><td colspan="3">' + activeContinent + '<span> - ' + continentGuessed + ' / ' + continentCountries.length + '</span></td></tr>');
          }

          if (!guessed.has(country.name)) {
            rows.push('<tr class="empty-slot"><td class="slot-number">' + (index + 1) + '</td><td aria-label="Blank country slot"></td><td aria-label="Blank code slot"></td></tr>');
            return rows;
          }

          rows.push('<tr><td class="slot-number">' + (index + 1) + '</td><td><span class="mini-flag" aria-hidden="true"><img src="' + country.src + '" alt=""></span>' + country.name + '</td><td>' + country.code + '</td></tr>');
          return rows;
        })
        .join("");
    }

    function checkGuess({ showWrong = false, fullNameOnly = false } = {}) {
      if (!current) return;

      const answer = normalize(guessInput.value);
      if (!answer) return;

      const accepted = aliasesFor(current);
      if ((fullNameOnly && answer === fullNameFor(current)) || (!fullNameOnly && accepted.has(answer))) {
        guessed.add(current.name);
        guessInput.value = "";
        renderGuessed();
        setFeedback("Correct: " + current.name + ".", "good");
        pickNext();
      } else if (showWrong) {
        setFeedback("Not quite. Try again.", "bad");
        guessInput.select();
      }
    }

    guessInput.addEventListener("input", () => {
      checkGuess({ fullNameOnly: true });
    });

    guessForm.addEventListener("submit", (event) => {
      event.preventDefault();
      checkGuess({ showWrong: true });
    });

    hintButton.addEventListener("click", () => {
      if (!current) return;
      setFeedback("Hint: " + current.continent + ". Starts with " + current.name.charAt(0) + ".");
    });

    skipButton.addEventListener("click", () => {
      setFeedback("Skipped. Here is another flag.");
      pickNext();
    });

    resetButton.addEventListener("click", () => {
      guessed.clear();
      guessInput.value = "";
      guessInput.disabled = false;
      hintButton.disabled = false;
      skipButton.disabled = false;
      renderGuessed();
      setFeedback("Game reset. Fresh flags, fresh glory.");
      pickNext();
    });

    if (TOTAL !== 196) {
      setFeedback("Dataset error: expected 196 countries, found " + TOTAL + ".", "bad");
    } else {
      renderGuessed();
      pickNext();
    }
  </script>
</body>
</html>`;
}

await mkdir(dirname(outputPath), { recursive: true });

const duplicateNames = countries
  .map(([name]) => name)
  .filter((name, index, all) => all.indexOf(name) !== index);

if (countries.length !== 196) {
  throw new Error(`Expected 196 countries, found ${countries.length}`);
}

if (duplicateNames.length) {
  throw new Error(`Duplicate country names: ${duplicateNames.join(", ")}`);
}

const missingContinents = countries
  .filter(([, code]) => !continentByCode[code])
  .map(([name, code]) => `${name} (${code})`);

if (missingContinents.length) {
  throw new Error(`Missing continents: ${missingContinents.join(", ")}`);
}

const data = await Promise.all(
  countries.map(async ([name, code, aliases]) => ({
    name,
    code,
    aliases,
    continent: continentByCode[code],
    src: await loadFlag(code),
  })),
);

await writeFile(outputPath, makeHtml(data), "utf8");
console.log(`Wrote ${outputPath} with ${data.length} countries`);
