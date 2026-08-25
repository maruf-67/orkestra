import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { systemd, type SystemdServiceOptions } from "./systemd.js";
import type { ProjectCapabilities } from "../deployment/types.js";
import type { OrkestraConfig } from "../config/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "templates", "laravel");

export interface ProjectServicesStatus {
  projectName: string;
  http?: { name: string; type: "octane" | "web"; status: string; port?: number };
  octane?: { name: string; status: string; port?: number };
  web?: { name: string; status: string; port?: number };
  queue?: { name: string; status: string; connection?: string };
  reverb?: { name: string; status: string; port?: number };
}

export class ServicesManager {
  async setupLaravelServices(
    projectDir: string,
    projectName: string,
    capabilities: ProjectCapabilities,
    config?: OrkestraConfig | null,
    ports?: { octanePort?: number; reverbPort?: number }
  ): Promise<{
    httpInstalled: boolean;
    octaneInstalled: boolean;
    webInstalled: boolean;
    queueInstalled: boolean;
    reverbInstalled: boolean;
    httpService?: string;
    octaneService?: string;
    webService?: string;
    queueService?: string;
    reverbService?: string;
  }> {
    const httpPort =
      ports?.octanePort ||
      (typeof config?.proxy === "object" ? config.proxy.api?.port : undefined) ||
      config?.services?.octane?.port ||
      config?.port ||
      8000;

    const reverbPort =
      ports?.reverbPort ||
      (typeof config?.proxy === "object" ? config.proxy.realtime?.port : undefined) ||
      config?.services?.reverb?.port ||
      config?.reverbPort ||
      8080;

    const baseOptions: SystemdServiceOptions = {
      projectName,
      projectPath: projectDir,
      phpBinary: capabilities.phpBinary || "php",
      port: httpPort,
      octanePort: httpPort,
      reverbPort,
      octaneServer: capabilities.octaneServer !== "none" ? capabilities.octaneServer : "roadrunner",
      maxRequests: config?.services?.octane?.maxRequests ?? 500,
      queueConnection: config?.services?.queue?.connection || capabilities.queueConnection || "redis",
      queues: config?.services?.queue?.queues || "default",
      sleep: config?.services?.queue?.sleep ?? 3,
      tries: config?.services?.queue?.tries ?? 3,
      timeout: config?.services?.queue?.timeout ?? 90,
      maxJobs: config?.services?.queue?.maxJobs ?? 500,
      maxTime: config?.services?.queue?.maxTime ?? 3600,
    };

    let octaneInstalled = false;
    let webInstalled = false;
    let queueInstalled = false;
    let reverbInstalled = false;
    let octaneService: string | undefined;
    let webService: string | undefined;
    let queueService: string | undefined;
    let reverbService: string | undefined;

    // 1. HTTP Service (Octane if available, else Laravel Web fallback)
    const octaneExplicitlyDisabled = config?.services?.octane?.enabled === false;
    const octaneEnabled =
      !octaneExplicitlyDisabled &&
      (config?.services?.octane?.enabled === true || capabilities.hasOctane);

    if (octaneEnabled) {
      octaneService = await systemd.installService(
        "octane",
        join(TEMPLATES_DIR, "octane.service"),
        baseOptions
      );
      octaneInstalled = true;
    } else {
      webService = await systemd.installService(
        "web",
        join(TEMPLATES_DIR, "web.service"),
        baseOptions
      );
      webInstalled = true;
    }

    // 2. Queue Service
    const queueEnabled = config?.services?.queue?.enabled !== false && capabilities.hasQueue;
    if (queueEnabled) {
      queueService = await systemd.installService(
        "queue",
        join(TEMPLATES_DIR, "queue.service"),
        baseOptions
      );
      queueInstalled = true;
    }

    // 3. Reverb Service
    const reverbEnabled =
      config?.services?.reverb?.enabled === true ||
      (config?.services?.reverb?.enabled === "auto" && capabilities.hasReverb) ||
      (config?.services?.reverb?.enabled === undefined && capabilities.hasReverb);

    if (reverbEnabled) {
      reverbService = await systemd.installService(
        "reverb",
        join(TEMPLATES_DIR, "reverb.service"),
        baseOptions
      );
      reverbInstalled = true;
    }

    return {
      httpInstalled: octaneInstalled || webInstalled,
      octaneInstalled,
      webInstalled,
      queueInstalled,
      reverbInstalled,
      httpService: octaneService || webService,
      octaneService,
      webService,
      queueService,
      reverbService,
    };
  }

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
