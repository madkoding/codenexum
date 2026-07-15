import { existsSync, readFileSync } from "fs"
import { join } from "path"

const HOME = process.env.HOME || "/tmp"
const MCP_CONFIG_PATH = join(HOME, ".config", "codenexum", "mcp.json")

// Kept short on purpose: this hook blocks the tool call it's attached to, so
// a slow/hung CodeNexum app must never stall the user's Read/Grep/Bash.
const FETCH_TIMEOUT_MS = 300

export function getMcpUrl(): string | null {
  if (process.env.CODENEXUM_MCP_URL) return process.env.CODENEXUM_MCP_URL
  if (existsSync(MCP_CONFIG_PATH)) {
    try {
      const cfg = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8"))
      return cfg.url || `http://127.0.0.1:${cfg.port}`
    } catch {
      /* ignore malformed config, fall through to null */
    }
  }
  return null
}

// Returns the raw `result` field on success, or null on any failure
// (server not running, timeout, non-2xx, malformed JSON) — callers must
// treat null as "leave the original tool output untouched".
export async function callMcpJson(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const url = getMcpUrl()
  if (!url) return null
  try {
    const res = await fetch(`${url}/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: toolName, args }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { result?: unknown }
    return data.result ?? null
  } catch {
    return null
  }
}
