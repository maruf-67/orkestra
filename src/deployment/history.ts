import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPlatform } from "../platform/index.js";
import type { DeploymentReport, DeploymentHistoryRecord } from "./types.js";

function getDeploymentsDir(projectName: string): string {
  const platform = getPlatform();
  const cleanName = projectName.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return join(platform.configDir, "deployments", cleanName);
}

export async function saveDeploymentReport(report: DeploymentReport): Promise<string> {
  const dir = getDeploymentsDir(report.projectName);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}-${report.commit.substring(0, 7)}.json`;
  const filePath = join(dir, filename);

  await writeFile(filePath, JSON.stringify(report, null, 2), "utf-8");
  return filePath;
}

export async function getDeploymentHistory(projectName: string, limit = 10): Promise<DeploymentHistoryRecord[]> {
  const dir = getDeploymentsDir(projectName);
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();
  const records: DeploymentHistoryRecord[] = [];

  for (const file of jsonFiles.slice(0, limit)) {
    try {
      const content = await readFile(join(dir, file), "utf-8");
      const report: DeploymentReport = JSON.parse(content);
      records.push({
        id: file.replace(".json", ""),
        projectName: report.projectName,
        projectPath: report.projectPath,
        branch: report.branch,
        commit: report.commit,
        previousCommit: report.previousCommit,
        timestamp: report.startedAt,
        status: report.status === "success" ? "success" : "failed",
        durationSeconds: report.durationSeconds,
      });
    } catch {}
  }

  return records;
}

export async function getLastSuccessfulDeployment(projectName: string): Promise<DeploymentReport | null> {
  const dir = getDeploymentsDir(projectName);
  if (!existsSync(dir)) return null;

  const files = await readdir(dir);
  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();

  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(dir, file), "utf-8");
      const report: DeploymentReport = JSON.parse(content);
      if (report.status === "success") {
        return report;
      }
    } catch {}
  }

  return null;
}
