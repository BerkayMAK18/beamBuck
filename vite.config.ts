// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// GitHub Pages serves static files only — no server runtime. Building with
// NITRO_PRESET=github-pages (set in .github/workflows/deploy-pages.yml) makes
// Nitro's zero-config preset detection produce a fully static, prerendered
// `.output/public` instead of the Cloudflare Workers bundle.
// See README.md "Build for production" and .github/workflows/deploy-pages.yml.
const isGithubPagesBuild = process.env.NITRO_PRESET === "github-pages";

// Project Pages are served from https://<user>.github.io/<repo>/, not the
// domain root, so the app needs to know its base path. actions/configure-pages
// computes this correctly (including the "/" case for a custom domain or a
// <user>.github.io root repo) — the workflow passes it through as PAGES_BASE_PATH.
const basePath = process.env.PAGES_BASE_PATH || "/";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: isGithubPagesBuild ? { base: basePath } : {},
});
