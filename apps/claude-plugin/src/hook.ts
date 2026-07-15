#!/usr/bin/env node
import { detectCandidate, type Candidate } from "./detect.js"
import { isDenylistedPath } from "./denylist.js"
import { callMcpJson } from "./mcp-client.js"
import { recordEdit, wasEditedThisSession, cleanupOldSessions } from "./session-store.js"
import { logSubstitution } from "./audit-log.js"
import { extractCompressibleText, buildUpdatedResponse, substituteString, charsToTokens } from "./substitute.js"

interface HookInput {
  hook_event_name?: string
  session_id?: string
  cwd?: string
  tool_name?: string
  tool_input?: Record<string, any>
  tool_response?: unknown
  tool_output?: unknown
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf-8")
}

function buildMcpCall(candidate: Candidate, cwd: string, output: string): { tool: string; args: Record<string, unknown> } {
  switch (candidate.kind) {
    case "read":
      return { tool: "cm_read_snippet", args: { path: cwd, filePath: candidate.path } }
    case "compress":
      return { tool: "cm_compress_output", args: { toolID: candidate.toolID, output } }
  }
}

async function main(): Promise<void> {
  let input: HookInput
  try {
    input = JSON.parse(await readStdin())
  } catch {
    return // malformed stdin — fail-open, don't touch anything
  }

  const eventName = input.hook_event_name
  const cwd = input.cwd || process.cwd()
  const sessionId = input.session_id || ""

  if (eventName === "SessionStart") {
    cleanupOldSessions()
    await callMcpJson("cm_analyze", { path: cwd })
    return
  }

  if (eventName !== "PostToolUse") return

  const toolName = input.tool_name || ""
  const toolInput = input.tool_input || {}

  // Not a substitution target — just remember the path so a later Read in
  // this same session doesn't get an index snippet that predates the edit.
  if (toolName === "Write" || toolName === "Edit") {
    const path = toolInput.file_path
    if (path) recordEdit(sessionId, path)
    return
  }

  const candidate = detectCandidate(toolName, toolInput, cwd)
  if (!candidate) return

  if (candidate.path && isDenylistedPath(candidate.path)) return
  if (candidate.kind === "read" && candidate.path && wasEditedThisSession(sessionId, candidate.path)) return

  const originalText = extractCompressibleText(toolName, input.tool_response)
  if (!originalText) return

  const mcpCall = buildMcpCall(candidate, cwd, originalText)
  const result = await callMcpJson(mcpCall.tool, mcpCall.args)
  if (typeof result !== "string" || result.length === 0) return // fail-open
  if (result.length >= originalText.length) return // not actually smaller, skip

  const compressed = substituteString(originalText, result)
  const updatedResponse = buildUpdatedResponse(toolName, input.tool_response, compressed)
  if (!updatedResponse) return // couldn't reconstruct a valid shape — skip rather than risk a rejected substitution

  logSubstitution({
    ts: new Date().toISOString(),
    sessionId,
    toolName,
    path: candidate.path,
    originalChars: originalText.length,
    substituteChars: compressed.length,
  })

  // Feeds the CodeNexum app's own dashboard (it broadcasts this over SSE and
  // invalidates its stats cache) — without this call our savings are only
  // visible in our own audit.log, never in the app's UI. callMcpJson never
  // throws (fails closed to null internally), so this can't block or fail
  // the substitution above — worst case it just adds up to 300ms.
  await callMcpJson("cm_log_event", {
    projectDir: cwd,
    eventType: candidate.kind === "read" ? "index_substitute" : "compression",
    tokensSaved: charsToTokens(originalText.length - compressed.length),
    meta: { tool: toolName, path: candidate.path, toolID: candidate.toolID, sessionId },
  })

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: updatedResponse,
    },
  }))
}

main()
  .catch(() => { /* fail-open: never crash-block the tool call */ })
  .finally(() => process.exit(0))
