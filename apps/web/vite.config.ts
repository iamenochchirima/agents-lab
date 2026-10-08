import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, webRoot, "VITE_");
  const apiTarget = process.env.VITE_AGENTLAB_API_URL ?? environment.VITE_AGENTLAB_API_URL ?? "http://127.0.0.1:4318";
  return {
  root: webRoot,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(webRoot, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Administration stays on the frontend origin so its HttpOnly cookie and
    // Origin/CSRF checks work. Public/native execution routes keep their API URL.
    proxy: { "/api/management": { target: apiTarget, changeOrigin: false } },
    fs: {
      allow: [path.resolve(webRoot, "../..")],
    },
  },
  build: {
    outDir: path.resolve(webRoot, "dist"),
    emptyOutDir: true,
  },
  };
});
