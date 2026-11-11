import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.DIGITATA_PORT ?? 7741);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5741,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
});
