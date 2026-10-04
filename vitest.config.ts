import { defineConfig } from "vitest/config";

// The web app (web/) has its own test run.
export default defineConfig({ test: { exclude: ["**/node_modules/**", "web/**"] } });
