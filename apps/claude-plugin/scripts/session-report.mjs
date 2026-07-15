#!/usr/bin/env node
// Summarizes ~/.codenexum/audit.log by Claude Code session — the app's own
// dashboard only shows cumulative per-project totals, with no session-level
// breakdown. Usage:
//   node scripts/session-report.mjs            -> table of all sessions, most recent first
//   node scripts/session-report.mjs <sessionId> -> per-substitution detail for one session
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const AUDIT_LOG_PATH = join(homedir(), ".codenexum", "audit.log")

// Mirrors src/substitute.ts's charsToTokens — duplicated here since this is
// a standalone script, not part of the compiled hook bundle.
function charsToTokens(chars) {
  return chars > 0 ? Math.max(0, Math.round(chars / 4)) : 0
}

function readEntries() {
  if (!existsSync(AUDIT_LOG_PATH)) return []
  return readFileSync(AUDIT_LOG_PATH, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function groupBySession(entries) {
  const sessions = new Map()
  for (const e of entries) {
    const id = e.sessionId || "(unknown)"
    if (!sessions.has(id)) {
      sessions.set(id, { sessionId: id, entries: [], tokensSaved: 0, tools: new Set(), firstTs: e.ts, lastTs: e.ts })
    }
    const s = sessions.get(id)
    s.entries.push(e)
    s.tokensSaved += charsToTokens((e.originalChars || 0) - (e.substituteChars || 0))
    s.tools.add(e.toolName)
    if (e.ts < s.firstTs) s.firstTs = e.ts
    if (e.ts > s.lastTs) s.lastTs = e.ts
  }
  return [...sessions.values()].sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1))
}

function pad(str, width) {
  str = String(str)
  return str.length >= width ? str.slice(0, width - 1) + "…" : str.padEnd(width)
}

function printSummary(sessions) {
  if (sessions.length === 0) {
    console.log("No substitutions recorded yet in", AUDIT_LOG_PATH)
    return
  }
  console.log(pad("SESSION", 38), pad("LAST ACTIVITY", 21), pad("SUBS", 6), pad("TOKENS SAVED", 13), "TOOLS")
  let totalSubs = 0
  let totalTokens = 0
  for (const s of sessions) {
    console.log(
      pad(s.sessionId, 38),
      pad(s.lastTs, 21),
      pad(s.entries.length, 6),
      pad(s.tokensSaved, 13),
      [...s.tools].join(", "),
    )
    totalSubs += s.entries.length
    totalTokens += s.tokensSaved
  }
  console.log()
  console.log(`${sessions.length} session(s), ${totalSubs} substitution(s), ${totalTokens} token(s) saved total.`)
  console.log("Run with a session id (or a unique prefix of one) to see per-file/command detail.")
}

function printDetail(sessions, needle) {
  const matches = sessions.filter((s) => s.sessionId.startsWith(needle))
  if (matches.length === 0) {
    console.log(`No session found matching "${needle}".`)
    return
  }
  for (const s of matches) {
    console.log(`Session ${s.sessionId} (${s.entries.length} substitution(s), ${s.tokensSaved} tokens saved)\n`)
    for (const e of s.entries) {
      const saved = charsToTokens((e.originalChars || 0) - (e.substituteChars || 0))
      const target = e.path || "(bash output)"
      console.log(`  ${e.ts}  ${pad(e.toolName, 6)} ${target}`)
      console.log(`    ${e.originalChars} -> ${e.substituteChars} chars  (+${saved} tokens)`)
    }
    console.log()
  }
}

const entries = readEntries()
const sessions = groupBySession(entries)
const needle = process.argv[2]

if (needle) {
  printDetail(sessions, needle)
} else {
  printSummary(sessions)
}
