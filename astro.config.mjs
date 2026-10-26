import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  output: "static",
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    clearScreen: false,
    server: {
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**", "**/tools/**", "**/.tools-cache/**"],
      },
    },
    envPrefix: ["PUBLIC_", "TAURI_"],
  },
});
