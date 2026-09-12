import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * Unit tests only — no database, no network.
 *
 * Everything here runs against pure logic, which is deliberate: the bugs that
 * actually reached the paying customer (a portal response type rejected
 * outright, template placeholders emailed verbatim, two pay buttons on every
 * invoice, due-date filters) all lived in pure functions and would each have
 * been caught here. Anything needing a real database belongs in
 * scripts/reconcile-foundation.ts, which CI runs separately.
 *
 * The "@/" alias is declared here rather than via vite-tsconfig-paths: that
 * plugin is ESM-only and this project is CommonJS, so it can't be loaded.
 * One alias is cheaper than the dependency anyway — keep it in step with
 * tsconfig.json's paths.
 */
export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
