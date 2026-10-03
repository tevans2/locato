import { el } from "./createElement";

// Compare at a modest resolution; display the original image at its full size.
const WIDTH = 360;
const HEIGHT = 240;
const DISPLAY_WIDTH = 900;
const DISPLAY_HEIGHT = 600;
const MATCH_DISTANCE = 82;
const MIN_ALPHA = 24;

export interface FlagColorRevealView {
  readonly element: HTMLElement;
  readonly reset: (targetSrc: string) => void;
  readonly addGuess: (flagSrc: string) => void;
}

type FlagPixels = {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly image: HTMLImageElement;
};

const pixelCache = new Map<string, Promise<FlagPixels | null>>();

function colorDistance(target: Uint8ClampedArray, guess: Uint8ClampedArray, offset: number): number {
  const dr = channel(target, offset) - channel(guess, offset);
  const dg = channel(target, offset + 1) - channel(guess, offset + 1);
  const db = channel(target, offset + 2) - channel(guess, offset + 2);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function channel(data: Uint8ClampedArray, offset: number): number {
  return data[offset] ?? 0;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function loadFlagPixels(src: string): Promise<FlagPixels | null> {
  const cached = pixelCache.get(src);
  if (cached) return cached;

  const promise = loadImage(src).then((image) => {
    if (!image) return null;
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(image, 0, 0, WIDTH, HEIGHT);
    return { data: ctx.getImageData(0, 0, WIDTH, HEIGHT).data, width: image.naturalWidth, height: image.naturalHeight, image };
  });

  pixelCache.set(src, promise);
  return promise;
}

export function createFlagColorRevealView(): FlagColorRevealView {
  const canvas = el("canvas", { className: "flag-image flag-color-reveal-canvas", attrs: { width: String(DISPLAY_WIDTH), height: String(DISPLAY_HEIGHT), role: "img", "aria-label": "Hidden target flag" } }) as HTMLCanvasElement;
  const previous = el("canvas", { className: "flag-image flag-color-reveal-canvas flag-color-reveal-transition", attrs: { width: String(DISPLAY_WIDTH), height: String(DISPLAY_HEIGHT), "aria-hidden": "true" } }) as HTMLCanvasElement;
  const meta = el("p", { className: "flag-color-reveal-meta", text: "Guess flags to reveal matching colours in matching positions." });
  const element = el("div", { className: "flag-color-reveal", children: [canvas, previous, meta] });
  const ctx = canvas.getContext("2d");
  const previousCtx = previous.getContext("2d");
  const buffer = document.createElement("canvas");
  buffer.width = WIDTH;
  buffer.height = HEIGHT;
  const bufferCtx = buffer.getContext("2d", { willReadFrequently: true });
  const flagLayer = document.createElement("canvas");
  const flagLayerCtx = flagLayer.getContext("2d");
  const revealed = new Uint8Array(WIDTH * HEIGHT);
  let targetSrc = "";
  let targetPixels: FlagPixels | null = null;
  let renderToken = 0;
  let transition: Animation | null = null;
  let targetReady: Promise<void> = Promise.resolve();

  function render(animate = false): void {
    if (!ctx || !bufferCtx || !flagLayerCtx) return;
    transition?.cancel();
    transition = null;
    if (animate && previousCtx) {
      previousCtx.clearRect(0, 0, previous.width, previous.height);
      previousCtx.drawImage(canvas, 0, 0);
    }
    const mask = bufferCtx.createImageData(WIDTH, HEIGHT);
    let revealedCount = 0;
    for (let pixel = 0; pixel < revealed.length; pixel += 1) {
      if (revealed[pixel] !== 1 || !targetPixels) continue;
      const offset = pixel * 4;
      mask.data[offset + 3] = 255;
      revealedCount += 1;
    }
    bufferCtx.putImageData(mask, 0, 0);
    // Unrevealed areas stay transparent over the theme-aware CSS background.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (targetPixels && revealedCount > 0) {
      flagLayerCtx.clearRect(0, 0, flagLayer.width, flagLayer.height);
      flagLayerCtx.drawImage(targetPixels.image, 0, 0, flagLayer.width, flagLayer.height);
      flagLayerCtx.globalCompositeOperation = "destination-in";
      flagLayerCtx.drawImage(buffer, 0, 0, flagLayer.width, flagLayer.height);
      flagLayerCtx.globalCompositeOperation = "source-over";
      ctx.drawImage(flagLayer, 0, 0);
    }
    if (animate && previousCtx && typeof previous.animate === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      transition = previous.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-out" });
    }
    const percent = Math.round((revealedCount / revealed.length) * 100);
    meta.textContent = revealedCount === 0 ? "Guess flags to reveal matching colours in matching positions." : `${percent}% of the target flag revealed`;
  }

  render();

  return {
    element,
    reset(nextTargetSrc: string): void {
      targetSrc = nextTargetSrc;
      targetPixels = null;
      revealed.fill(0);
      const token = ++renderToken;
      render();
      targetReady = loadFlagPixels(nextTargetSrc).then((pixels) => {
        if (token !== renderToken || targetSrc !== nextTargetSrc) return;
        targetPixels = pixels;
        if (pixels) {
          // Match the normal flag image's intrinsic dimensions and aspect ratio.
          canvas.width = previous.width = flagLayer.width = pixels.width || DISPLAY_WIDTH;
          canvas.height = previous.height = flagLayer.height = pixels.height || DISPLAY_HEIGHT;
        }
        render();
      });
    },
    addGuess(flagSrc: string): void {
      const token = renderToken;
      void Promise.all([targetReady, loadFlagPixels(flagSrc)]).then(([, guessPixels]) => {
        if (token !== renderToken || !targetPixels || !guessPixels) return;
        let changed = false;
        for (let pixel = 0; pixel < revealed.length; pixel += 1) {
          const offset = pixel * 4;
          if (channel(targetPixels.data, offset + 3) < MIN_ALPHA || channel(guessPixels.data, offset + 3) < MIN_ALPHA) continue;
          if (revealed[pixel] !== 1 && colorDistance(targetPixels.data, guessPixels.data, offset) <= MATCH_DISTANCE) {
            revealed[pixel] = 1;
            changed = true;
          }
        }
        if (changed) render(true);
      });
    },
  };
}
