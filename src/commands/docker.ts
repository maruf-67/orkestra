import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { log, heading, table, spinner } from "../utils/logger.js";
import { run, isCommandAvailable } from "../utils/exec.js";
import prompts from "prompts";

interface DockerOptions {
  action?: "list" | "up" | "down" | "status";
  dir?: string;
}

interface DockerService {
  name: string;
  image: string;
  ports: string[];
  status?: string;
}

async function findComposeFile(dir: string): Promise<string | null> {
  const candidates = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
    "docker-compose.override.yml",
  ];

  for (const file of candidates) {
    const path = resolve(dir, file);
    if (existsSync(path)) return path;
  }
  return null;
}

async function parseComposeServices(dir: string): Promise<DockerService[]> {
  const composePath = await findComposeFile(dir);
  if (!composePath) return [];

  try {
    const content = await readFile(composePath, "utf-8");
    const services: DockerService[] = [];

    // Simple YAML parser for services section
    const serviceRegex = /(\w[\w-]*):\s*\n\s+image:\s*([\w./:-]+)/g;
    let match;
    while ((match = serviceRegex.exec(content)) !== null) {
      services.push({
        name: match[1],
        image: match[2],
        ports: [],
      });
    }

    // Parse ports
    const portRegex = /(\w[\w-]*):\s*\n(?:.*\n)*?\s+ports:\s*\n((?:\s+-\s+[\d:]+\n)*)/g;
    while ((match = portRegex.exec(content)) !== null) {
      const serviceName = match[1];
      const portsBlock = match[2];
      const service = services.find((s) => s.name === serviceName);
      if (service) {
        const portMatches = portsBlock.matchAll(/-\s+([\d:]+)/g);
        for (const portMatch of portMatches) {
          service.ports.push(portMatch[1]);
        }
      }
    }

    return services;
  } catch {
    return [];
  }
}

export async function docker(options: DockerOptions) {
  const projectDir = resolve(options.dir || process.cwd());

  if (!options.action) {
    // Show docker status
    heading("Docker Services");

    const hasDocker = await isCommandAvailable("docker");
    if (!hasDocker) {
      log.warn("Docker is not installed.");
      return;
    }

    const composePath = await findComposeFile(dir);
    if (!composePath) {
      log.info("No docker-compose file found in this directory.");
      log.dim("Commands:");
      log.dim("  orkestra docker up      Start all services");
      log.dim("  orkestra docker down    Stop all services");
      log.dim("  orkestra docker status  Show service status");
      return;
    }

    log.info(`Compose file: ${composePath}`);

    const services = await parseComposeServices(projectDir);
    if (services.length === 0) {
      log.info("No services defined in docker-compose file.");
      return;
    }

    const results: [string, string, string][] = [];
    for (const service of services) {
      results.push([service.name, service.image, service.ports.join(", ") || "-"]);
    }

    table(results);

    log.plain("");
    log.dim("Commands:");
    log.dim("  orkestra docker up      Start all services");
    log.dim("  orkestra docker down    Stop all services");
    log.dim("  orkestra docker status  Show service status");
    return;
  }

  if (options.action === "list") {
    const services = await parseComposeServices(projectDir);
    for (const service of services) {
      log.plain(`  ${service.name} (${service.image})`);
    }
    return;
  }

  if (options.action === "up") {
    const spin = spinner("Starting Docker services...");
    spin.start();
    const result = await run("docker", ["compose", "up", "-d"], { cwd: projectDir });
    if (result.exitCode === 0) {
      spin.succeed("Docker services started");
    } else {
      spin.fail(`Failed: ${result.stderr}`);
    }
    return;
  }

  if (options.action === "down") {
    const spin = spinner("Stopping Docker services...");
    spin.start();
    const result = await run("docker", ["compose", "down"], { cwd: projectDir });
    if (result.exitCode === 0) {
      spin.succeed("Docker services stopped");
    } else {
      spin.fail(`Failed: ${result.stderr}`);
    }
    return;
  }

  if (options.action === "status") {
    const result = await run("docker", ["compose", "ps"], { cwd: projectDir });
    console.log(result.stdout);
    return;
  }
}
