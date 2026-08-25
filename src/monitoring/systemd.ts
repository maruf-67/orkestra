import { run } from "../utils/exec.js";
import { isLinux } from "../platform/index.js";
import type { ServiceProcessMetrics } from "./types.js";

export async function collectServiceMetrics(
  name: string,
  serviceName: string,
  type: string
): Promise<ServiceProcessMetrics> {
  if (!isLinux()) {
    return {
      name,
      serviceName,
      type,
      status: "unknown",
    };
  }

  try {
    const res = await run("systemctl", [
      "show",
      serviceName,
      "--property=ActiveState,SubState,MainPID,MemoryCurrent,NRestarts,ExecMainStartTimestamp",
    ]);

    if (res.exitCode !== 0) {
      return {
        name,
        serviceName,
        type,
        status: "inactive",
      };
    }

    const lines = res.stdout.trim().split("\n");
    const props: Record<string, string> = {};
    for (const line of lines) {
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) {
        props[line.substring(0, eqIdx)] = line.substring(eqIdx + 1);
      }
    }

    const activeState = props["ActiveState"] || "unknown";
    const pid = parseInt(props["MainPID"] || "0", 10);
    const rawMemory = parseInt(props["MemoryCurrent"] || "0", 10);
    const restarts = parseInt(props["NRestarts"] || "0", 10);
    const startTime = props["ExecMainStartTimestamp"];

    let status: ServiceProcessMetrics["status"] = "unknown";
    if (activeState === "active") status = "running";
    else if (activeState === "failed") status = "failed";
    else if (activeState === "inactive") status = "stopped";

    const memoryMb = !isNaN(rawMemory) && rawMemory > 0 && rawMemory < 18446744073709551615
      ? Math.round(rawMemory / (1024 * 1024))
      : undefined;

    const crashLoopDetected = status === "failed" || (restarts >= 5 && status !== "running");

    return {
      name,
      serviceName,
      type,
      status,
      pid: pid > 0 ? pid : undefined,
      memoryMb,
      restarts: !isNaN(restarts) ? restarts : 0,
      uptime: startTime && startTime !== "" ? startTime : undefined,
      crashLoopDetected,
    };
  } catch {
    return {
      name,
      serviceName,
      type,
      status: "unknown",
    };
  }
}
