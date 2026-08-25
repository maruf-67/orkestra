import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeLog,
  readLogs,
  getLogPath,
  listLogFiles,
  LogEntry,
} from "../../src/utils/logger-file.js";

describe("logger-file", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "orkestra-test-logs-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("writeLog", () => {
    it("creates log file and writes entry", async () => {
      const entry: LogEntry = {
        timestamp: new Date("2024-01-15T10:30:00.000Z"),
        stream: "stdout",
        message: "Server started",
      };

      await writeLog(testDir, "test-app", entry);

      const logPath = getLogPath(testDir, "test-app");
      const content = await readFile(logPath, "utf-8");

      expect(content).toContain("[2024-01-15T10:30:00.000Z] [stdout] Server started");
    });

    it("appends multiple entries", async () => {
      await writeLog(testDir, "test-app", {
        timestamp: new Date("2024-01-15T10:30:00.000Z"),
        stream: "stdout",
        message: "Line 1",
      });

      await writeLog(testDir, "test-app", {
        timestamp: new Date("2024-01-15T10:30:01.000Z"),
        stream: "stderr",
        message: "Line 2",
      });

      const logPath = getLogPath(testDir, "test-app");
      const content = await readFile(logPath, "utf-8");

      expect(content).toContain("Line 1");
      expect(content).toContain("Line 2");
      expect(content).toContain("[stderr]");
    });
  });

  describe("readLogs", () => {
    beforeEach(async () => {
      // Write test logs
      await writeLog(testDir, "test-app", {
        timestamp: new Date("2024-01-15T10:00:00.000Z"),
        stream: "stdout",
        message: "First log",
      });
      await writeLog(testDir, "test-app", {
        timestamp: new Date("2024-01-15T10:05:00.000Z"),
        stream: "stderr",
        message: "Error log",
      });
      await writeLog(testDir, "test-app", {
        timestamp: new Date("2024-01-15T10:10:00.000Z"),
        stream: "stdout",
        message: "Last log",
      });
    });

    it("reads all logs", async () => {
      const entries = await readLogs(testDir, "test-app");
      expect(entries).toHaveLength(3);
    });

    it("filters by since", async () => {
      const entries = await readLogs(testDir, "test-app", {
        since: new Date("2024-01-15T10:05:00.000Z"),
      });
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe("Error log");
    });

    it("filters by stream", async () => {
      const entries = await readLogs(testDir, "test-app", {
        stream: "stderr",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe("Error log");
    });

    it("applies limit", async () => {
      const entries = await readLogs(testDir, "test-app", {
        limit: 2,
      });
      expect(entries).toHaveLength(2);
      expect(entries[0].message).toBe("Error log");
    });

    it("returns empty array for non-existent project", async () => {
      const entries = await readLogs(testDir, "non-existent");
      expect(entries).toHaveLength(0);
    });
  });

  describe("getLogPath", () => {
    it("returns correct log path", async () => {
      const path = getLogPath(testDir, "my-app");
      expect(path).toContain(".orkestra/logs/my-app.log");
    });
  });

  describe("listLogFiles", () => {
    it("lists log files", async () => {
      await writeLog(testDir, "app1", {
        timestamp: new Date(),
        stream: "stdout",
        message: "test",
      });
      await writeLog(testDir, "app2", {
        timestamp: new Date(),
        stream: "stdout",
        message: "test",
      });

      const files = await listLogFiles(testDir);
      expect(files).toHaveLength(2);
      expect(files).toContain("app1.log");
      expect(files).toContain("app2.log");
    });

    it("returns empty array when no logs", async () => {
      const files = await listLogFiles(testDir);
      expect(files).toHaveLength(0);
    });
  });
});
