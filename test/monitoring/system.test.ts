import { describe, it, expect } from "vitest";
import { collectSystemMetrics } from "../../src/monitoring/system.js";
import { collectMonitoringSnapshot } from "../../src/monitoring/collector.js";

describe("Monitoring & Observability Engine", () => {
  it("collects system metrics successfully", async () => {
    const metrics = await collectSystemMetrics();

    expect(metrics).toBeDefined();
    expect(typeof metrics.cpuPercent).toBe("number");
    expect(metrics.memory.totalMb).toBeGreaterThan(0);
    expect(metrics.memory.percent).toBeGreaterThanOrEqual(0);
    expect(metrics.memory.percent).toBeLessThanOrEqual(100);
    expect(metrics.loadAverage).toHaveLength(3);
    expect(typeof metrics.uptime).toBe("string");
  });

  it("collects full monitoring snapshot", async () => {
    const snapshot = await collectMonitoringSnapshot();

    expect(snapshot.timestamp).toBeDefined();
    expect(snapshot.system).toBeDefined();
    expect(snapshot.infrastructure).toBeDefined();
    expect(snapshot.infrastructure.caddy).toBeDefined();
    expect(snapshot.infrastructure.redis).toBeDefined();
    expect(snapshot.infrastructure.postgresql).toBeDefined();
    expect(snapshot.infrastructure.mysql).toBeDefined();
    expect(Array.isArray(snapshot.applications)).toBe(true);
  });
});
