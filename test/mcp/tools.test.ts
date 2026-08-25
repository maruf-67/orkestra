import { describe, it, expect } from "vitest";
import { MCP_TOOLS, handleMcpToolCall } from "../../src/mcp/tools.js";

describe("MCP Tools & Handlers", () => {
  it("defines all required deployment tools", () => {
    const toolNames = MCP_TOOLS.map((t) => t.name);
    expect(toolNames).toContain("orkestra_deploy");
    expect(toolNames).toContain("orkestra_status");
    expect(toolNames).toContain("orkestra_services_status");
    expect(toolNames).toContain("orkestra_services_action");
    expect(toolNames).toContain("orkestra_logs");
    expect(toolNames).toContain("orkestra_health_check");
    expect(toolNames).toContain("orkestra_rollback");
  });

  it("handles orkestra_status tool call", async () => {
    const result = await handleMcpToolCall("orkestra_status", {});
    expect(Array.isArray(result)).toBe(true);
  });

  it("throws error for unknown tool", async () => {
    await expect(handleMcpToolCall("non_existent_tool", {})).rejects.toThrow(
      "Unknown MCP tool: non_existent_tool"
    );
  });
});
