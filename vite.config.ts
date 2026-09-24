import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      "@tauri-apps/api/core": path.resolve(__dirname, "src/ipc-bridge.ts"),
    },
  },
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
