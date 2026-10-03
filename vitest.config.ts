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

      // Ratchet, not a target. Set just below the honest numbers as of 1.0.10 so a
      // regression fails CI, and raised as the risky modules gain coverage.
      //
      // The headline figure is low because src/commands is ~4.5k lines of
      // sudo/systemd-bound orchestration that cannot be meaningfully unit tested
      // without an injectable process/filesystem seam. Raising the global number
      // by writing mock-heavy tests there would be worse than leaving the gap
      // visible. The modules where a silent regression breaks a live deployment
      // are held to a much higher standard individually — see
      // test/deployment/pipeline.test.ts and test/deployment/git.test.ts.
      thresholds: {
        statements: 26,
        branches: 24,
        functions: 32,
        lines: 26,
      },
    },
  },
});