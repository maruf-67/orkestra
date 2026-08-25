import { log, heading, table } from "../utils/logger.js";
import { listProjects } from "../state/store.js";
import { systemd } from "../services/systemd.js";
import { loadConfig } from "../config/loader.js";
import { OsServiceProvider } from "../providers/service/service.js";

interface ServicesOptions {
  project?: string;
  json?: boolean;
  watch?: boolean;
}

export async function services(options: ServicesOptions) {
  const osService = new OsServiceProvider();
  const allProjects = await listProjects();

  let targetProjects = allProjects;
  if (options.project) {
    targetProjects = allProjects.filter(
      (p) =>
        p.name.toLowerCase() === options.project!.toLowerCase() ||
        p.path.toLowerCase().includes(options.project!.toLowerCase())
    );
    if (targetProjects.length === 0) {
      log.error(`Project not found: ${options.project}`);
      process.exit(1);
    }
  }

  const renderDashboard = async () => {
    const projectResults = [];

    for (const p of targetProjects) {
      const config = await loadConfig(p.path);
      const octaneName = systemd.getServiceNameFor(p.name, "octane");
      const queueName = systemd.getServiceNameFor(p.name, "queue");
      const reverbName = systemd.getServiceNameFor(p.name, "reverb");

      const [octaneSt, queueSt, reverbSt] = await Promise.all([
        systemd.getStatus(octaneName),
        systemd.getStatus(queueName),
        systemd.getStatus(reverbName),
      ]);

      projectResults.push({
        project: p.name,
        path: p.path,
        domain: p.domain,
        port: p.port,
        reverbPort: config?.reverbPort || 8080,
        services: {
          octane: { name: octaneName, status: octaneSt },
          queue: { name: queueName, status: queueSt },
          reverb: { name: reverbName, status: reverbSt },
        },
      });
    }

    const [caddySt, redisSt, mysqlSt] = await Promise.all([
      osService.status("caddy"),
      osService.status("redis"),
      osService.status("mysql"),
    ]);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            projects: projectResults,
            system: {
              caddy: caddySt,
              redis: redisSt,
              mysql: mysqlSt,
            },
          },
          null,
          2
        )
      );
      return;
    }

    heading("System Services");
    table([
      ["Caddy (Reverse Proxy)", caddySt === "running" ? "\x1b[32m● running\x1b[0m" : `\x1b[31m○ ${caddySt}\x1b[0m`],
      ["Redis (Queues/Cache)", redisSt === "running" ? "\x1b[32m● running\x1b[0m" : `\x1b[33m○ ${redisSt}\x1b[0m`],
      ["MySQL (Database)", mysqlSt === "running" ? "\x1b[32m● running\x1b[0m" : `\x1b[33m○ ${mysqlSt}\x1b[0m`],
    ]);

    for (const pr of projectResults) {
      heading(`Application: ${pr.project}`);
      const formatStatus = (st: string, extra = "") => {
        if (st === "running") return `\x1b[32m● running\x1b[0m ${extra}`;
        if (st === "failed") return `\x1b[31m✗ failed\x1b[0m`;
        if (st === "stopped") return `\x1b[33m○ stopped\x1b[0m`;
        return `\x1b[90m- not installed\x1b[0m`;
      };

      table([
        ["API (Octane)", formatStatus(pr.services.octane.status, `(:${pr.port})`)],
        ["Queue Worker", formatStatus(pr.services.queue.status)],
        ["Reverb (WebSocket)", formatStatus(pr.services.reverb.status, `(:${pr.reverbPort})`)],
      ]);
    }
  };

  if (options.watch) {
    process.stdout.write("\x1b[2J\x1b[0;0H");
    await renderDashboard();
    return new Promise<void>((resolve) => {
      const timer = setInterval(async () => {
        process.stdout.write("\x1b[2J\x1b[0;0H");
        log.dim(`Refreshed at ${new Date().toLocaleTimeString()} (Ctrl+C to exit)\n`);
        await renderDashboard();
      }, 2000);

      process.on("SIGINT", () => {
        clearInterval(timer);
        resolve();
      });
    });
  }

  await renderDashboard();
}
