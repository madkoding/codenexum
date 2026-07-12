import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "fs"
import { join } from "path"

const HOME = process.env.HOME || "/tmp"
const OPENCODE_DIR = join(HOME, ".config", "opencode")
const PLUGIN_DIR = join(OPENCODE_DIR, "plugins")
const SKILL_DIR = join(OPENCODE_DIR, "skills", "context-manager")
const SKILL_DST = join(SKILL_DIR, "SKILL.md")

// ── Repo discovery ──

function findRepoDir(): string | null {
  const envRepo = process.env.CONTEXT_MANAGER_REPO
  if (envRepo && existsSync(join(envRepo, "src", "plugin.ts"))) return envRepo
  for (const dir of [
    join(process.cwd(), "..", "opencode-context-manager"),
    join(HOME, "proyectos", "opencode-context-manager"),
    join(HOME, "projects", "opencode-context-manager"),
    join(HOME, "dev", "opencode-context-manager"),
  ]) {
    if (existsSync(join(dir, "src", "plugin.ts"))) return dir
  }
  return null
}

// ── Skill installation ──

function ensureSkill(skillSrc: string) {
  if (!existsSync(skillSrc)) return
  if (existsSync(SKILL_DST) && readFileSync(SKILL_DST, "utf8") === readFileSync(skillSrc, "utf8")) return
  if (!existsSync(SKILL_DIR)) mkdirSync(SKILL_DIR, { recursive: true })
  copyFileSync(skillSrc, SKILL_DST)
}

// ── Main entry ──

const plugin: Plugin = async (input, options) => {
  const client = (input as any)?.client

  // Defer to avoid blocking TUI startup
  await new Promise(resolve => setImmediate(resolve))

  const repoDir = findRepoDir()

  if (repoDir) {
    ensureSkill(join(repoDir, "skills", "context-manager", "SKILL.md"))
    const mod = await import(join(repoDir, "src", "plugin.ts"))
    return (mod.default ?? mod)(input, options)
  }

  ensureSkill(join(import.meta.dir, "..", "skills", "context-manager", "SKILL.md"))
  const mod = await import("../src/plugin")
  return (mod.default ?? mod)(input, options)
}

export default plugin
