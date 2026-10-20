import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: path.resolve(here, "web"),
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/files": "http://127.0.0.1:8787"
    }
  },
  build: {
    outDir: path.resolve(here, "server", "public"),
    emptyOutDir: true
  }
});
