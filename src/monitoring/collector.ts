import { collectSystemMetrics } from "./system.js";
import { collectServiceMetrics } from "./systemd.js";
import { listProjects } from "../state/store.js";
import { OsServiceProvider } from "../providers/service/service.js";
import { systemd } from "../services/systemd.js";
import type { MonitoringSnapshot, ProjectMonitoringData, InfrastructureStatus } from "./types.js";

export async function collectMonitoringSnapshot(): Promise<MonitoringSnapshot> {
  const osService = new OsServiceProvider();
  const [system, projects, caddy, redis, postgresql, mysql] = await Promise.all([
    collectSystemMetrics(),
    listProjects(),
    osService.status("caddy"),
    osService.status("redis"),
    osService.status("postgresql"),
    osService.status("mysql"),
  ]);

  const infrastructure: InfrastructureStatus = {
    caddy,
    redis,
    postgresql,
    mysql,
  };

  const applications: ProjectMonitoringData[] = [];

  for (const p of projects) {
    const isLaravel = p.framework.toLowerCase().includes("laravel");
    const serviceList = [];

    if (isLaravel) {
      const octaneName = systemd.getServiceName(p.name, "octane");
      const queueName = systemd.getServiceName(p.name, "queue");
      const reverbName = systemd.getServiceName(p.name, "reverb");

      const [octane, queue, reverb] = await Promise.all([
        collectServiceMetrics("Octane (API)", octaneName, "octane"),
        collectServiceMetrics("Queue Worker", queueName, "queue"),
        collectServiceMetrics("Reverb (WSS)", reverbName, "reverb"),
      ]);

      serviceList.push(octane, queue, reverb);
    } else {
      const webName = systemd.getServiceName(p.name, "web");
      const web = await collectServiceMetrics("Web (SSR)", webName, "web");
      serviceList.push(web);
    }

    applications.push({
      project: p.name,
      path: p.path,
      domain: p.domain,
      port: p.port,
      framework: p.framework,
      services: serviceList,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    system,
    infrastructure,
    applications,
  };
}
