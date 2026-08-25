import { systemd } from "../services/systemd.js";
import { run } from "../utils/exec.js";

export interface HealthCheckOptions {
  apiUrl?: string;
  expectedStatus?: number;
  timeoutMs?: number;
  reverbDomain?: string;
  reverbPort?: number;
  projectName?: string;
  services?: { octane?: boolean; queue?: boolean; reverb?: boolean };
}

export interface HealthCheckResult {
  api: {
    checked: boolean;
    healthy: boolean;
    url?: string;
    statusCode?: number;
    error?: string;
  };
  reverb: {
    checked: boolean;
    healthy: boolean;
    domain?: string;
    port?: number;
    error?: string;
  };
  services: {
    checked: boolean;
    allActive: boolean;
    details: Record<string, boolean>;
  };
  overallHealthy: boolean;
}

export async function checkApiHealth(
  url: string,
  expectedStatus = 200,
  timeoutMs = 5000
): Promise<{ healthy: boolean; statusCode?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "Orkestra-Health-Checker/1.0" },
    });

    clearTimeout(timer);

    return {
      healthy: response.status === expectedStatus || (response.status >= 200 && response.status < 400),
      statusCode: response.status,
    };
  } catch (err: any) {
    // Fallback to curl
    try {
      const curlRes = await run("curl", [
        "-s",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "-m",
        String(Math.ceil(timeoutMs / 1000)),
        url,
      ]);
      const code = parseInt(curlRes.stdout.trim(), 10);
      if (!isNaN(code) && code > 0) {
        return {
          healthy: code === expectedStatus || (code >= 200 && code < 400),
          statusCode: code,
        };
      }
    } catch {}

    return {
      healthy: false,
      error: err?.message || String(err),
    };
  }
}

export async function performDeploymentHealthChecks(
  options: HealthCheckOptions
): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    api: { checked: false, healthy: true },
    reverb: { checked: false, healthy: true },
    services: { checked: false, allActive: true, details: {} },
    overallHealthy: true,
  };

  // 1. API Health Check
  if (options.apiUrl) {
    result.api.checked = true;
    result.api.url = options.apiUrl;
    const apiRes = await checkApiHealth(
      options.apiUrl,
      options.expectedStatus ?? 200,
      options.timeoutMs ?? 5000
    );
    result.api.healthy = apiRes.healthy;
    result.api.statusCode = apiRes.statusCode;
    result.api.error = apiRes.error;
    if (!apiRes.healthy) result.overallHealthy = false;
  }

  // 2. Services Active Check
  if (options.projectName) {
    result.services.checked = true;
    const checkList: { type: "octane" | "queue" | "reverb"; enabled?: boolean }[] = [
      { type: "octane", enabled: options.services?.octane },
      { type: "queue", enabled: options.services?.queue },
      { type: "reverb", enabled: options.services?.reverb },
    ];

    for (const item of checkList) {
      if (item.enabled) {
        const serviceName = systemd.getServiceNameFor(options.projectName, item.type);
        const isActive = await systemd.isActive(serviceName);
        result.services.details[serviceName] = isActive;
        if (!isActive) {
          result.services.allActive = false;
          result.overallHealthy = false;
        }
      }
    }
  }

  // 3. Reverb Check
  if (options.reverbPort) {
    result.reverb.checked = true;
    result.reverb.port = options.reverbPort;
    result.reverb.domain = options.reverbDomain;
    // Check if port is open locally
    try {
      const { createConnection } = await import("node:net");
      const isReverbPortOpen = await new Promise<boolean>((resolve) => {
        const socket = createConnection({ port: options.reverbPort!, host: "127.0.0.1" }, () => {
          socket.end();
          resolve(true);
        });
        socket.setTimeout(2000, () => {
          socket.destroy();
          resolve(false);
        });
        socket.on("error", () => resolve(false));
      });

      result.reverb.healthy = isReverbPortOpen;
      if (!isReverbPortOpen) {
        result.reverb.error = `Reverb port ${options.reverbPort} is not accepting connections`;
        // Only mark overall unhealthy if service was strictly expected
        if (options.services?.reverb) {
          result.overallHealthy = false;
        }
      }
    } catch (err: any) {
      result.reverb.healthy = false;
      result.reverb.error = err.message;
    }
  }

  return result;
}
