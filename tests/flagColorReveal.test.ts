// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const WIDTH = 360;
const HEIGHT = 240;

async function setup(reducedMotion = false) {
  vi.resetModules();
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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    let source = "";
    return {
      clearRect: vi.fn(), fillRect: vi.fn(), save: vi.fn(), restore: vi.fn(), scale: vi.fn(),
      drawImage: vi.fn((image: { src?: string }) => { source = image.src ?? ""; }),
      putImageData: vi.fn(),
      createImageData: () => ({ data: new Uint8ClampedArray(WIDTH * HEIGHT * 4) }),
      getImageData: () => {
        const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
        for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
          const red = source === "red" || (source === "target" && pixel % WIDTH < WIDTH / 2);
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
    const image = images.get(src)!;
    image.naturalWidth = width;
    image.naturalHeight = height;
    image.onload();
    // Flush the image, pixel-cache, target-ready and guess continuations.
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return { view, canvas, previous, animate, cancel, load };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  await load("red");
  expect(animate).not.toHaveBeenCalled();
  await load("target");
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
