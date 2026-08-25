import { OrkestraMcpServer } from "../mcp/server.js";

export async function mcp() {
  const server = new OrkestraMcpServer();
  server.start();
}
