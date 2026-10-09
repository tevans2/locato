/** A loaded URL is not yet a drawable frame. Wait for decoding before revealing it. */
export async function loadStreetImage(image: HTMLImageElement, src: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let cancel = () => {};
  let loaded = () => {};
  let failed = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error("Street View request cancelled."));
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => reject(new Error("Street View took too long to load.")), 20_000);
  });
  try {
    const ready = typeof image.decode === "function" ? (() => {
      image.src = src;
      return image.decode();
    })() : new Promise<void>((resolve, reject) => {
      loaded = resolve;
      failed = () => reject(new Error("Street View imagery could not load."));
      image.addEventListener("load", loaded, { once: true });
      image.addEventListener("error", failed, { once: true });
      image.src = src;
      if (image.complete && image.naturalWidth > 0) resolve();
    });
    await Promise.race([ready, stopped]);
    signal.throwIfAborted();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    image.removeEventListener("load", loaded);
    image.removeEventListener("error", failed);
  }
}
