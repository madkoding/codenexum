import { startMcpServer } from "./server.js"

export function startContextManagerMcp(port?: number) {
  return startMcpServer(port)
}

export { startMcpServer as McpServer } from "./server.js"
