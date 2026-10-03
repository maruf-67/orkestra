import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],

    coverage: {
      provider: "v8",

      // Vitest 5 omits files that were never imported, which quietly shrinks the
      // denominator and inflates the headline number. Left at the default, a
      // project at 3% real coverage reported 45%. `all` keeps untested files in
      // the report so the figure means what it looks like it means.
      all: true,

      include: ["src/**/*.ts"],
      exclude: [
        "src/**/types.ts",
        "src/index.ts",
      ],

      reporter: ["text", "html"],
      reportsDirectory: "coverage",

      // Ratchet, not a target. These sit just below today's honest numbers so a
      // regression fails CI, and are raised as the risky modules gain coverage.
      // src/commands stays excluded from any aggressive threshold: it is 4.5k
      // lines of sudo/systemd-bound orchestration that needs a fake-systemd
      // seam before unit tests would mean anything. See CONTRIBUTING.md.
      thresholds: {
        statements: 20,
        branches: 20,
        functions: 25,
        lines: 20,
      },
    },
  },
});