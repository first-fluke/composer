import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, defineProject } from "vitest/config"

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    globals: false,
    projects: [
      defineProject({
        resolve: {
          alias: {
            "@": resolve(root, "packages/core/src"),
          },
        },
        test: {
          name: "core",
          include: ["packages/core/src/**/*.test.ts"],
        },
      }),
      defineProject({
        resolve: {
          alias: {
            "@": resolve(root, "apps/cli/src"),
          },
        },
        test: {
          name: "cli",
          include: ["apps/cli/src/**/*.test.ts"],
        },
      }),
      defineProject({
        resolve: {
          alias: {
            "@": resolve(root, "apps/dashboard/src"),
          },
        },
        test: {
          name: "dashboard",
          include: ["apps/dashboard/src/**/*.test.ts"],
        },
      }),
    ],
  },
})
