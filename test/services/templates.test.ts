import { describe, it, expect } from "vitest";
import { SystemdManager } from "../../src/services/systemd.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("SystemdManager service templates", () => {
  it("renders octane service template with variables", async () => {
    const manager = new SystemdManager();
    const serviceName = manager.getServiceNameFor("digital-library-api", "octane");
    expect(serviceName).toBe("orkestra-digital-library-api-octane.service");

    const tmp = await mkdtemp(join(tmpdir(), "ork-test-srv-"));
    const sampleTemplate = `[Unit]
Description=Orkestra Laravel Octane ({{PROJECT_NAME}})
[Service]
ExecStart={{PHP_BIN}} artisan octane:start --server={{OCTANE_SERVER}} --port={{OCTANE_PORT}}
`;
    const templatePath = join(tmp, "octane.service");
    await writeFile(templatePath, sampleTemplate);

    // Call internal render indirectly or check generated structure
    const rendered = (manager as any).renderTemplate(sampleTemplate, {
      PROJECT_NAME: "my-app",
      PHP_BIN: "/usr/bin/php",
      OCTANE_SERVER: "roadrunner",
      OCTANE_PORT: 8005,
    });

    expect(rendered).toContain("Description=Orkestra Laravel Octane (my-app)");
    expect(rendered).toContain("ExecStart=/usr/bin/php artisan octane:start --server=roadrunner --port=8005");
  });

  it("cleans project names into valid systemd service names", () => {
    const manager = new SystemdManager();
    expect(manager.getServiceNameFor("My Application.API", "queue")).toBe(
      "orkestra-my-application-api-queue.service"
    );
  });
});
