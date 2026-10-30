import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Builds the production bundle straight into the repo's public/ dir,
// which is what Netlify publishes. emptyOutDir replaces the old
// vanilla-JS bundle (kept in git history) with the React build.
// base './' keeps asset paths relative (file:// preview safe).
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../public",
    emptyOutDir: true,
    sourcemap: false,
  },
});
