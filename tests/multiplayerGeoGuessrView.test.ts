// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicRoomState, PublicRoundState } from "../src/core/multiplayer";
import type { GeoGuessMapOptions } from "../src/ui/components/GeoGuessMap";
import type { ShellContext } from "../src/ui/shell/types";
import { createMultiplayerGeoGuessrGameView, type MultiplayerGeoGuessrGameViewState } from "../src/ui/components/MultiplayerGeoGuessrGameView";

const mocks = vi.hoisted(() => ({ createMap: vi.fn(), load: vi.fn(), sound: vi.fn() }));
vi.mock("../src/ui/components/GeoGuessMap", () => ({ createGeoGuessMap: mocks.createMap }));
vi.mock("../src/ui/components/loadStreetImage", () => ({ loadStreetImage: mocks.load }));
vi.mock("../src/ui/components/GeoGuessrFeedback", () => ({ createGeoGuessrFeedback: () => ({ reducedMotion: () => true, reset: vi.fn(), play: mocks.sound }) }));
const controllers: AbortController[] = [];
const views: ReturnType<typeof createMultiplayerGeoGuessrGameView>[] = [];
const asset = `/api/game-assets/${"a".repeat(48)}`;
const prompt = (roundNumber = 1, startedAt = 13000): PublicRoundState => ({ roundNumber, startedAt, endsAt: startedAt + 60000, prompt: { kind: "geoguessr-streetview", value: JSON.stringify({ asset }) } });
function state(round = prompt()): MultiplayerGeoGuessrGameViewState {
  const room: PublicRoomState = { roomCode: "GEO42", kind: "geoguessr", hostPlayerId: "p1", categoryIds: ["geoguessr"], settings: { roundLimit: 3, roundDurationMs: 60000 }, status: "playing", players: ["p1", "p2"].map((id, i) => ({ id, name: i ? "Guest" : "Host", connected: true, score: 0, streak: 0, correctAnswers: 0, wrongAnswers: 0 })), round, skipVotes: [], skipRequired: 2, phaseStartedAt: round.startedAt, phaseEndsAt: round.endsAt, chatMessages: [] };
  return { room, localPlayerId: "p1", round, reveal: null, finalResults: null, feedback: "", canSubmit: true };
}
function mount() {
  const controller = new AbortController(); controllers.push(controller);
  const map = { element: document.createElement("div"), setStyle: vi.fn(), reset: vi.fn(), reveal: vi.fn(), resize: vi.fn(), showResult: vi.fn(), showWorld: vi.fn(), showGuess: vi.fn(), zoomBy: vi.fn(), highlightCountry: vi.fn(), setAcceptingGuesses: vi.fn(), destroy: vi.fn() };
  let choose: GeoGuessMapOptions["onGuessChange"] = () => {};
  mocks.createMap.mockImplementation((options: GeoGuessMapOptions) => { choose = options.onGuessChange; return map; });
  const shell: ShellContext = { controls: document.createElement("div"), storage: localStorage, signedIn: () => false, confirmLeave: async () => true, openSection() {}, goHome() {}, goBack() {}, openGame() {}, openGamePicker() {}, openCountry() {}, openLeaderboards() {}, openAccount() {} };
  const onGuess = vi.fn(), onSkip = vi.fn();
  const view = createMultiplayerGeoGuessrGameView({ signal: controller.signal, shell, onLeave() {}, leaveGuard: () => null, storage: localStorage, onGuess, onSkip });
  views.push(view); document.body.append(view.element);
  const click = (selector: string) => view.element.querySelector<HTMLButtonElement>(selector)!.click();
  return { view, map, onGuess, onSkip, choose: (lat = 40, lng = 12) => choose({ lat, lng }), click, controller };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(10000); mocks.load.mockResolvedValue(undefined); });
afterEach(() => { views.splice(0).forEach(view => view.destroy()); controllers.splice(0).forEach(controller => controller.abort()); document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("multiplayer GeoGuessr shared play surface", () => {
  it("waits for decoded private imagery and the shared countdown, then locks one server guess", async () => {
    let ready!: () => void;
    mocks.load.mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
    const ui = mount(); const current = state(); ui.view.update(current);
    expect(mocks.load).toHaveBeenCalledWith(expect.any(HTMLImageElement), `${asset}?turn=0`, expect.any(AbortSignal));
    expect(ui.view.element.dataset.phase).toBe("loading");
    expect(ui.view.element.querySelectorAll(".geo-journey-route li")).toHaveLength(3);
    ui.choose(); ui.click(".geo-lock"); expect(ui.onGuess).not.toHaveBeenCalled();
    ready(); await flush(); expect(ui.view.element.dataset.phase).toBe("loading");
    expect(mocks.sound).toHaveBeenCalledWith("countdown", 3);
    vi.mocked(Date.now).mockReturnValue(13001); ui.view.update(current);
    expect(ui.view.element.dataset.phase).toBe("playing");
    ui.choose(); ui.click(".geo-lock"); ui.click(".geo-lock");
    expect(ui.onGuess).toHaveBeenCalledExactlyOnceWith(40, 12);
    expect(ui.view.element.querySelector(".geo-mp-status")?.textContent).toContain("Guess locked");
    expect(ui.view.element.querySelector(".geo-selected-map")).toBeNull();
    expect(ui.map.setAcceptingGuesses).toHaveBeenLastCalledWith(false);
    expect(mocks.createMap).toHaveBeenCalledOnce();
  });
  it("reveals every player against the server target, hides the left controls and restores map layers next round", async () => {
    vi.mocked(Date.now).mockReturnValue(13001);
    const ui = mount(); const current = state(); ui.view.update(current); await flush();
    ui.click('[data-style="terrain"]');
    const revealed = { ...current, canSubmit: false, room: { ...current.room, status: "round-result" as const }, reveal: { countryName: "Italy", targetLat: 41, targetLng: 12, results: [{ playerId: "p1", name: "Host", guess: { lat: 40, lng: 12 }, distanceKm: 111, score: 4730 }, { playerId: "p2", name: "Guest", guess: { lat: 35, lng: 10 }, distanceKm: 700, score: 3500 }] } };
    ui.view.update(revealed);
    expect(ui.view.element.dataset.phase).toBe("result");
    expect(ui.map.reveal).toHaveBeenCalledWith({ lat: 41, lng: 12 }, [expect.objectContaining({ lat: 40, lng: 12, label: "Your pin" }), expect.objectContaining({ lat: 35, lng: 10, label: "Guest" })]);
    expect(ui.map.highlightCountry).toHaveBeenCalledWith("IT");
    expect(ui.view.element.querySelectorAll(".geo-mp-round-results li")).toHaveLength(2);
    for (const selector of [".geo-map-header", ".geo-map-toolbar"]) expect(ui.view.element.querySelector<HTMLElement>(selector)!.hidden).toBe(true);
    expect(ui.view.element.querySelector<HTMLElement>(".geo-map-tools")!.hidden).toBe(false);
    ui.view.update(state(prompt(2, 13000))); await flush();
    expect(ui.view.element.querySelector<HTMLElement>(".geo-map-toolbar")!.hidden).toBe(false);
    expect(ui.view.element.querySelector('[data-style="terrain"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(ui.map.setStyle).toHaveBeenLastCalledWith("terrain");
    expect(mocks.createMap).toHaveBeenCalledOnce();
  });
  it("ignores a superseded decode and cannot unlock a spectator or an ended round", async () => {
    const pending: (() => void)[] = [];
    mocks.load.mockImplementation(() => new Promise<void>(resolve => pending.push(resolve)));
    vi.mocked(Date.now).mockReturnValue(13001);
    const ui = mount(); ui.view.update(state()); ui.view.update(state(prompt(2, 13000)));
    pending[0]!(); await flush(); expect(ui.view.element.dataset.phase).toBe("loading");
    pending[1]!(); await flush();
    ui.view.update({ ...state(prompt(2, 13000)), canSubmit: false }); ui.choose(); ui.click(".geo-lock"); ui.click(".geo-mp-skip");
    expect(ui.onGuess).not.toHaveBeenCalled(); expect(ui.onSkip).not.toHaveBeenCalled();
    vi.mocked(Date.now).mockReturnValue(80000); ui.view.update(state(prompt(2, 13000))); ui.choose(); ui.click(".geo-lock");
    expect(ui.onGuess).not.toHaveBeenCalled();
  });
  it("keeps the final map, uses a quiet result slot and cleans up on leaving", async () => {
    vi.mocked(Date.now).mockReturnValue(13001);
    const ui = mount(); const current = state(); ui.view.update(current); await flush();
    const reveal = { countryName: "Italy", targetLat: 41, targetLng: 12, results: [{ playerId: "p1", name: "Host", guess: { lat: 40, lng: 12 }, distanceKm: 111, score: 4730 }] };
    ui.view.update({ ...current, reveal, canSubmit: false });
    const resetCount = ui.map.reset.mock.calls.length;
    ui.view.update({ ...current, room: { ...current.room, status: "complete", round: null }, round: null, reveal, finalResults: [], canSubmit: false });
    expect(ui.view.element.dataset.phase).toBe("complete"); expect(ui.view.finalSlot.hidden).toBe(false);
    expect(ui.map.reset).toHaveBeenCalledTimes(resetCount);
    expect(ui.map.setStyle).toHaveBeenLastCalledWith("roadmap");
    for (const selector of [".geo-map-header", ".geo-map-toolbar", ".geo-map-tools", ".geo-session", ".geo-mp-scoreboard"]) expect(ui.view.element.querySelector<HTMLElement>(selector)!.hidden).toBe(true);
    ui.controller.abort(); ui.view.destroy(); expect(ui.map.destroy).toHaveBeenCalledOnce();
  });
});
