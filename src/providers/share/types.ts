export interface ShareProvider {
  name: string;
  priority: number;

  detect(): Promise<boolean>;

  start(options: ShareOptions): Promise<ShareSession>;

  stop(session: ShareSession): Promise<void>;

  getStatus(session: ShareSession): Promise<ShareStatus>;

  getInstallCommand(): string;
}

export interface ShareOptions {
  port: number;
  domain?: string;
  projectName: string;
  logFile?: string;
}

export interface ShareSession {
  provider: string;
  publicUrl: string;
  localUrl: string;
  pid: number;
  startedAt: Date;
  logFile?: string;
}

export interface ShareStatus {
  isRunning: boolean;
  publicUrl?: string;
  uptime?: string;
}
