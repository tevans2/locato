import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "bun:sqlite": fileURLToPath(new URL("./tests/helpers/nodeSqlite.ts", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
