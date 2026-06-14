import { el } from "./createElement";

const WIDTH = 360;
const HEIGHT = 240;
const MATCH_DISTANCE = 82;
const MIN_ALPHA = 24;

export interface FlagColorRevealView {
  readonly element: HTMLElement;
  readonly reset: (targetSrc: string) => void;
  readonly addGuess: (flagSrc: string) => void;
}

type FlagPixels = {
  readonly data: Uint8ClampedArray;
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

function drawHiddenFlag(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#101510";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const tile = 18;
  for (let y = 0; y < HEIGHT; y += tile) {
    for (let x = 0; x < WIDTH; x += tile) {
      ctx.fillStyle = (x / tile + y / tile) % 2 === 0 ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.018)";
      ctx.fillRect(x, y, tile, tile);
    }
  }
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
    return { data: ctx.getImageData(0, 0, WIDTH, HEIGHT).data };
  });

  pixelCache.set(src, promise);
  return promise;
}

export function createFlagColorRevealView(): FlagColorRevealView {
  const canvas = el("canvas", { className: "flag-color-reveal-canvas", attrs: { width: String(WIDTH), height: String(HEIGHT), "aria-label": "Hidden target flag" } }) as HTMLCanvasElement;
  const meta = el("p", { className: "flag-color-reveal-meta", text: "Guess flags to reveal matching colours in matching positions." });
  const element = el("div", { className: "flag-color-reveal", children: [canvas, meta] });
  const ctx = canvas.getContext("2d");
  const revealed = new Uint8Array(WIDTH * HEIGHT);
  let targetSrc = "";
  let targetPixels: FlagPixels | null = null;
  let renderToken = 0;

  function render(): void {
    if (!ctx) return;
    drawHiddenFlag(ctx);
    if (!targetPixels) return;

    const output = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    let revealedCount = 0;
    for (let pixel = 0; pixel < revealed.length; pixel += 1) {
      if (revealed[pixel] !== 1) continue;
      const offset = pixel * 4;
      output.data[offset] = channel(targetPixels.data, offset);
      output.data[offset + 1] = channel(targetPixels.data, offset + 1);
      output.data[offset + 2] = channel(targetPixels.data, offset + 2);
      output.data[offset + 3] = channel(targetPixels.data, offset + 3);
      revealedCount += 1;
    }
    ctx.putImageData(output, 0, 0);
    const percent = Math.round((revealedCount / revealed.length) * 100);
    meta.textContent = revealedCount === 0 ? "Guess flags to reveal matching colours in matching positions." : `${percent}% of the target flag revealed`;
  }

  if (ctx) drawHiddenFlag(ctx);

  return {
    element,
    reset(nextTargetSrc: string): void {
      targetSrc = nextTargetSrc;
      targetPixels = null;
      revealed.fill(0);
      render();
      const token = ++renderToken;
      void loadFlagPixels(nextTargetSrc).then((pixels) => {
        if (token !== renderToken || targetSrc !== nextTargetSrc) return;
        targetPixels = pixels;
        render();
      });
    },
    addGuess(flagSrc: string): void {
      const token = renderToken;
      void loadFlagPixels(flagSrc).then((guessPixels) => {
        if (token !== renderToken || !targetPixels || !guessPixels) return;
        for (let pixel = 0; pixel < revealed.length; pixel += 1) {
          const offset = pixel * 4;
          if (channel(targetPixels.data, offset + 3) < MIN_ALPHA || channel(guessPixels.data, offset + 3) < MIN_ALPHA) continue;
          if (colorDistance(targetPixels.data, guessPixels.data, offset) <= MATCH_DISTANCE) revealed[pixel] = 1;
        }
        render();
      });
    },
  };
}
