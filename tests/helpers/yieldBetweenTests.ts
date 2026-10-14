import { afterEach } from "vitest";

// Some tests (Flyover's frame-by-frame flight simulations) hold a worker's event loop for a long
// stretch, and test files only await microtasks between tests. On a slow CI runner a whole file
// can then go a minute without a macrotask turn, so Vitest's own progress message to the main
// process ("onTaskUpdate") times out and fails the run with an unhandled error even though every
// test passed. Give the event loop a turn after each test. The real setImmediate is captured
// here, before any test can install fake timers.
const realSetImmediate = globalThis.setImmediate;

afterEach(() => new Promise<void>((resolve) => realSetImmediate(() => resolve())));
