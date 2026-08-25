import { deploymentPipeline } from "../deployment/pipeline.js";
import { listProjects, getProject } from "../state/store.js";
import { servicesManager } from "../services/manager.js";
import { systemd } from "../services/systemd.js";
import { OsServiceProvider } from "../providers/service/service.js";
import { performDeploymentHealthChecks } from "../deployment/health.js";
import { getLastSuccessfulDeployment, getDeploymentHistory } from "../deployment/history.js";
import { checkoutCommit } from "../deployment/git.js";
import { installComposerDependencies } from "../deployment/composer.js";
import { optimizeLaravel } from "../deployment/laravel.js";
import { detectCapabilities } from "../deployment/detector.js";
import { readLogs } from "../utils/logger-file.js";
import { loadConfig } from "../config/loader.js";
import { resolve, basename } from "node:path";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "orkestra_deploy",
    description: "Deploy a Laravel/Node project with Git sync, Composer, Migrations, Systemd services, Caddy reverse proxy, and Health checks.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Absolute path to the project directory" },
        branch: { type: "string", description: "Git branch to deploy (e.g. main)" },
        strategy: { type: "string", enum: ["reset", "pull"], description: "Git sync strategy (default: reset)" },
        dryRun: { type: "boolean", description: "If true, simulates the deployment without executing destructive actions" },
        noMigrate: { type: "boolean", description: "If true, skips database migrations" },
        noRestart: { type: "boolean", description: "If true, skips restarting services" },
      },
    },
  },
  {
    name: "orkestra_status",
    description: "Get the status of all registered Orkestra projects, local URLs, ports, and running process IDs.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project name to filter" },
      },
    },
  },
  {
    name: "orkestra_services_status",
    description: "Inspect live systemd service status for Octane, Queue Workers, Reverb WebSockets, Caddy, Redis, and MySQL.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name" },
      },
    },
  },
  {
    name: "orkestra_services_action",
    description: "Start, stop, restart, or reload a specific systemd or system service.",
    inputSchema: {
      type: "object",
      properties: {
        serviceName: { type: "string", description: "Name of the systemd unit or system service" },
        action: { type: "string", enum: ["start", "stop", "restart", "reload"], description: "Action to perform" },
      },
      required: ["serviceName", "action"],
    },
  },
  {
    name: "orkestra_logs",
    description: "Retrieve recent stdout and stderr logs for a project.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Project directory" },
        project: { type: "string", description: "Project name" },
        limit: { type: "number", description: "Maximum log entries to return (default: 50)" },
      },
    },
  },
  {
    name: "orkestra_health_check",
    description: "Run comprehensive health checks against an API endpoint, WebSocket port, and active systemd units.",
    inputSchema: {
      type: "object",
      properties: {
        apiUrl: { type: "string", description: "URL to HTTP GET check" },
        reverbPort: { type: "number", description: "Reverb WebSocket TCP port" },
        projectName: { type: "string", description: "Project name to verify systemd units" },
      },
    },
  },
  {
    name: "orkestra_rollback",
    description: "Rollback a project deployment to the previous successful commit or a specific commit SHA.",
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Project directory" },
        project: { type: "string", description: "Project name" },
        toCommit: { type: "string", description: "Optional specific commit SHA to checkout" },
      },
    },
  },
];

export async function handleMcpToolCall(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {
    case "orkestra_deploy": {
      const report = await deploymentPipeline.execute({
        dir: args.dir,
        branch: args.branch,
        strategy: args.strategy,
        dryRun: args.dryRun,
        noMigrate: args.noMigrate,
        noRestart: args.noRestart,
      });
      return report;
    }

    case "orkestra_status": {
      const projects = await listProjects();
      if (args.project) {
        return projects.filter(
          (p) =>
            p.name.toLowerCase() === args.project.toLowerCase() ||
            p.path.toLowerCase().includes(args.project.toLowerCase())
        );
      }
      return projects;
    }

    case "orkestra_services_status": {
      const osService = new OsServiceProvider();
      const allProjects = await listProjects();
      const targetProjects = args.project
        ? allProjects.filter((p) => p.name.toLowerCase() === args.project.toLowerCase())
        : allProjects;

      const projectStatuses = [];
      for (const p of targetProjects) {
        const st = await servicesManager.getProjectServicesStatus(p.name);
        projectStatuses.push(st);
      }

      const [caddy, redis, mysql] = await Promise.all([
        osService.status("caddy"),
        osService.status("redis"),
        osService.status("mysql"),
      ]);

      return {
        projects: projectStatuses,
        system: { caddy, redis, mysql },
      };
    }

    case "orkestra_services_action": {
      const { serviceName, action } = args;
      if (action === "start") await systemd.start(serviceName);
      else if (action === "stop") await systemd.stop(serviceName);
      else if (action === "restart") await systemd.restart(serviceName);
      else if (action === "reload") await systemd.reload(serviceName);
      const newStatus = await systemd.getStatus(serviceName);
      return { serviceName, action, currentStatus: newStatus };
    }

    case "orkestra_logs": {
      const projectDir = resolve(args.dir || process.cwd());
      const config = await loadConfig(projectDir);
      const projectName = args.project || config?.name || basename(projectDir);
      const entries = readLogs(projectDir, projectName, { limit: args.limit || 50 });
      return { project: projectName, entries };
    }

    case "orkestra_health_check": {
      const health = await performDeploymentHealthChecks({
        apiUrl: args.apiUrl,
        reverbPort: args.reverbPort,
        projectName: args.projectName,
        services: { octane: true, queue: true, reverb: true },
      });
      return health;
    }

    case "orkestra_rollback": {
      const projectDir = resolve(args.dir || process.cwd());
      const config = await loadConfig(projectDir);
      const projectName = args.project || config?.name || basename(projectDir);

      let targetCommit = args.toCommit;
      if (!targetCommit) {
        const lastSuccess = await getLastSuccessfulDeployment(projectName);
        if (!lastSuccess?.previousCommit) {
          throw new Error(`No previous commit found to rollback to for ${projectName}`);
        }
        targetCommit = lastSuccess.previousCommit;
      }

      await checkoutCommit(projectDir, targetCommit);
      const capabilities = await detectCapabilities(projectDir);
      await installComposerDependencies({ composerBinary: capabilities.composerBinary, cwd: projectDir });
      if (capabilities.isLaravel) {
        await optimizeLaravel({ phpBinary: capabilities.phpBinary, cwd: projectDir });
      }
      await servicesManager.restartProjectServices(projectName, {
        octane: capabilities.hasOctane,
        queue: capabilities.hasQueue,
        reverb: capabilities.hasReverb,
      });

      return {
        success: true,
        project: projectName,
        rolledBackToCommit: targetCommit,
      };
    }

    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}
