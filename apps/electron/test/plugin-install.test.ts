import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, readdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  installOpencodePlugin,
  updateMcpConfig,
  writeMcpConfigFile,
  syncMcpEntry,
  syncPluginEntry,
} from "../src/main/plugin-install"

let root: string
let pluginSrc: string
let pluginBundled: string
let pluginPkg: string
let opencodeDir: string
let opencodePluginsDir: string
let oldPluginDir: string
let mcpConfigPath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codenexum-pi-"))
  pluginSrc = join(root, "plugin-dist")
  pluginBundled = join(pluginSrc, "index.bundled.js")
  pluginPkg = join(pluginSrc, "package.json")
  opencodeDir = join(root, "opencode")
  opencodePluginsDir = join(opencodeDir, "plugins", "node_modules", "@codenexum", "plugin")
  oldPluginDir = join(opencodeDir, "plugins", "node_modules", "@madtech", "opencode-context-manager-plugin")
  mcpConfigPath = join(root, "codenexum", "mcp.json")
  mkdirSync(pluginSrc, { recursive: true })
  mkdirSync(opencodeDir, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeFakePlugin(version: string): void {
  writeFileSync(pluginBundled, "export default {}\n")
  writeFileSync(pluginPkg, JSON.stringify({
    name: "@codenexum/plugin",
    version,
    type: "module",
    main: "./index.bundled.js",
    dependencies: { "@opencode-ai/plugin": "^1.0.0" },
    devDependencies: { typescript: "^5" },
  }))
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf-8"))
}

test("skips when plugin src is missing", () => {
  const r = installOpencodePlugin({
    pluginSrc: join(root, "no-such-plugin-src"),
    pluginBundled,
    pluginPkg,
    opencodeDir,
    opencodePluginsDir,
    oldPluginDir,
    appVersion: "0.99.9",
  }, { mcpPort: 7770 })
  expect(r.status).toBe("skipped")
  expect(r.reason).toBe("plugin-src-missing")
})

test("skips when opencode config dir is missing", () => {
  writeFakePlugin("0.99.9")
  const r = installOpencodePlugin({
    pluginSrc,
    pluginBundled,
    pluginPkg,
    opencodeDir: join(root, "no-such-opencode"),
    opencodePluginsDir,
    oldPluginDir,
    appVersion: "0.99.9",
  }, { mcpPort: 7770 })
  expect(r.status).toBe("skipped")
  expect(r.reason).toBe("opencode-config-missing")
})

test("aborts when no entry file exists in src", () => {
  // no bundled, no index.js
  const r = installOpencodePlugin({
    pluginSrc,
    pluginBundled,
    pluginPkg,
    opencodeDir,
    opencodePluginsDir,
    oldPluginDir,
    appVersion: "0.99.9",
  }, { mcpPort: 7770 })
  expect(r.status).toBe("skipped")
  expect(r.reason).toMatch(/No plugin entry/)
  expect(existsSync(opencodePluginsDir)).toBe(false)
})

test("installs plugin and writes opencode.json with mcp + plugin entries", () => {
  writeFakePlugin("0.99.9")
  const r = installOpencodePlugin({
    pluginSrc,
    pluginBundled,
    pluginPkg,
    opencodeDir,
    opencodePluginsDir,
    oldPluginDir,
    appVersion: "0.99.9",
  }, { mcpPort: 7770 })
  expect(r.status).toBe("installed")
  expect(existsSync(join(opencodePluginsDir, "index.js"))).toBe(true)
  expect(existsSync(join(opencodePluginsDir, "package.json"))).toBe(true)
  const cfg = readJson(join(opencodeDir, "opencode.json"))
  expect(cfg.mcp.codenexum).toEqual({ type: "remote", url: "http://127.0.0.1:7770", enabled: true })
  expect(cfg.plugin).toEqual(["@codenexum/plugin"])
})

test("strips dependencies from installed package.json", () => {
  writeFakePlugin("0.99.9")
  installOpencodePlugin({
    pluginSrc, pluginBundled, pluginPkg,
    opencodeDir, opencodePluginsDir, oldPluginDir,
    appVersion: "0.99.9",
  }, { mcpPort: 7770 })
  const installed = readJson(join(opencodePluginsDir, "package.json"))
  expect(installed.dependencies).toBeUndefined()
  expect(installed.devDependencies).toBeUndefined()
  expect(installed.name).toBe("@codenexum/plugin")
  expect(installed.version).toBe("0.99.9")
})

test("uses unbundled index.js when bundled is missing", () => {
  writeFileSync(join(pluginSrc, "index.js"), "export default {}\n")
  writeFileSync(pluginPkg, JSON.stringify({ name: "@codenexum/plugin", version: "0.99.9", type: "module" }))
  const r = installOpencodePlugin({
    pluginSrc, pluginBundled, pluginPkg,
    opencodeDir, opencodePluginsDir, oldPluginDir,
    appVersion: "0.99.9",
  }, { mcpPort: 7770 })
  expect(r.status).toBe("installed")
  expect(existsSync(join(opencodePluginsDir, "index.js"))).toBe(true)
})

test("removes legacy plugin dir if present", () => {
  writeFakePlugin("0.99.9")
  mkdirSync(oldPluginDir, { recursive: true })
  writeFileSync(join(oldPluginDir, "stale.js"), "old")
  installOpencodePlugin({
    pluginSrc, pluginBundled, pluginPkg,
    opencodeDir, opencodePluginsDir, oldPluginDir,
    appVersion: "0.99.9",
  }, { mcpPort: 7770 })
  expect(existsSync(oldPluginDir)).toBe(false)
})

test("is idempotent when nothing changed", () => {
  writeFakePlugin("0.99.9")
  const paths = { pluginSrc, pluginBundled, pluginPkg, opencodeDir, opencodePluginsDir, oldPluginDir, appVersion: "0.99.9" }
  const first = installOpencodePlugin(paths, { mcpPort: 7770 })
  expect(first.status).toBe("installed")
  const configBefore = readFileSync(join(opencodeDir, "opencode.json"), "utf-8")
  const filesBefore = readdirSync(opencodePluginsDir).sort()
  const second = installOpencodePlugin(paths, { mcpPort: 7770 })
  expect(second.status).toBe("up-to-date")
  expect(readFileSync(join(opencodeDir, "opencode.json"), "utf-8")).toBe(configBefore)
  expect(readdirSync(opencodePluginsDir).sort()).toEqual(filesBefore)
})

test("reinstalls when app version changes", () => {
  writeFakePlugin("0.99.9")
  const paths = { pluginSrc, pluginBundled, pluginPkg, opencodeDir, opencodePluginsDir, oldPluginDir, appVersion: "0.99.9" }
  installOpencodePlugin(paths, { mcpPort: 7770 })
  const r = installOpencodePlugin({ ...paths, appVersion: "1.0.0" }, { mcpPort: 7770 })
  expect(r.status).toBe("installed")
})

test("reinstalls when source hash changes", () => {
  writeFakePlugin("0.99.9")
  const paths = { pluginSrc, pluginBundled, pluginPkg, opencodeDir, opencodePluginsDir, oldPluginDir, appVersion: "0.99.9" }
  installOpencodePlugin(paths, { mcpPort: 7770 })
  writeFileSync(pluginBundled, "export default { changed: true }\n")
  const r = installOpencodePlugin(paths, { mcpPort: 7770 })
  expect(r.status).toBe("installed")
})

test("updates opencode.json when port changes but plugin is healthy", () => {
  writeFakePlugin("0.99.9")
  const paths = { pluginSrc, pluginBundled, pluginPkg, opencodeDir, opencodePluginsDir, oldPluginDir, appVersion: "0.99.9" }
  installOpencodePlugin(paths, { mcpPort: 7770 })
  const r = installOpencodePlugin(paths, { mcpPort: 7771 })
  expect(r.status).toBe("installed")
  const cfg = readJson(join(opencodeDir, "opencode.json"))
  expect(cfg.mcp.codenexum.url).toBe("http://127.0.0.1:7771")
})

test("preserves existing opencode.json keys", () => {
  writeFakePlugin("0.99.9")
  writeFileSync(join(opencodeDir, "opencode.json"), JSON.stringify({
    provider: { foo: "bar" },
    theme: "dark",
    plugin: ["other-plugin"],
  }))
  installOpencodePlugin({
    pluginSrc, pluginBundled, pluginPkg,
    opencodeDir, opencodePluginsDir, oldPluginDir,
    appVersion: "0.99.9",
  }, { mcpPort: 7770 })
  const cfg = readJson(join(opencodeDir, "opencode.json"))
  expect(cfg.provider).toEqual({ foo: "bar" })
  expect(cfg.theme).toBe("dark")
  expect(cfg.plugin).toContain("other-plugin")
  expect(cfg.plugin).toContain("@codenexum/plugin")
})

test("replaces legacy plugin name with new one", () => {
  writeFakePlugin("0.99.9")
  writeFileSync(join(opencodeDir, "opencode.json"), JSON.stringify({
    plugin: ["@madtech/opencode-context-manager-plugin"],
  }))
  installOpencodePlugin({
    pluginSrc, pluginBundled, pluginPkg,
    opencodeDir, opencodePluginsDir, oldPluginDir,
    appVersion: "0.99.9",
  }, { mcpPort: 7770 })
  const cfg = readJson(join(opencodeDir, "opencode.json"))
  expect(cfg.plugin).toEqual(["@codenexum/plugin"])
})

test("force=true reinstalls even when healthy", () => {
  writeFakePlugin("0.99.9")
  const paths = { pluginSrc, pluginBundled, pluginPkg, opencodeDir, opencodePluginsDir, oldPluginDir, appVersion: "0.99.9" }
  installOpencodePlugin(paths, { mcpPort: 7770 })
  const r = installOpencodePlugin(paths, { mcpPort: 7770, force: true })
  expect(r.status).toBe("installed")
})

test("updateMcpConfig rewrites url when port differs", () => {
  writeFileSync(join(opencodeDir, "opencode.json"), JSON.stringify({
    mcp: { codenexum: { type: "remote", url: "http://127.0.0.1:7770", enabled: true } },
  }))
  updateMcpConfig({ opencodeDir }, 7771)
  const cfg = readJson(join(opencodeDir, "opencode.json"))
  expect(cfg.mcp.codenexum.url).toBe("http://127.0.0.1:7771")
})

test("updateMcpConfig is no-op when url already correct", () => {
  writeFileSync(join(opencodeDir, "opencode.json"), JSON.stringify({
    mcp: { codenexum: { type: "remote", url: "http://127.0.0.1:7770", enabled: true } },
  }))
  const before = readFileSync(join(opencodeDir, "opencode.json"), "utf-8")
  updateMcpConfig({ opencodeDir }, 7770)
  expect(readFileSync(join(opencodeDir, "opencode.json"), "utf-8")).toBe(before)
})

test("updateMcpConfig handles .jsonc as well", () => {
  writeFileSync(join(opencodeDir, "opencode.jsonc"), `{
    // comment line
    "mcp": {
      "codenexum": { "type": "remote", "url": "http://127.0.0.1:7770", "enabled": true }
    }
  }`)
  updateMcpConfig({ opencodeDir }, 7771)
  const cfg = readJson(join(opencodeDir, "opencode.jsonc"))
  expect(cfg.mcp.codenexum.url).toBe("http://127.0.0.1:7771")
})

test("updateMcpConfig does nothing when no config exists", () => {
  expect(() => updateMcpConfig({ opencodeDir }, 7770)).not.toThrow()
})

test("writeMcpConfigFile creates parent dirs and writes valid JSON", () => {
  writeMcpConfigFile(mcpConfigPath, 7771)
  const data = readJson(mcpConfigPath)
  expect(data).toEqual({ port: 7771, url: "http://127.0.0.1:7771" })
})

test("syncMcpEntry sets entry when missing", () => {
  const cfg: any = {}
  const r = syncMcpEntry(cfg, { type: "remote", url: "http://x", enabled: true })
  expect(r.changed).toBe(true)
  expect(cfg.mcp.codenexum.url).toBe("http://x")
})

test("syncMcpEntry re-enables disabled entry", () => {
  const cfg: any = { mcp: { codenexum: { type: "remote", url: "http://x", enabled: false } } }
  const r = syncMcpEntry(cfg, { type: "remote", url: "http://x", enabled: true })
  expect(r.changed).toBe(true)
  expect(cfg.mcp.codenexum.enabled).toBe(true)
})

test("syncMcpEntry is no-op when entry matches", () => {
  const entry = { type: "remote", url: "http://x", enabled: true }
  const cfg: any = { mcp: { codenexum: { ...entry } } }
  const r = syncMcpEntry(cfg, entry)
  expect(r.changed).toBe(false)
})

test("syncPluginEntry adds plugin when missing", () => {
  const cfg: any = {}
  const r = syncPluginEntry(cfg)
  expect(r.changed).toBe(true)
  expect(cfg.plugin).toEqual(["@codenexum/plugin"])
})

test("syncPluginEntry removes legacy plugin name", () => {
  const cfg: any = { plugin: ["@madtech/opencode-context-manager-plugin"] }
  const r = syncPluginEntry(cfg)
  expect(r.changed).toBe(true)
  expect(cfg.plugin).toEqual(["@codenexum/plugin"])
})

test("syncPluginEntry is no-op when already correct", () => {
  const cfg: any = { plugin: ["@codenexum/plugin"] }
  const r = syncPluginEntry(cfg)
  expect(r.changed).toBe(false)
})
