import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, webRoot, "VITE_");
  const apiTarget = process.env.AGENTLAB_API_PROXY_TARGET
    || environment.VITE_AGENTLAB_API_URL
    || `http://127.0.0.1:${process.env.AGENTLAB_API_PORT ?? "4318"}`;
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
    // Keep every browser API call same-origin. This preserves management cookies
    // and lets the in-app browser reach the control plane without opening a
    // second loopback port to the browser.
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
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
