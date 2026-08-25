import os from "node:os";
import { run } from "../utils/exec.js";
import type { SystemMetrics } from "./types.js";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / (3600 * 24));
  const hrs = Math.floor((seconds % (3600 * 24)) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

export async function collectSystemMetrics(): Promise<SystemMetrics> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  const totalMb = Math.round(totalMem / (1024 * 1024));
  const usedMb = Math.round(usedMem / (1024 * 1024));
  const freeMb = Math.round(freeMem / (1024 * 1024));
  const memPercent = Math.round((usedMem / totalMem) * 100);

  const loadAvg = os.loadavg();
  const cpus = os.cpus();
  const numCpus = cpus.length || 1;

  // Approximate CPU utilization from load average
  const cpuPercent = Math.min(100, Math.round((loadAvg[0] / numCpus) * 100));

  let totalGb = 0;
  let usedGb = 0;
  let freeGb = 0;
  let diskPercent = 0;

  try {
    const dfRes = await run("df", ["-Pk", "/"]);
    if (dfRes.exitCode === 0) {
      const lines = dfRes.stdout.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        const totalKb = parseInt(parts[1], 10);
        const usedKb = parseInt(parts[2], 10);
        const availKb = parseInt(parts[3], 10);

        totalGb = parseFloat((totalKb / (1024 * 1024)).toFixed(1));
        usedGb = parseFloat((usedKb / (1024 * 1024)).toFixed(1));
        freeGb = parseFloat((availKb / (1024 * 1024)).toFixed(1));
        diskPercent = Math.round((usedKb / totalKb) * 100);
      }
    }
  } catch {}

  return {
    cpuPercent,
    memory: {
      totalMb,
      usedMb,
      freeMb,
      percent: memPercent,
    },
    disk: {
      totalGb,
      usedGb,
      freeGb,
      percent: diskPercent,
    },
    loadAverage: [
      parseFloat(loadAvg[0].toFixed(2)),
      parseFloat(loadAvg[1].toFixed(2)),
      parseFloat(loadAvg[2].toFixed(2)),
    ],
    uptime: formatUptime(os.uptime()),
  };
}
