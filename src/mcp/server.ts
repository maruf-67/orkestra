import { MCP_TOOLS, handleMcpToolCall } from "./tools.js";
import { createInterface } from "node:readline";

export class OrkestraMcpServer {
  start(): void {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      try {
        const req = JSON.parse(trimmed);
        const res = await this.handleRequest(req);
        if (res) {
          process.stdout.write(JSON.stringify(res) + "\n");
        }
      } catch (err: any) {
        const errorRes = {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Parse error",
            data: err.message,
          },
        };
        process.stdout.write(JSON.stringify(errorRes) + "\n");
      }
    });
  }

  private async handleRequest(req: any): Promise<any> {
    const { id, method, params } = req;

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "orkestra-mcp-server",
            version: "1.0.0",
          },
        },
      };
    }

    if (method === "notifications/initialized") {
      return null;
    }

    if (method === "ping") {
      return {
        jsonrpc: "2.0",
        id,
        result: {},
      };
    }

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: MCP_TOOLS,
        },
      };
    }

    if (method === "tools/call") {
      const { name, arguments: toolArgs } = params || {};
      try {
        const result = await handleMcpToolCall(name, toolArgs || {});
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      } catch (err: any) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error executing ${name}: ${err.message}`,
              },
            ],
          },
        };
      }
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  }
}
