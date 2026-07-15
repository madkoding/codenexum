import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, readdirSync, statSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  installHook,
  buildSettings,
  hasOurCommand,
  cleanOldBackups,
  settingsEqual,
  MATCHER,
  BACKUP_PREFIX,
} from "../src/install"

let root: string
let hookSrc: string
let hookInstallDir: string
let hookInstallPath: string
let projectDir: string
let claudeDir: string
let settingsPath: string
const HOOK_COMMAND = "node /test/hook.mjs"

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codenexum-cp-"))
  hookSrc = join(root, "hook-dist", "hook.mjs")
  hookInstallDir = join(root, ".codenexum")
  hookInstallPath = join(hookInstallDir, "hook.mjs")
  projectDir = join(root, "test-project")
  claudeDir = join(projectDir, ".claude")
  settingsPath = join(claudeDir, "settings.json")
  mkdirSync(join(root, "hook-dist"), { recursive: true })
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(hookSrc, "// hook v1\n")
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function installAll(opts: { force?: boolean } = {}) {
  return installHook(
    {
      hookSrc,
      hookInstallDir,
      hookInstallPath,
      hookCommand: HOOK_COMMAND,
      projectDir,
      claudeDir,
      settingsPath,
    },
    opts,
  )
}

test("first run copies hook and writes settings", () => {
  const r = installAll()
  expect(r.hookCopied).toBe(true)
  expect(r.settingsWritten).toBe(true)
  expect(r.hooksAlreadyPresent).toBe(false)
  expect(readFileSync(hookInstallPath, "utf-8")).toBe("// hook v1\n")
  expect(readFileSync(hookInstallPath, "utf-8")).toBe("// hook v1\n")
  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"))
  expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(HOOK_COMMAND)
  expect(settings.hooks.PostToolUse[0].matcher).toBe(MATCHER)
  expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe(HOOK_COMMAND)
})

test("second run with no changes is a no-op", () => {
  installAll()
  const settingsBefore = readFileSync(settingsPath, "utf-8")
  const hookMtimeBefore = statSync(hookInstallPath).mtimeMs
  const r = installAll()
  expect(r.hookCopied).toBe(false)
  expect(r.settingsWritten).toBe(false)
  expect(r.hooksAlreadyPresent).toBe(true)
  expect(readFileSync(settingsPath, "utf-8")).toBe(settingsBefore)
  const hookMtimeAfter = statSync(hookInstallPath).mtimeMs
  expect(hookMtimeAfter).toBe(hookMtimeBefore)
})

test("changes to hook source trigger reinstall", () => {
  installAll()
  writeFileSync(hookSrc, "// hook v2 — updated\n")
  const r = installAll()
  expect(r.hookCopied).toBe(true)
  expect(r.settingsWritten).toBe(false)
  expect(readFileSync(hookInstallPath, "utf-8")).toBe("// hook v2 — updated\n")
})

test("--force reinstalls even when nothing changed", () => {
  installAll()
  const r = installAll({ force: true })
  expect(r.hookCopied).toBe(true)
  expect(r.settingsWritten).toBe(true)
  expect(r.backupCreated).toBe(true)
})

test("old .bak.* backups are cleaned before a new one is created", () => {
  installAll()
  installAll({ force: true })
  installAll({ force: true })
  installAll({ force: true })
  const backups = readdirSync(claudeDir).filter(f => f.startsWith(`settings.json${BACKUP_PREFIX}`))
  expect(backups.length).toBe(1)
})

test("preserves unrelated settings keys", () => {
  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(settingsPath, JSON.stringify({
    theme: "dark",
    permissions: { allow: ["Bash(ls:*)"] },
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "other-tool init" }] }] },
  }))
  installAll()
  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"))
  expect(settings.theme).toBe("dark")
  expect(settings.permissions).toEqual({ allow: ["Bash(ls:*)"] })
  expect(settings.hooks.SessionStart.length).toBe(2)
  expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("other-tool init")
  expect(settings.hooks.SessionStart[1].hooks[0].command).toBe(HOOK_COMMAND)
})

test("does not duplicate entries if the command is already present", () => {
  installAll()
  installAll()
  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"))
  const sessionCount = settings.hooks.SessionStart.filter((g: any) =>
    g.hooks?.some((h: any) => h.command === HOOK_COMMAND),
  ).length
  const postCount = settings.hooks.PostToolUse.filter((g: any) =>
    g.hooks?.some((h: any) => h.command === HOOK_COMMAND),
  ).length
  expect(sessionCount).toBe(1)
  expect(postCount).toBe(1)
})

test("fails when hook source does not exist", () => {
  rmSync(hookSrc)
  expect(() => installAll()).toThrow(/built hook not found/)
})

test("fails when project directory does not exist", () => {
  rmSync(projectDir, { recursive: true, force: true })
  expect(() => installAll()).toThrow(/project path does not exist/)
})

test("recreates claude dir if missing", () => {
  installAll()
  rmSync(claudeDir, { recursive: true, force: true })
  expect(existsSync(claudeDir)).toBe(false)
  installAll()
  expect(existsSync(claudeDir)).toBe(true)
  expect(existsSync(settingsPath)).toBe(true)
})

test("hasOurCommand matches by command string", () => {
  expect(hasOurCommand([{ hooks: [{ command: "x" }] }], "x")).toBe(true)
  expect(hasOurCommand([{ hooks: [{ command: "y" }] }], "x")).toBe(false)
  expect(hasOurCommand([], "x")).toBe(false)
  expect(hasOurCommand(null as any, "x")).toBe(false)
})

test("buildSettings adds both hook groups when none present", () => {
  const s = buildSettings({}, HOOK_COMMAND)
  expect(s.hooks.SessionStart).toHaveLength(1)
  expect(s.hooks.PostToolUse).toHaveLength(1)
  expect(s.hooks.PostToolUse[0].matcher).toBe(MATCHER)
})

test("buildSettings is no-op when our command is already there", () => {
  const s = buildSettings({}, HOOK_COMMAND)
  const s2 = buildSettings(s, HOOK_COMMAND)
  expect(settingsEqual(s, s2)).toBe(true)
})

test("cleanOldBackups removes only matching files", () => {
  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(settingsPath, "{}")
  writeFileSync(join(claudeDir, `settings.json${BACKUP_PREFIX}1`), "x")
  writeFileSync(join(claudeDir, `settings.json${BACKUP_PREFIX}2`), "x")
  writeFileSync(join(claudeDir, "other.json"), "x")
  const removed = cleanOldBackups(settingsPath)
  expect(removed).toBe(2)
  expect(existsSync(join(claudeDir, "other.json"))).toBe(true)
  expect(readdirSync(claudeDir).filter(f => f.startsWith(`settings.json${BACKUP_PREFIX}`))).toHaveLength(0)
})

test("settingsEqual compares structurally", () => {
  expect(settingsEqual({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(true)
  expect(settingsEqual({ a: 1 }, { a: 2 })).toBe(false)
  expect(settingsEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
})
