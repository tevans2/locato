// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { indexCountries } from "../src/core/countries";
import type { MultiplayerGameViewState } from "../src/ui/screens/MultiplayerGameScreen";

async function setup(reducedMotion = false, pixelRatio = 1) {
  vi.resetModules();
  vi.stubGlobal("devicePixelRatio", pixelRatio);
  const masks: { width: number; height: number; data: Uint8ClampedArray }[] = [];
  const images = new Map<string, { onload: () => void; naturalWidth: number; naturalHeight: number; src: string }>();
  vi.stubGlobal("Image", class {
    onload = () => {};
    naturalWidth = 900;
    naturalHeight = 600;
    private source = "";
    get src() { return this.source; }
    set src(value: string) { this.source = value; images.set(value, this); }
  });
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: reducedMotion } as MediaQueryList);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    const canvas = this;
    let source = "";
    return {
      clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(), scale: vi.fn(),
      drawImage: vi.fn((image: { src?: string }) => { source = image.src ?? ""; }),
      putImageData: vi.fn((mask) => { masks.push(mask); }),
      createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      getImageData: () => {
        const { width, height } = canvas;
        const data = new Uint8ClampedArray(width * height * 4);
        for (let pixel = 0; pixel < width * height; pixel++) {
          const red = source === "red" || (source === "target" && pixel % width < width / 2) || (source === "fine-detail" && pixel !== width + 1);
          data[pixel * 4 + (red ? 0 : 2)] = 255;
          data[pixel * 4 + 3] = 255;
        }
        return { data };
      },
    } as unknown as CanvasRenderingContext2D;
  });
  const { createFlagColorRevealView } = await import("../src/ui/dom/renderFlagColorReveal");
  const view = createFlagColorRevealView();
  const canvas = view.element.querySelector<HTMLCanvasElement>("canvas")!;
  const previous = view.element.querySelector<HTMLCanvasElement>(".flag-color-reveal-transition")!;
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }) as unknown as Animation);
  previous.animate = animate;
  const load = async (src: string, width = 900, height = 600) => {
    for (let i = 0; i < 10 && !images.has(src); i++) await Promise.resolve();
    const image = images.get(src)!;
    image.naturalWidth = width;
    image.naturalHeight = height;
    image.onload();
    // Flush the image, pixel-cache, target-ready and guess continuations.
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { view, canvas, previous, animate, cancel, load, masks };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/ui/dom/renderWorldMap");
  document.body.replaceChildren();
});

it("uses the ordinary flag styling and the target's natural dimensions", async () => {
  const { view, canvas, previous, load } = await setup();
  expect(canvas.classList.contains("flag-image")).toBe(true);
  expect(canvas.width).toBe(900);
  view.reset("target");
  await load("target", 1200, 600);
  expect([canvas.width, canvas.height]).toEqual([1200, 600]);
  expect([previous.width, previous.height]).toEqual([1200, 600]);
});

it("waits for the target to load and accumulates matching areas without replaying duplicate reveals", async () => {
  const { view, load, animate } = await setup();
  view.reset("target");
  view.addGuess("red");
  expect(animate).not.toHaveBeenCalled();
  await load("target");
  await load("red");
  expect(view.element.textContent).toContain("50%");
  expect(animate).toHaveBeenCalledOnce();
  view.addGuess("red");
  await load("red");
  expect(animate).toHaveBeenCalledOnce();
  view.addGuess("blue");
  await load("blue");
  expect(view.element.textContent).toContain("100%");
  expect(animate).toHaveBeenCalledTimes(2);
});

it("cancels the previous reveal on reset and discards guesses belonging to an old round", async () => {
  const { view, load, animate, cancel } = await setup();
  view.reset("target");
  await load("target");
  view.addGuess("red");
  await load("red");
  view.addGuess("blue");
  // Allow the old round's guess to begin loading before switching targets.
  await Promise.resolve();
  view.reset("next-target");
  await load("next-target");
  await load("blue");
  expect(cancel).toHaveBeenCalled();
  expect(animate).toHaveBeenCalledOnce();
  expect(view.element.textContent).toContain("Guess flags");
});

it("reveals colours immediately when reduced motion is requested", async () => {
  const { view, load, animate } = await setup(true);
  view.reset("target");
  await load("target");
  view.addGuess("red");
  await load("red");
  expect(view.element.textContent).toContain("50%");
  expect(animate).not.toHaveBeenCalled();
});

it("preserves pixel-sized details in a full-resolution Retina mask instead of enlarging a thumbnail", async () => {
  const { view, canvas, previous, load, masks } = await setup(false, 2);
  view.reset("fine-detail");
  await load("fine-detail", 900, 780);
  expect([canvas.width, canvas.height]).toEqual([1800, 1560]);
  expect([previous.width, previous.height]).toEqual([1800, 1560]);
  expect(view.element.style.getPropertyValue("--flag-natural-width")).toBe("900px");
  expect(view.element.style.getPropertyValue("--flag-natural-height")).toBe("780px");
  view.addGuess("red");
  await Promise.resolve();
  await load("red");
  const mask = masks.at(-1)!;
  expect([mask.width, mask.height]).toEqual([1800, 1560]);
  const detail = (1800 + 1) * 4 + 3;
  expect(mask.data[detail]).toBe(0);
  expect(mask.data[detail - 4]).toBe(255);
  expect(mask.data[detail + 4]).toBe(255);
});

it("uses the same full-detail reveal in multiplayer, retaining it through room updates and resetting each round", async () => {
  const { load, masks } = await setup(false, 2);
  vi.doMock("../src/ui/dom/renderWorldMap", () => ({
    createWorldMapView: () => ({ element: document.createElement("div") }),
    setWorldMapTargetCountry: vi.fn(),
  }));
  const { createMultiplayerGameView } = await import("../src/ui/screens/MultiplayerGameScreen");
  const countryIndex = indexCountries([
    { name: "Belgium", code: "BE", aliases: [], continent: "Europe", flagSrc: "fine-detail", capital: "Brussels", capitalAliases: [] },
    { name: "Japan", code: "JP", aliases: [], continent: "Asia", flagSrc: "red", capital: "Tokyo", capitalAliases: [] },
  ]);
  const onSubmit = vi.fn();
  const multiplayer = createMultiplayerGameView({ countryIndex, worldCountryFeatures: [], onSubmit, onSkip: vi.fn() });
  document.body.append(multiplayer.element);
  const round = { roundNumber: 1, startedAt: 1000, endsAt: null, prompt: { kind: "flag-colors", value: "fine-detail" } } as const;
  const state: MultiplayerGameViewState = {
    room: {
      roomCode: "FLAGS", hostPlayerId: "one", categoryIds: ["flag-colors"],
      settings: { roundLimit: 10, roundDurationMs: 30000 }, status: "playing",
      players: [], round, skipVotes: [], skipRequired: 0,
      phaseStartedAt: null, phaseEndsAt: null, chatMessages: [],
    },
    localPlayerId: "one", round, roundResult: null, finalResults: null,
    feedback: "", canSubmit: true,
  };
  try {
    multiplayer.update(state);
    await load("fine-detail", 900, 780);
    const canvas = multiplayer.element.querySelector<HTMLCanvasElement>("canvas")!;
    expect([canvas.width, canvas.height]).toEqual([1800, 1560]);
    const previous = multiplayer.element.querySelector<HTMLCanvasElement>(".flag-color-reveal-transition")!;
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    previous.animate = animate;
    multiplayer.answerInput.value = "Japan";
    multiplayer.element.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await load("red");
    expect(onSubmit).toHaveBeenCalledWith("Japan");
    expect(animate).toHaveBeenCalledOnce();
    const mask = masks.at(-1)!;
    expect([mask.width, mask.height]).toEqual([1800, 1560]);
    const detail = (1800 + 1) * 4 + 3;
    expect(mask.data[detail]).toBe(0);
    expect(mask.data[detail + 4]).toBe(255);

    multiplayer.update({ ...state, feedback: "Try another flag" });
    expect(multiplayer.element.querySelector("canvas")).toBe(canvas);
    expect(animate).toHaveBeenCalledOnce();
    expect(multiplayer.element.querySelector(".flag-color-reveal-meta")?.textContent).toContain("100%");

    const nextRound = { ...round, roundNumber: 2, startedAt: 2000 };
    multiplayer.update({ ...state, round: nextRound, room: { ...state.room, round: nextRound } });
    await load("fine-detail", 900, 780);
    expect(multiplayer.element.querySelector(".flag-color-reveal-meta")?.textContent).toContain("Guess flags");
    expect(masks.at(-1)!.data[detail + 4]).toBe(0);
  } finally {
    multiplayer.destroy();
  }
});
