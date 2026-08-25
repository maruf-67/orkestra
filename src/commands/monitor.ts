import { log, heading, table } from "../utils/logger.js";
import { collectMonitoringSnapshot } from "../monitoring/collector.js";

interface MonitorOptions {
  project?: string;
  json?: boolean;
  watch?: boolean;
}

export async function monitor(options: MonitorOptions) {
  const renderDashboard = async () => {
    const snapshot = await collectMonitoringSnapshot();

    if (options.json) {
      console.log(JSON.stringify(snapshot, null, 2));
      return;
    }

    heading("System Overview");
    table([
      ["CPU Usage", `${snapshot.system.cpuPercent}%`],
      ["Memory (RAM)", `${(snapshot.system.memory.usedMb / 1024).toFixed(1)} / ${(snapshot.system.memory.totalMb / 1024).toFixed(1)} GB (${snapshot.system.memory.percent}%)`],
      ["Disk Space", `${snapshot.system.disk.usedGb} / ${snapshot.system.disk.totalGb} GB (${snapshot.system.disk.percent}%)`],
      ["Load Average", `${snapshot.system.loadAverage.join(", ")}`],
      ["System Uptime", snapshot.system.uptime],
    ]);

    heading("Infrastructure Services");
    const formatInfraStatus = (status: string) => {
      if (status === "running") return "\x1b[32m● running\x1b[0m";
      if (status === "stopped") return "\x1b[33m○ stopped\x1b[0m";
      return `\x1b[90m- ${status}\x1b[0m`;
    };

    table([
      ["Caddy (Reverse Proxy)", formatInfraStatus(snapshot.infrastructure.caddy)],
      ["Redis (Queues/Cache)", formatInfraStatus(snapshot.infrastructure.redis)],
      ["PostgreSQL (Database)", formatInfraStatus(snapshot.infrastructure.postgresql)],
      ["MySQL (Database)", formatInfraStatus(snapshot.infrastructure.mysql)],
    ]);

    let targetApps = snapshot.applications;
    if (options.project) {
      targetApps = snapshot.applications.filter((a) =>
        a.project.toLowerCase().includes(options.project!.toLowerCase())
      );
    }

    if (targetApps.length === 0) {
      heading("Applications");
      log.dim("No registered applications found.");
    } else {
      for (const app of targetApps) {
        heading(`Application: ${app.project} (${app.framework})`);
        const rows: [string, string][] = [];

        for (const srv of app.services) {
          let statusText = "\x1b[90mnot installed\x1b[0m";
          if (srv.status === "running") {
            statusText = `\x1b[32m● running\x1b[0m (PID: ${srv.pid || "-"})`;
            if (srv.memoryMb) statusText += ` | ${srv.memoryMb} MB`;
            if (srv.restarts && srv.restarts > 0) statusText += ` | ↻ ${srv.restarts} restarts`;
          } else if (srv.status === "failed") {
            statusText = `\x1b[31m✗ failed\x1b[0m`;
          } else if (srv.status === "stopped") {
            statusText = `\x1b[33m○ stopped\x1b[0m`;
          }

          if (srv.crashLoopDetected) {
            statusText += ` \x1b[31m[CRASH LOOP DETECTED]\x1b[0m`;
          }

          rows.push([srv.name, statusText]);
        }

        if (app.domain) {
          rows.push(["Public URL", `https://${app.domain}`]);
        }

        table(rows);
      }
    }
  };

  if (options.watch) {
    process.stdout.write("\x1b[2J\x1b[0;0H");
    await renderDashboard();
    return new Promise<void>((resolve) => {
      const interval = setInterval(async () => {
        process.stdout.write("\x1b[2J\x1b[0;0H");
        log.dim(`Refreshed at ${new Date().toLocaleTimeString()} (Ctrl+C to exit)\n`);
        await renderDashboard();
      }, 2000);

      process.on("SIGINT", () => {
        clearInterval(interval);
        resolve();
      });
    });
  }

  await renderDashboard();
}
