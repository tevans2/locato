import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Proxy backend traffic to the Bun server (run `npm run serve`) so `npm run dev` has a
    // working API + WebSockets while keeping Vite HMR for the frontend.
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/social": { target: "ws://localhost:3000", ws: true },
    },
  },
});
