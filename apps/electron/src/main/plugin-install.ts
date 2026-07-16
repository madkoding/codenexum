import { existsSync, writeFileSync, mkdirSync, readFileSync, rmSync, cpSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { createLogger } from "../mcp/logger.js"

const log = createLogger("plugin-install")

export const MCP_KEY = "codenexum"
export const PLUGIN_PACKAGE_NAME = "@codenexum/plugin"
export const LEGACY_PLUGIN_NAME = "@madtech/opencode-context-manager-plugin"

const EXCLUDED_PLUGIN_FILES = new Set(["index.bundled.js", "index.d.ts", "index.d.mts"])
const HASH_EXCLUDED_FILES = new Set(["index.d.ts", "index.d.mts"])
const MANIFEST_FILENAME = ".codenexum-install.json"

export interface PluginInstallPaths {
  pluginSrc: string
  pluginBundled: string
  pluginPkg: string
  opencodeDir: string
  opencodePluginsDir: string
  oldPluginDir: string
  appVersion: string
}

export interface PluginInstallResult {
  status: "installed" | "up-to-date" | "skipped"
  reason?: string
  configPath?: string
}

function tryReadFile(path: string): string | null {
  try { return readFileSync(path, "utf-8") } catch { return null }
}

function readOpencodeConfig(cp: string): any | null {
  if (!existsSync(cp)) return null
  const raw = tryReadFile(cp)
  if (!raw) return null
  try {
    const json = raw
      .replace(/^(\s*)\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[}\]])/g, "$1")
    return JSON.parse(json)
  } catch (e) {
    log.warn("could not parse opencode config", { path: cp, error: (e as Error)?.message || String(e) })
    return null
  }
}

function writeOpencodeConfig(cp: string, cfg: any): void {
  writeFileSync(cp, JSON.stringify(cfg, null, 2) + "\n")
}

function pickOpencodeConfigPath(opencodeDir: string): { path: string; cfg: any | null } {
  const jsonPath = join(opencodeDir, "opencode.json")
  const jsoncPath = join(opencodeDir, "opencode.jsonc")
  if (existsSync(jsonPath)) return { path: jsonPath, cfg: readOpencodeConfig(jsonPath) }
  if (existsSync(jsoncPath)) return { path: jsoncPath, cfg: readOpencodeConfig(jsoncPath) }
  return { path: jsonPath, cfg: null }
}

export function syncMcpEntry(cfg: any, mcpEntry: any): { cfg: any; changed: boolean } {
  if (!cfg.mcp || typeof cfg.mcp !== "object") cfg.mcp = {}
  const existing = cfg.mcp[MCP_KEY]
  if (!existing || existing.url !== mcpEntry.url || existing.enabled === false) {
    cfg.mcp[MCP_KEY] = mcpEntry
    return { cfg, changed: true }
  }
  return { cfg, changed: false }
}

export function syncPluginEntry(cfg: any): { cfg: any; changed: boolean } {
  const plugins: string[] = Array.isArray(cfg.plugin) ? cfg.plugin : []
  const filtered = plugins.filter((p: string) => p !== LEGACY_PLUGIN_NAME)
  if (!filtered.includes(PLUGIN_PACKAGE_NAME)) {
    filtered.push(PLUGIN_PACKAGE_NAME)
    cfg.plugin = filtered
    return { cfg, changed: true }
  }
  if (filtered.length !== plugins.length) {
    cfg.plugin = filtered
    return { cfg, changed: true }
  }
  return { cfg, changed: false }
}

function hashDir(path: string): string {
  if (!existsSync(path)) return "missing"
  const hash = createHash("sha1")
  for (const f of readdirSync(path).sort()) {
    if (HASH_EXCLUDED_FILES.has(f)) continue
    const full = join(path, f)
    try {
      const stat = readFileSync(full)
      hash.update(f)
      hash.update(stat)
    } catch { /* ignore unreadable files */ }
  }
  return hash.digest("hex").slice(0, 16)
}

function readManifest(pluginDir: string): { hash?: string; version?: string } | null {
  const raw = tryReadFile(join(pluginDir, MANIFEST_FILENAME))
  if (!raw) return null
  try { return JSON.parse(raw) as { hash?: string; version?: string } } catch { return null }
}

function writeManifest(pluginDir: string, hash: string, version: string): void {
  writeFileSync(join(pluginDir, MANIFEST_FILENAME), JSON.stringify({ hash, version }, null, 2) + "\n")
}

function pluginEntryIsHealthy(paths: PluginInstallPaths): boolean {
  if (!existsSync(paths.opencodePluginsDir)) return false
  const indexJs = join(paths.opencodePluginsDir, "index.js")
  const pkgJson = join(paths.opencodePluginsDir, "package.json")
  if (!existsSync(indexJs) || !existsSync(pkgJson)) return false
  const manifest = readManifest(paths.opencodePluginsDir)
  if (!manifest || !manifest.hash || !manifest.version) return false
  const currentHash = hashDir(paths.pluginSrc)
  return manifest.hash === currentHash && manifest.version === paths.appVersion
}

function installPluginFiles(paths: PluginInstallPaths): { ok: boolean; reason?: string } {
  const bundledExists = existsSync(paths.pluginBundled)
  const fallbackExists = existsSync(join(paths.pluginSrc, "index.js"))
  if (!bundledExists && !fallbackExists) {
    return { ok: false, reason: `No plugin entry in ${paths.pluginSrc}` }
  }

  if (existsSync(paths.opencodePluginsDir)) {
    rmSync(paths.opencodePluginsDir, { recursive: true, force: true })
  }
  mkdirSync(paths.opencodePluginsDir, { recursive: true })

  for (const f of readdirSync(paths.pluginSrc)) {
    if (EXCLUDED_PLUGIN_FILES.has(f)) continue
    cpSync(join(paths.pluginSrc, f), join(paths.opencodePluginsDir, f), { recursive: true })
  }

  const source = bundledExists ? paths.pluginBundled : join(paths.pluginSrc, "index.js")
  if (!bundledExists) {
    log.warn("bundled plugin not found — using unbundled dist", { path: paths.pluginBundled })
  }
  cpSync(source, join(paths.opencodePluginsDir, "index.js"))

  if (existsSync(paths.pluginPkg)) {
    const pkg = JSON.parse(readFileSync(paths.pluginPkg, "utf-8"))
    delete pkg.dependencies
    delete pkg.devDependencies
    writeFileSync(join(paths.opencodePluginsDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n")
  } else {
    writeFileSync(
      join(paths.opencodePluginsDir, "package.json"),
      JSON.stringify(
        { name: PLUGIN_PACKAGE_NAME, version: paths.appVersion, type: "module", main: "./index.js" },
        null,
        2,
      ) + "\n",
    )
  }

  writeManifest(paths.opencodePluginsDir, hashDir(paths.pluginSrc), paths.appVersion)
  return { ok: true }
}

export function installOpencodePlugin(
  paths: PluginInstallPaths,
  options: { mcpPort: number; force?: boolean; opencodeAlreadyRunning?: boolean } = { mcpPort: 7770 },
): PluginInstallResult {
  if (!existsSync(paths.pluginSrc)) {
    log.warn("plugin dist not found — skipping install", { path: paths.pluginSrc })
    return { status: "skipped", reason: "plugin-src-missing" }
  }
  if (!existsSync(paths.opencodeDir)) {
    log.warn("opencode config not found — skipping install", { path: paths.opencodeDir })
    return { status: "skipped", reason: "opencode-config-missing" }
  }

  if (existsSync(paths.oldPluginDir)) {
    rmSync(paths.oldPluginDir, { recursive: true, force: true })
    log.info("removed old plugin", { path: paths.oldPluginDir })
  }

  const mcpUrl = `http://127.0.0.1:${options.mcpPort}`
  const mcpEntry = { type: "remote", url: mcpUrl, enabled: true }
  const { path: targetConfig, cfg: existingCfg } = pickOpencodeConfigPath(paths.opencodeDir)
  const cfg = existingCfg ?? { plugin: [] as string[], mcp: {} as Record<string, any> }

  const mcpSync = syncMcpEntry(cfg, mcpEntry)
  const pluginSync = syncPluginEntry(mcpSync.cfg)

  const cfgNeedsWrite = mcpSync.changed || pluginSync.changed || !existingCfg
  const pluginHealthy = pluginEntryIsHealthy(paths)
  const pluginNeedsInstall = !pluginHealthy || options.force === true

  if (!pluginNeedsInstall && !cfgNeedsWrite) {
    log.info("plugin + opencode config already up to date")
    if (options.opencodeAlreadyRunning) {
      log.warn("opencode is already running — restart for changes to take effect")
    }
    return { status: "up-to-date", configPath: targetConfig }
  }

  if (pluginNeedsInstall) {
    const result = installPluginFiles(paths)
    if (!result.ok) {
      log.error("install aborted", { reason: result.reason })
      return { status: "skipped", reason: result.reason, configPath: targetConfig }
    }
    log.info("plugin installed", { path: paths.opencodePluginsDir })
    if (options.opencodeAlreadyRunning) {
      log.warn("opencode is already running — restart to load new plugin")
    }
  }

  if (cfgNeedsWrite) {
    writeOpencodeConfig(targetConfig, pluginSync.cfg)
    if (!existingCfg) {
      log.info("created opencode config", { path: targetConfig })
    } else {
      const changes: string[] = []
      if (mcpSync.changed) changes.push("MCP entry")
      if (pluginSync.changed) changes.push("@codenexum/plugin")
      log.info("updated opencode config", { path: targetConfig, changes: changes.join(" and ") || "no-op" })
    }
  }

  return { status: "installed", configPath: targetConfig }
}

export function updateMcpConfig(paths: Pick<PluginInstallPaths, "opencodeDir">, port: number): void {
  const mcpUrl = `http://127.0.0.1:${port}`
  const mcpEntry = { type: "remote", url: mcpUrl, enabled: true }
  const candidates = [join(paths.opencodeDir, "opencode.json"), join(paths.opencodeDir, "opencode.jsonc")]
  for (const cp of candidates) {
    const cfg = readOpencodeConfig(cp)
    if (!cfg) continue
    const mcpSync = syncMcpEntry(cfg, mcpEntry)
    if (mcpSync.changed) {
      writeOpencodeConfig(cp, mcpSync.cfg)
      log.info("MCP config updated", { port, path: cp })
    }
  }
}

export function writeMcpConfigFile(path: string, port: number): void {
  const dir = join(path, "..")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify({ port, url: `http://127.0.0.1:${port}` }, null, 2) + "\n")
}
