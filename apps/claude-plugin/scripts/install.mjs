#!/usr/bin/env node
// Installs the Claude Code hook for a SINGLE project (.claude/settings.json
// of that project), on purpose — NOT ~/.claude/settings.json. This is meant
// to be validated on one test repo before anyone considers a global install.
import { existsSync, mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"
import { homedir } from "os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK_SRC = resolve(__dirname, "..", "dist", "hook.mjs")
const HOOK_INSTALL_DIR = join(homedir(), ".codenexum")
const HOOK_INSTALL_PATH = join(HOOK_INSTALL_DIR, "hook.mjs")
const HOOK_COMMAND = `node ${HOOK_INSTALL_PATH}`
const MATCHER = "Read|Grep|Glob|Bash|Write|Edit"

function fail(msg) {
  console.error(`error: ${msg}`)
  process.exit(1)
}

const targetProject = process.argv[2]
if (!targetProject) {
  fail("usage: node scripts/install.mjs <path-to-test-project>\n\n" +
    "This installs the hook ONLY for that one project's .claude/settings.json.\n" +
    "It intentionally does NOT touch ~/.claude/settings.json (global) — see apps/claude-plugin/README.md.")
}

const projectDir = resolve(targetProject)
if (!existsSync(projectDir)) fail(`project path does not exist: ${projectDir}`)
if (!existsSync(HOOK_SRC)) fail(`built hook not found at ${HOOK_SRC} — run "bun run build && bun run bundle" first`)

mkdirSync(HOOK_INSTALL_DIR, { recursive: true })
copyFileSync(HOOK_SRC, HOOK_INSTALL_PATH)
chmodSync(HOOK_INSTALL_PATH, 0o755)
console.log(`copied hook to ${HOOK_INSTALL_PATH}`)

const claudeDir = join(projectDir, ".claude")
mkdirSync(claudeDir, { recursive: true })
const settingsPath = join(claudeDir, "settings.json")

let settings = {}
if (existsSync(settingsPath)) {
  const backupPath = `${settingsPath}.bak.${Date.now()}`
  copyFileSync(settingsPath, backupPath)
  console.log(`backed up existing settings to ${backupPath}`)
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"))
  } catch {
    fail(`existing ${settingsPath} is not valid JSON — fix or remove it before installing`)
  }
}

settings.hooks ||= {}

function hasOurCommand(entries) {
  return entries.some((group) => (group.hooks || []).some((h) => h.command === HOOK_COMMAND))
}

// SessionStart: fire cm_analyze once per session, no matcher needed.
settings.hooks.SessionStart ||= []
if (!hasOurCommand(settings.hooks.SessionStart)) {
  settings.hooks.SessionStart.push({ hooks: [{ type: "command", command: HOOK_COMMAND }] })
}

// PostToolUse: the substitution path.
settings.hooks.PostToolUse ||= []
if (!hasOurCommand(settings.hooks.PostToolUse)) {
  settings.hooks.PostToolUse.push({ matcher: MATCHER, hooks: [{ type: "command", command: HOOK_COMMAND }] })
}

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n")
console.log(`updated ${settingsPath}`)
console.log("\nDone. This hook is registered ONLY for this project.")
console.log("Make sure the CodeNexum Electron app is running, then open Claude Code in this project.")
console.log(`Substitutions get logged to ${join(homedir(), ".codenexum", "audit.log")}`)
