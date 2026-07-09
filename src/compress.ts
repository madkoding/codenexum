// Output compression for tool results before they hit the LLM context.
// Applied via the tool.execute.after hook to read/bash/grep/glob outputs.

function getMaxLines(): number {
  return parseInt(process.env.CONTEXT_MANAGER_TOOL_MAX_LINES || "200", 10)
}

export function compressToolOutput(toolID: string, output: string): string {
  if (!output) return output
  if (!["read", "bash", "grep", "glob"].includes(toolID)) return output
  const lines = output.split("\n")
  const max = getMaxLines()
  if (lines.length <= max) return output
  const kept = lines.slice(0, max)
  const dropped = lines.length - max
  return kept.join("\n") + `\n… (${dropped} more lines omitted; rerun with narrower args if needed)`
}