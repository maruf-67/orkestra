import { systemd } from "./systemd.js";

export interface ProjectServicesStatus {
  projectName: string;
  http?: { name: string; type: "octane" | "web"; status: string; port?: number };
  octane?: { name: string; status: string; port?: number };
  web?: { name: string; status: string; port?: number };
  queue?: { name: string; status: string; connection?: string };
  reverb?: { name: string; status: string; port?: number };
}

export class ServicesManager {
  async restartProjectServices(
    projectName: string,
    services: { octane?: boolean; web?: boolean; queue?: boolean; reverb?: boolean }
  ): Promise<void> {
    if (services.octane) {
      const name = systemd.getServiceNameFor(projectName, "octane");
      await systemd.restart(name);
    } else if (services.web) {
      const name = systemd.getServiceNameFor(projectName, "web");
      await systemd.restart(name);
    }
    if (services.queue) {
      const name = systemd.getServiceNameFor(projectName, "queue");
      await systemd.restart(name);
    }
    if (services.reverb) {
      const name = systemd.getServiceNameFor(projectName, "reverb");
      await systemd.restart(name);
    }
  }

  async getProjectServicesStatus(
    projectName: string
  ): Promise<ProjectServicesStatus> {
    const result: ProjectServicesStatus = { projectName };

    const octaneName = systemd.getServiceNameFor(projectName, "octane");
    const webName = systemd.getServiceNameFor(projectName, "web");
    const queueName = systemd.getServiceNameFor(projectName, "queue");
    const reverbName = systemd.getServiceNameFor(projectName, "reverb");

    const [octaneSt, webSt, queueSt, reverbSt] = await Promise.all([
      systemd.getStatus(octaneName),
      systemd.getStatus(webName),
      systemd.getStatus(queueName),
      systemd.getStatus(reverbName),
    ]);

    if (octaneSt !== "unknown") {
      result.octane = { name: octaneName, status: octaneSt };
      result.http = { name: octaneName, type: "octane", status: octaneSt };
    } else if (webSt !== "unknown") {
      result.web = { name: webName, status: webSt };
      result.http = { name: webName, type: "web", status: webSt };
    }

    if (queueSt !== "unknown") {
      result.queue = { name: queueName, status: queueSt };
    }

    if (reverbSt !== "unknown") {
      result.reverb = { name: reverbName, status: reverbSt };
    }

    return result;
  }
}

export const servicesManager = new ServicesManager();
