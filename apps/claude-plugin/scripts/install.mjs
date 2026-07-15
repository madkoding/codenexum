#!/usr/bin/env node
// Installs the Claude Code hook for a SINGLE project (.claude/settings.json
// of that project), on purpose — NOT ~/.claude/settings.json. This is meant
// to be validated on one test repo before anyone considers a global install.
//
// Idempotent: re-running it is a no-op when the hook content and the
// settings.json state are already correct. Use --force to reinstall.
import { existsSync, mkdirSync, readFileSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"
import { homedir } from "os"
import { spawnSync } from "child_process"
import { installHook, type InstallResult } from "../dist/install.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const HOOK_SRC = resolve(__dirname, "..", "dist", "hook.mjs")
const HOOK_INSTALL_DIR = join(homedir(), ".codenexum")
const HOOK_INSTALL_PATH = join(HOOK_INSTALL_DIR, "hook.mjs")
const HOOK_COMMAND = `node ${HOOK_INSTALL_PATH}`

function fail(msg, code = 1) {
  console.error(`error: ${msg}`)
  process.exit(code)
}

const targetProject = process.argv[2]
const force = process.argv.includes("--force")

if (!targetProject) {
  fail(
    "usage: node scripts/install.mjs <path-to-test-project> [--force]\n\n" +
      "This installs the hook ONLY for that one project's .claude/settings.json.\n" +
      "It intentionally does NOT touch ~/.claude/settings.json (global) — see apps/claude-plugin/README.md.",
  )
}

const projectDir = resolve(targetProject)
if (!existsSync(projectDir)) fail(`project path does not exist: ${projectDir}`)
if (!existsSync(HOOK_SRC)) fail(`built hook not found at ${HOOK_SRC} — run "bun run build && bun run bundle" first`)
if (!existsSync(join(__dirname, "..", "dist", "install.js"))) {
  fail(`install logic not found at dist/install.js — run "bun run build" first`)
}

const claudeDir = join(projectDir, ".claude")
const settingsPath = join(claudeDir, "settings.json")

let result: InstallResult
try {
  result = installHook(
    {
      hookSrc: HOOK_SRC,
      hookInstallDir: HOOK_INSTALL_DIR,
      hookInstallPath: HOOK_INSTALL_PATH,
      hookCommand: HOOK_COMMAND,
      projectDir,
      claudeDir,
      settingsPath,
    },
    { force },
  )
} catch (e) {
  fail(e instanceof Error ? e.message : String(e))
}

if (result.hookCopied) {
  console.log(`copied hook to ${HOOK_INSTALL_PATH}`)
} else {
  console.log(`hook already up to date at ${HOOK_INSTALL_PATH}`)
}

if (result.settingsWritten) {
  console.log(`updated ${settingsPath}${result.backupCreated === true ? " (previous backed up)" : ""}`)
} else {
  console.log(`${settingsPath} already up to date`)
}

if (isClaudeProcessRunning()) {
  console.warn(
    "\nwarning: a Claude Code process appears to be running. " +
      "Existing sessions will not reload the updated hook — start a new Claude Code session in this project to pick up the changes.",
  )
}

console.log("\nDone. This hook is registered ONLY for this project.")
console.log("Make sure the CodeNexum Electron app is running, then open Claude Code in this project.")
console.log(`Substitutions get logged to ${join(homedir(), ".codenexum", "audit.log")}`)

function isClaudeProcessRunning() {
  try {
    const res = spawnSync("pgrep", ["-fl", "claude"], { encoding: "utf-8" })
    if (res.status === 0 && /\bclaude\b/i.test(res.stdout)) return true
  } catch { /* pgrep not on PATH (Windows) */ }
  try {
    const res = spawnSync("tasklist", ["/FI", "IMAGENAME eq claude.exe"], { encoding: "utf-8" })
    if (res.status === 0 && /claude\.exe/i.test(res.stdout)) return true
  } catch { /* tasklist not on PATH */ }
  return false
}
