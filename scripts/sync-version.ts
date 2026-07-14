#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "fs"
import { resolve } from "path"

const ROOT = resolve(import.meta.dir, "..")
const VERSION_FILE = resolve(ROOT, "packages/core/src/version.ts")
const PACKAGE_FILES = [
  resolve(ROOT, "package.json"),
  resolve(ROOT, "apps/electron/package.json"),
  resolve(ROOT, "apps/plugin/package.json"),
  resolve(ROOT, "packages/core/package.json"),
  resolve(ROOT, "packages/sql/package.json"),
]

const source = readFileSync(VERSION_FILE, "utf-8")
const match = source.match(/APP_VERSION\s*=\s*"([^"]+)"/)
if (!match) {
  console.error(`[sync-version] could not parse APP_VERSION from ${VERSION_FILE}`)
  process.exit(1)
}
const version = match[1]
const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
let changed = 0
for (const file of PACKAGE_FILES) {
  const raw = readFileSync(file, "utf-8")
  const updated = raw.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${version}"`)
  if (updated === raw) {
    console.log(`[sync-version] ${file.replace(ROOT + "/", "")} unchanged (already ${version})`)
    continue
  }
  writeFileSync(file, updated)
  changed++
  console.log(`[sync-version] ${file.replace(ROOT + "/", "")} -> ${version}`)
}
console.log(`[sync-version] done at ${stamp} (${changed} updated, version ${version})`)
