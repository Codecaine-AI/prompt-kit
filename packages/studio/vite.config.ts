import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/postcss";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { createStudioApi } from "./server/studio-api";

const STUDIO_DIR = dirname(fileURLToPath(import.meta.url));
/** The prompt-kit checkout: the default catalog. */
const PROMPT_KIT_DIR = resolve(STUDIO_DIR, "../..");
/**
 * Codecaine Core, which links prompt-kit, @codecaine-ai/annotations and
 * @codecaine-ai/design-system as workspaces. The dev server must be allowed to
 * serve their TS sources and font files, or it answers 403.
 */
const CORE_DIR = resolve(PROMPT_KIT_DIR, "..");
const PORT = Number(process.env.PROMPT_KIT_STUDIO_PORT ?? 4860);
const WORKSPACE = resolve(process.env.PROMPT_KIT_STUDIO_WORKSPACE ?? PROMPT_KIT_DIR);

/** The catalog routes and the Prompt service proxy, in dev and preview alike. */
function studioApiPlugin(): Plugin {
  const api = createStudioApi({ workspace: WORKSPACE });
  return {
    name: "prompt-kit-studio-api",
    configureServer(server) {
      server.middlewares.use(api);
    },
    configurePreviewServer(server) {
      server.middlewares.use(api);
    },
  };
}

export default defineConfig({
  root: STUDIO_DIR,
  appType: "spa",
  plugins: [studioApiPlugin(), react()],
  css: { postcss: { plugins: [tailwindcss()] } },
  resolve: { dedupe: ["react", "react-dom"] },
  // prompt-kit and annotations export TS source: compile them, never prebundle a second React into them.
  optimizeDeps: { exclude: ["@codecaine-ai/prompt-kit", "@codecaine-ai/annotations"] },
  // The proxy holds the Prompt service token: listen on loopback only.
  server: { host: "127.0.0.1", port: PORT, strictPort: true, fs: { allow: [CORE_DIR] } },
  preview: { host: "127.0.0.1", port: PORT, strictPort: true },
});
