import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { systemd, type SystemdServiceOptions, type ServiceType } from "./systemd.js";
import type { ProjectCapabilities } from "../deployment/types.js";
import type { OrkestraConfig } from "../config/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "templates", "laravel");

export interface ProjectServicesStatus {
  projectName: string;
  octane?: { name: string; status: string; port?: number };
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
    octaneInstalled: boolean;
    queueInstalled: boolean;
    reverbInstalled: boolean;
    octaneService?: string;
    queueService?: string;
    reverbService?: string;
  }> {
    const octanePort =
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
      octanePort,
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
    let queueInstalled = false;
    let reverbInstalled = false;
    let octaneService: string | undefined;
    let queueService: string | undefined;
    let reverbService: string | undefined;

    // 1. Octane Service
    const octaneEnabled =
      config?.services?.octane?.enabled === true ||
      (config?.services?.octane?.enabled === "auto" && capabilities.hasOctane) ||
      (config?.services?.octane?.enabled === undefined && capabilities.hasOctane);

    if (octaneEnabled) {
      octaneService = await systemd.installService(
        "octane",
        join(TEMPLATES_DIR, "octane.service"),
        baseOptions
      );
      octaneInstalled = true;
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
      octaneInstalled,
      queueInstalled,
      reverbInstalled,
      octaneService,
      queueService,
      reverbService,
    };
  }

  async restartProjectServices(
    projectName: string,
    services: { octane?: boolean; queue?: boolean; reverb?: boolean }
  ): Promise<void> {
    if (services.octane) {
      const name = systemd.getServiceNameFor(projectName, "octane");
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
    projectName: string,
    options?: { octane?: boolean; queue?: boolean; reverb?: boolean }
  ): Promise<ProjectServicesStatus> {
    const result: ProjectServicesStatus = { projectName };

    if (options?.octane ?? true) {
      const name = systemd.getServiceNameFor(projectName, "octane");
      const st = await systemd.getStatus(name);
      result.octane = { name, status: st };
    }

    if (options?.queue ?? true) {
      const name = systemd.getServiceNameFor(projectName, "queue");
      const st = await systemd.getStatus(name);
      result.queue = { name, status: st };
    }

    if (options?.reverb ?? true) {
      const name = systemd.getServiceNameFor(projectName, "reverb");
      const st = await systemd.getStatus(name);
      result.reverb = { name, status: st };
    }

    return result;
  }
}

export const servicesManager = new ServicesManager();
