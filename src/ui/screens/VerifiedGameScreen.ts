import type { Screen } from "../../app/router";
import type { GameModeId } from "../../core/gameModes";
import { gameModeCatalogueEntry } from "../../core/gameModes";
import { leaderboardConfig, PUZZLE_CONTINENT_VARIANTS } from "../../core/leaderboards";
import { rankedRequest, type RankedAction, type RankedQuestion, type RankedState } from "../../core/ranked";
import { buildFlyoverCountries, type PlaneInput } from "../../core/flyover";
import { projectWorldMapPosition, type ProjectedPoint, type WorldCountryFeature } from "../../core/map";
import { createFlyoverFlight, type FlyoverFlight } from "../components/FlyoverFlight";
import { createMapTapGlobe, type MapTapGlobe } from "../components/MapTapGlobe";
import { createGameBar } from "../shell/GameBar";
import { createResultsCard } from "../shell/ResultsCard";
import { markShellScreen, type ShellContext } from "../shell/types";
import { el } from "../dom/createElement";
import "../../styles/verified-games.css";

interface Options {
  readonly mode: GameModeId | "daily";
  readonly variant?: string;
  readonly shell: ShellContext;
  readonly world: readonly WorldCountryFeature[];
}
const SVG_NS = "http://www.w3.org/2000/svg";
function path(rings: readonly (readonly ProjectedPoint[])[]): string {
  return rings.map((ring) => ring.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ") + "Z").join(" ");
}
function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/** Ranked play renders one server challenge and submits moves. It never chooses or scores a challenge. */
export function createVerifiedGameScreen(options: Options): Screen {
  const controller = new AbortController();
  const { signal } = controller;
  const mode = options.mode;
  const mapCountries = buildFlyoverCountries(options.world);
  const config = leaderboardConfig(mode);
  const label = mode === "daily" ? "Daily challenge" : gameModeCatalogueEntry(mode).label;
  const root = el("section", { className: mode === "flyover" ? "verified-game flyover-screen" : "verified-game" });
  markShellScreen(root, "game");
  const bar = createGameBar(options.shell, { gameMode: mode === "daily" ? "flags" : mode, run: "timed", onBack: () => options.shell.goBack("play"), backLabel: "Back" });
  root.append(bar.element);
  const clock = el("span", { className: "verified-clock", text: "0:00" });
  bar.setClock(clock);
  const progress = el("p", { className: "verified-progress", text: label });
  const content = el("div", { className: "verified-content" });
  const feedback = el("p", { className: "verified-feedback", attrs: { role: "status", "aria-live": "polite" } });
  root.append(progress, content, feedback);
  let state: RankedState | null = null;
  let variant = options.variant ?? (mode === "puzzle" ? "Europe" : "");
  let busy = false;
  let finished = false;
  let renderedId = "";
  let field: HTMLInputElement | null = null;
  let image: HTMLImageElement | null = null;
  let flight: FlyoverFlight | null = null;
  let globe: MapTapGlobe | null = null;
  let chosenPin: { lat: number; lng: number } | null = null;
  let latestInput: PlaneInput = { turn: 0, boost: false };
  let clockOffset = 0;
  let poll: ReturnType<typeof setInterval> | undefined;
  let submission: { gameMode: string; variant: string; runId: string; timeMs?: number; score?: number } | null = null;

  const clockTimer = setInterval(() => {
    if (!state) return;
    const elapsed = (state.timeMs ?? (state.startedAt === null ? 0 : performance.now() + clockOffset - state.startedAt)) / 1000;
    clock.textContent = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}`;
  }, 100);

  function stopViews(): void {
    flight?.destroy(); flight = null;
    globe?.destroy(); globe = null;
  }
  function button(text: string, onClick: () => void, className = "shell-btn shell-btn-primary"): HTMLButtonElement {
    if (className === "secondary-button") className = "shell-btn shell-btn-quiet";
    const node = el("button", { className, text, attrs: { type: "button" } }) as HTMLButtonElement;
    node.addEventListener("click", onClick, { signal });
    return node;
  }
  function ready(): void {
    stopViews();
    content.replaceChildren(el("h1", { text: label }), el("p", { text: mode === "flyover" ? "Fly over the named countries in 90 seconds. Use the arrows or hold the map to steer." : "Play a complete run to post your best result." }));
    if (mode === "puzzle" || mode === "flags") {
      const choices = mode === "puzzle" ? PUZZLE_CONTINENT_VARIANTS : ["", "territories", "both"];
      const select = document.createElement("select");
      select.setAttribute("aria-label", mode === "puzzle" ? "Continent" : "Flag set");
      for (const choice of choices) {
        const option = document.createElement("option"); option.value = choice; option.textContent = choice === "" ? "Countries" : choice; select.add(option);
      }
      select.value = variant;
      select.addEventListener("change", () => { variant = select.value; }, { signal });
      content.append(select);
    }
    content.append(button(mode === "flyover" ? "Take off" : "Start", () => void start()));
  }
  async function start(): Promise<void> {
    if (busy) return;
    busy = true; feedback.textContent = "Preparing your game…";
    try {
      const next = await rankedRequest<RankedState>("/api/ranked/start", { gameMode: mode, variant }, signal);
      if (signal.aborted) return;
      state = next; clockOffset = next.serverNow - performance.now(); finished = false; submission = null;
      renderedId = ""; feedback.textContent = ""; render();
      clearInterval(poll);
      if (mode === "flyover") poll = setInterval(() => { void move({ type: "input", input: latestInput }); }, 150);
    } catch (error) { if (!signal.aborted) feedback.textContent = String((error as Error).message); }
    finally { busy = false; }
  }
  async function move(action: Omit<RankedAction, "runId" | "questionId">): Promise<void> {
    if (!state || busy || finished || signal.aborted) return;
    busy = true;
    try {
      const next = await rankedRequest<RankedState>("/api/ranked/action", { ...action, runId: state.runId, questionId: state.question?.id }, signal);
      if (signal.aborted) return;
      state = next; clockOffset = next.serverNow - performance.now();
      render();
    } catch (error) { if (!signal.aborted) feedback.textContent = String((error as Error).message); }
    finally { busy = false; }
  }
  function render(): void {
    if (!state) return;
    progress.textContent = `${label} · ${mode === "flyover" ? state.score : state.index} / ${state.total}`;
    feedback.textContent = state.feedback ?? "";
    if (state.status === "complete") { void finish(); return; }
    const question = state.question;
    if (!question) return;
    if (question.kind === "flight") {
      if (!flight) renderFlight(question);
      const country = mapCountries.find((c) => c.name === question.text) ?? null;
      if (flight?.target()?.name !== question.text) flight?.setTarget(country);
      if (state.plane) flight?.setPlane(state.plane);
      if (state.endsAt) flight?.setEndsAt(state.endsAt);
      const score = content.querySelector(".flyover-score-value");
      if (score) score.textContent = String(state.score);
      return;
    }
    if (renderedId === question.id) {
      if (image && question.asset && image.getAttribute("src") !== question.asset) image.src = question.asset;
      if (field) { field.value = ""; field.focus(); }
      return;
    }
    renderedId = question.id;
    stopViews(); field = null; image = null; chosenPin = null;
    content.replaceChildren(el("h1", { text: question.text }));
    if (question.asset) {
      image = el("img", { className: "verified-prompt-image", attrs: { src: question.asset, alt: "Country clue" } }) as HTMLImageElement;
      content.append(image);
    }
    if (question.kind === "flag-colors") content.append(el("p", { text: "Guess flags to reveal matching colours in matching positions." }));
    if (["click", "spot", "puzzle", "split", "name-all"].includes(question.kind)) renderMap(question);
    if (question.frames?.length) renderStreet(question);
    if (question.kind === "pin") {
      globe = createMapTapGlobe({ signal, onGuess: (point) => { chosenPin = point; feedback.textContent = "Pin selected. Submit when ready."; } });
      content.append(globe.element, button("Submit pin", () => {
        if (chosenPin) void move({ type: "pin", ...chosenPin });
        else feedback.textContent = "Select a position on the globe first.";
      }));
    } else if (["text", "image", "flag-colors", "name-all", "spot", "street"].includes(question.kind)) renderAnswer();
    if (question.kind === "street") content.append(button("Skip country", () => void move({ type: "skip" }), "secondary-button"));
  }
  function renderAnswer(): void {
    const form = document.createElement("form");
    field = el("input", { attrs: { type: "text", placeholder: mode === "capital-recall" ? "Capital name" : "Country name", "aria-label": "Your answer", autocomplete: "off", maxlength: "200" } }) as HTMLInputElement;
    const submit = button("Submit", () => { if (field?.value.trim()) void move({ type: "answer", answer: field.value.trim() }); });
    form.append(field, submit);
    form.addEventListener("submit", (event) => { event.preventDefault(); if (field?.value.trim()) void move({ type: "answer", answer: field.value.trim() }); }, { signal });
    content.append(form);
    requestAnimationFrame(() => field?.focus());
  }
  function renderStreet(question: RankedQuestion): void {
    const view = el("img", { className: "verified-street-image", attrs: { alt: "Mystery Street View" } }) as HTMLImageElement;
    content.append(view);
    const frames = question.frames!;
    let selected = 0;
    let turn = 0;
    const show = (index: number) => {
      selected = index;
      const frame = frames[index];
      if (frame) view.src = `${frame.asset}&turn=${turn}`;
    };
    view.addEventListener("error", () => { feedback.textContent = "Street View could not load. Please check your connection."; }, { signal });
    show(0);
    const looking = el("div", { className: "verified-frame-buttons" });
    looking.append(button("Look left", () => { turn = (turn + 270) % 360; show(selected); }, "secondary-button"), button("Look right", () => { turn = (turn + 90) % 360; show(selected); }, "secondary-button"));
    content.append(looking);
    if (frames.length > 1) {
      const choices = el("div", { className: "verified-frame-buttons" });
      frames.forEach((_, i) => choices.append(button(`Frame ${i + 1}`, () => show(i), "secondary-button")));
      content.append(choices);
    }
  }
  function renderMap(question: RankedQuestion): void {
    const svg = svgElement("svg", { viewBox: "0 0 1000 500", class: "verified-map", role: "img", "aria-label": "World map" });
    const backdrop = svgElement("g", {});
    for (const feature of options.world) {
      const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      backdrop.append(svgElement("path", { d: path(polygons.flatMap((p) => p.map((r) => r.map(projectWorldMapPosition)))), "fill-rule": "evenodd" }));
    }
    svg.append(backdrop);
    if (question.kind === "click") {
      for (const country of mapCountries.filter((c) => c.area < 3)) backdrop.append(svgElement("circle", { cx: String(country.centre[0]), cy: String(country.centre[1]), r: "2", fill: "#829080" }));
    }
    // Wheel zoom stays centred on the pointed location; explicit controls work on touch screens.
    let scale = 1, centre: ProjectedPoint = [500, 250];
    const zoom = (factor: number, at = centre) => {
      scale = Math.max(1, Math.min(16, scale * factor));
      const width = 1000 / scale, height = 500 / scale;
      centre = [Math.max(width / 2, Math.min(1000 - width / 2, at[0])), Math.max(height / 2, Math.min(500 - height / 2, at[1]))];
      svg.setAttribute("viewBox", `${centre[0] - width / 2} ${centre[1] - height / 2} ${width} ${height}`);
    };
    if (question.kind !== "split") {
      svg.addEventListener("wheel", (event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.5 : 1 / 1.5, point(event)); }, { signal, passive: false });
      const controls = el("div", { className: "verified-frame-buttons" });
      controls.append(button("Zoom in", () => zoom(2), "secondary-button"), button("Zoom out", () => zoom(.5), "secondary-button"), button("←", () => zoom(1, [centre[0] - 200 / scale, centre[1]]), "secondary-button"), button("→", () => zoom(1, [centre[0] + 200 / scale, centre[1]]), "secondary-button"), button("↑", () => zoom(1, [centre[0], centre[1] - 100 / scale]), "secondary-button"), button("↓", () => zoom(1, [centre[0], centre[1] + 100 / scale]), "secondary-button"));
      content.append(controls);
    }
    if (question.paths) {
      const highlight = svgElement("path", { d: path(question.paths), class: "verified-map-target", "fill-rule": "evenodd" });
      svg.append(highlight);
      if (question.kind === "puzzle") {
        highlight.setAttribute("transform", "translate(500 450)");
        highlight.style.cursor = "grab";
      }
    }
    let lineStart: ProjectedPoint | null = null;
    let lineEnd: ProjectedPoint | null = null;
    let drag = false;
    const line = svgElement("line", { class: "verified-split-line" });
    if (question.kind === "split") svg.append(line);
    function point(event: MouseEvent): ProjectedPoint {
      const matrix = svg.getScreenCTM();
      if (matrix && typeof DOMPoint !== "undefined") {
        const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        return [Math.max(0, Math.min(1000, p.x)), Math.max(0, Math.min(500, p.y))];
      }
      const rect = svg.getBoundingClientRect();
      return [(event.clientX - rect.left) / rect.width * 1000, (event.clientY - rect.top) / rect.height * 500];
    }
    svg.addEventListener("pointerdown", (event) => {
      if (question.kind === "puzzle") { drag = true; svg.setPointerCapture(event.pointerId); }
      else if (question.kind === "split") {
        lineStart = point(event); lineEnd = lineStart; drag = true; svg.setPointerCapture(event.pointerId);
      }
    }, { signal });
    svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const p = point(event);
      if (question.kind === "puzzle") svg.querySelector(".verified-map-target")?.setAttribute("transform", `translate(${p[0]} ${p[1]})`);
      if (question.kind === "split" && lineStart) {
        lineEnd = p;
        for (const [key, value] of Object.entries({ x1: lineStart[0], y1: lineStart[1], x2: p[0], y2: p[1] })) line.setAttribute(key, String(value));
      }
    }, { signal });
    svg.addEventListener("pointerup", (event) => {
      const [x, y] = point(event);
      if (question.kind === "click" || (question.kind === "puzzle" && drag)) void move({ type: "place", x, y });
      drag = false;
    }, { signal });
    content.append(svg);
    if (question.kind === "split") content.append(button("Check split", () => {
      if (lineStart && lineEnd) void move({ type: "line", line: [lineStart, lineEnd] });
      else feedback.textContent = "Draw a line on the map first.";
    }));
  }
  function renderFlight(question: RankedQuestion): void {
    const countries = mapCountries;
    const score = el("strong", { className: "flyover-score-value", text: "0" });
    flight = createFlyoverFlight({ countries, hudRight: score, overlay: el("div"), skipLabel: "Skip · −5s", flightSeconds: 90,
      now: () => performance.now() + clockOffset, requestFrame: (cb) => requestAnimationFrame(cb), cancelFrame: (id) => cancelAnimationFrame(id), signal,
      authoritative: true, onReach: () => {}, onSkip: () => void move({ type: "skip" }), onTimeUp: () => void move({ type: "poll" }), onInput: (input) => { latestInput = input; } });
    content.replaceChildren(flight.element);
    flight.reset(state!.plane!);
    flight.setTarget(countries.find((c) => c.name === question.text) ?? null);
    flight.fly(state!.endsAt!);
    requestAnimationFrame(() => flight?.mount());
  }
  async function finish(): Promise<void> {
    if (!state || finished) return;
    finished = true; clearInterval(poll); stopViews();
    const value = config?.metric === "time" ? state.timeMs! : state.score;
    submission = { gameMode: mode, variant, runId: state.runId, ...(config?.metric === "time" ? { timeMs: value } : { score: value }) };
    const card = createResultsCard(options.shell, {
      kicker: label, title: "Run complete", subtitle: "Posting your result…",
      stats: [{ label: config?.metric === "time" ? "Time" : "Score", value: config?.metric === "time" ? `${(value / 1000).toFixed(1)}s` : String(value) }],
      primary: { label: mode === "daily" ? "View daily result" : "Play again", onClick: () => { if (mode === "daily") options.shell.openSection("daily"); else { state = null; renderedId = ""; finished = false; ready(); } } },
      secondary: mode === "daily" ? [] : [{ label: "View leaderboard", onClick: () => options.shell.openLeaderboards(mode, variant) }],
    });
    content.replaceChildren(card.element);
    await postResult(card, submission);
  }
  async function postResult(card: ReturnType<typeof createResultsCard>, receipt: NonNullable<typeof submission>): Promise<void> {
    const setSubtitle = (text: string) => { const node = card.element.querySelector(".shell-results-sub"); if (node) node.textContent = text; };
    try {
      const result = await rankedRequest<{ rank?: number; accepted?: boolean }>(mode === "daily" ? "/api/daily" : "/api/leaderboard", mode === "daily" ? { runId: receipt.runId } : receipt, signal);
      if (!signal.aborted) setSubtitle(mode === "daily" ? "Saved to your daily leaderboard." : result.accepted === false ? `Your previous best stands${result.rank ? ` — #${result.rank}` : ""}.` : `Posted to the leaderboard${result.rank ? ` — #${result.rank}` : ""}.`);
    } catch (error) {
      if (signal.aborted) return;
      setSubtitle(String((error as Error).message));
      const retry = button("Retry posting", () => { retry.remove(); void postResult(card, receipt); }, "secondary-button");
      card.element.append(retry);
    }
  }
  ready();
  return { element: root, destroy: () => { controller.abort(); clearInterval(poll); clearInterval(clockTimer); stopViews(); bar.destroy(); } };
}
