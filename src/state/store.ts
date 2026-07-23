import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPlatform } from "../platform/index.js";

export interface ProjectState {
  name: string;
  domain: string;
  port: number;
  framework: string;
  proxy: string;
  path: string;
  registeredAt: string;
  pid?: number;
  startedAt?: string;
}

export interface State {
  projects: Record<string, ProjectState>;
  allocatedPorts: number[];
}

const defaultState: State = {
  projects: {},
  allocatedPorts: [],
};

function getStatePath(): string {
  const platform = getPlatform();
  return join(platform.configDir, "state.json");
}

export async function loadState(): Promise<State> {
  const statePath = getStatePath();
  if (!existsSync(statePath)) {
    return { ...defaultState };
  }
  try {
    const data = await readFile(statePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return { ...defaultState };
  }
}

export async function saveState(state: State): Promise<void> {
  const statePath = getStatePath();
  const dir = join(getPlatform().configDir);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function registerProject(project: ProjectState): Promise<void> {
  const state = await loadState();
  state.projects[project.path] = project;
  if (!state.allocatedPorts.includes(project.port)) {
    state.allocatedPorts.push(project.port);
  }
  await saveState(state);
}

export async function unregisterProject(projectPath: string): Promise<void> {
  const state = await loadState();
  const project = state.projects[projectPath];
  if (project) {
    state.allocatedPorts = state.allocatedPorts.filter((p) => p !== project.port);
    delete state.projects[projectPath];
    await saveState(state);
  }
}

export async function getProject(projectPath: string): Promise<ProjectState | null> {
  const state = await loadState();
  return state.projects[projectPath] || null;
}

export async function listProjects(): Promise<ProjectState[]> {
  const state = await loadState();
  return Object.values(state.projects);
}

export async function isPortAllocated(port: number): Promise<boolean> {
  const state = await loadState();
  return state.allocatedPorts.includes(port);
}

export async function setProjectRunning(projectPath: string, pid: number): Promise<void> {
  const state = await loadState();
  const project = state.projects[projectPath];
  if (project) {
    project.pid = pid;
    project.startedAt = new Date().toISOString();
    await saveState(state);
  }
}

export async function setProjectStopped(projectPath: string): Promise<void> {
  const state = await loadState();
  const project = state.projects[projectPath];
  if (project) {
    delete project.pid;
    delete project.startedAt;
    await saveState(state);
  }
}

export async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
