import vinext from "vinext";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [vinext()],
  server: {host: "127.0.0.1", port: 5173, strictPort: true, open: false,
    watch: {ignored: ["**/*profile*/**", "**/.eeo-browser-*/**", "**/.chrome-*/**", "**/node_modules/**", "**/.git/**", "**/dist/**", "**/.next/**", "**/.node-data/**", "**/.wrangler/**", "**/data/**", "**/diagnostics/**", "**/backups/**", "**/.cache/**", "**/tmp/**", "**/temp/**", "**/*.log", "**/*.tmp"]}},
});
