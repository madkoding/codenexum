import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@codenexum/core", "@codenexum/sql"] })],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: { index: "src/main/index.ts" },
        external: ["electron"],
        output: { format: "cjs" },
      },
    },
  },
  preload: {
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: { format: "cjs" },
        external: ["electron"],
      },
    },
  },
  renderer: {
    root: "src/renderer",
    build: { outDir: "dist/renderer" },
    plugins: [react()],
  },
})
