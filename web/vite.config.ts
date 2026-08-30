import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/app/",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3333",
      "/tf": { target: "http://localhost:8790", rewrite: (p) => p.replace(/^\/tf/, "") },
    },
  },
  plugins: [react()],
});
