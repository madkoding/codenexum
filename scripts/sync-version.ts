#!/usr/bin/env bun
// @ts-nocheck
import { readFileSync, writeFileSync, existsSync } from "fs"
import { resolve } from "path"

const ROOT = resolve(import.meta.dir, "..")
const SOURCE_PKG = resolve(ROOT, "apps/electron/package.json")
const VERSION_FILE = resolve(ROOT, "packages/core/src/version.ts")
const PACKAGE_FILES = [
  resolve(ROOT, "package.json"),
  resolve(ROOT, "apps/electron/package.json"),
  resolve(ROOT, "apps/plugin/package.json"),
  resolve(ROOT, "packages/core/package.json"),
  resolve(ROOT, "packages/sql/package.json"),
]
const DOC_FILES = [
  resolve(ROOT, "docs/index.html"),
  resolve(ROOT, "README.md"),
  resolve(ROOT, "AGENTS.md"),
]
const DOCS_UPDATES = resolve(ROOT, "docs/updates.md")

function log(msg: string) {
  console.log(`[version] ${msg}`)
}

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, "utf-8"))
}

function bumpArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--bump="))
  if (!arg) return null
  const v = arg.split("=")[1]
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/.test(v)) {
    console.error(`[version] invalid --bump value: ${v}`)
    process.exit(1)
  }
  return v
}

function bumpPatch(v: string): string {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) throw new Error(`cannot bump ${v}`)
  return `${m[1]}.${m[2]}.${parseInt(m[3], 10) + 1}`
}

const source = readJson(SOURCE_PKG)
let newVersion = bumpArg()
if (!newVersion) {
  if (process.argv.includes("--bump")) {
    newVersion = bumpPatch(source.version)
  } else {
    newVersion = source.version
  }
}

if (newVersion !== source.version) {
  log(`bumping ${source.version} -> ${newVersion}`)
}

let changed = 0
for (const file of PACKAGE_FILES) {
  const raw = readFileSync(file, "utf-8")
  const updated = raw.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${newVersion}"`)
  if (updated === raw) continue
  writeFileSync(file, updated)
  changed++
  log(`package.json ${file.replace(ROOT + "/", "")} -> ${newVersion}`)
}

const versionTs = `export const APP_VERSION = "${newVersion}"
export const APP_NAME = "CodeNexum"
export const APP_REPO = "madkoding/codenexum"
`
const oldVersionTs = readFileSync(VERSION_FILE, "utf-8")
if (oldVersionTs !== versionTs) {
  writeFileSync(VERSION_FILE, versionTs)
  changed++
  log(`packages/core/src/version.ts -> ${newVersion}`)
}

const replaceVersion = (s: string): string =>
  s
    .replace(/v0\.99\.\d+(?:-[a-zA-Z0-9.]+)?/g, `v${newVersion}`)
    .replace(/(?<![\w.])0\.99\.\d+(?:-[a-zA-Z0-9.]+)?/g, newVersion)
    .replace(/CodeNexum-\d+\.\d+\.\d+/g, "CodeNexum")
    .replace(/CodeNexum Setup \d+\.\d+\.\d+\.exe/g, "CodeNexum-Setup.exe")
    .replace(/CodeNexum \d+\.\d+\.\d+\.exe/g, "CodeNexum-Portable.exe")
    .replace(/CodeNexum Setup \d+\.\d+\.\d+\.exe\.blockmap/g, "CodeNexum-Setup.exe.blockmap")

for (const file of DOC_FILES) {
  if (!existsSync(file)) continue
  const raw = readFileSync(file, "utf-8")
  const updated = replaceVersion(raw)
  if (updated === raw) continue
  writeFileSync(file, updated)
  changed++
  log(`doc ${file.replace(ROOT + "/", "")} -> ${newVersion}`)
}

if (existsSync(DOCS_UPDATES)) {
  const raw = readFileSync(DOCS_UPDATES, "utf-8")
  const updated = raw
    .replace(/v0\.99\.\d+(?:-[a-zA-Z0-9.]+)?/g, `v${newVersion}`)
    .replace(/(?<![.\w])0\.99\.\d+(?:-[a-zA-Z0-9.]+)?/g, newVersion)
    .replace(/CodeNexum-0\.99\.\d+-mac-x64\.dmg/g, "CodeNexum-x64.dmg")
    .replace(/CodeNexum-0\.99\.\d+-mac-arm64\.dmg/g, "CodeNexum-arm64.dmg")
    .replace(/CodeNexum-0\.99\.\d+-portable\.exe/g, "CodeNexum-Portable.exe")
    .replace(/CodeNexum-0\.99\.\d+-x64\.AppImage/g, "CodeNexum-x86_64.AppImage")
    .replace(/CodeNexum-0\.99\.\d+-arm64\.AppImage/g, "CodeNexum-arm64.AppImage")
    .replace(/CodeNexum Setup 0\.99\.\d+\.exe/g, "CodeNexum-Setup.exe")
  if (updated !== raw) {
    writeFileSync(DOCS_UPDATES, updated)
    changed++
    log(`doc ${DOCS_UPDATES.replace(ROOT + "/", "")} -> ${newVersion}`)
  }
}

log(`done (${changed} file${changed === 1 ? "" : "s"} updated, version ${newVersion})`)
if (process.argv.includes("--bump") || bumpArg()) {
  log(`next: git add -A && git commit -m "v${newVersion}" && git tag v${newVersion} && git push --follow-tags`)
}
