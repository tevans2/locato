/** Three complete seconds, with cancellation on navigation/restart. */
export async function runGeoCountdown(signal: AbortSignal, onTick: (remaining: number) => void): Promise<void> {
  for (const remaining of [3, 2, 1]) {
    signal.throwIfAborted();
    onTick(remaining);
    await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 1000);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  signal.throwIfAborted();
}
