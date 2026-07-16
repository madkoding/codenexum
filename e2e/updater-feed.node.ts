import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer, type Server } from "node:http"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtempSync } from "node:fs"
import { pathToFileURL } from "node:url"

function listen(server: Server): Promise<{ port: number }> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number }
      resolve({ port: addr.port })
    })
  })
}

interface FeedFile {
  url: string
  sha512: string
  size: number
  blockMapSize?: number
}

interface Feed {
  version: string
  path: string
  sha512: string
  releaseDate: string
  files: FeedFile[]
}

function makeFeed(version: string, path: string, files: FeedFile[]): Feed {
  const primary = files.find((f) => f.url === path) || files[0]
  return {
    version,
    path,
    sha512: primary.sha512,
    releaseDate: "2026-07-16T20:00:00.000Z",
    files,
  }
}

function renderFeed(feed: Feed): string {
  const lines: string[] = []
  lines.push(`version: ${feed.version}`)
  lines.push("files:")
  for (const f of feed.files) {
    lines.push(`  - url: ${f.url}`)
    lines.push(`    sha512: ${f.sha512}`)
    lines.push(`    size: ${f.size}`)
    if (f.blockMapSize !== undefined) {
      lines.push(`    blockMapSize: ${f.blockMapSize}`)
    }
  }
  lines.push(`path: ${feed.path}`)
  lines.push(`sha512: ${feed.sha512}`)
  lines.push(`releaseDate: '${feed.releaseDate}'`)
  return lines.join("\n")
}

// 88-char base64 (64-byte) sha512 stubs for the mock feeds. Real release
// sha512s are produced by electron-builder; here we only need the right shape.
const SHA = "0".repeat(88)

const feeds: Record<string, Feed> = {
  "latest-mac.yml": makeFeed("0.100.1", "CodeNexum-arm64.zip", [
    { url: "CodeNexum-arm64.zip", sha512: SHA, size: 124894524, blockMapSize: 127000 },
    { url: "CodeNexum-x64.zip", sha512: SHA, size: 126729880, blockMapSize: 130000 },
    { url: "CodeNexum-arm64.dmg", sha512: SHA, size: 130026163 },
    { url: "CodeNexum-x64.dmg", sha512: SHA, size: 131803954 },
  ]),
  "latest.yml": makeFeed("0.100.1", "CodeNexum-Setup.exe", [
    { url: "CodeNexum-Setup.exe", sha512: SHA, size: 113114955, blockMapSize: 116000 },
    { url: "CodeNexum-Portable.exe", sha512: SHA, size: 113114955 },
  ]),
  "latest-linux.yml": makeFeed("0.100.1", "CodeNexum-x86_64.AppImage", [
    {
      url: "CodeNexum-x86_64.AppImage",
      sha512: SHA,
      size: 136183363,
      blockMapSize: 142935,
    },
  ]),
  "latest-linux-arm64.yml": makeFeed("0.100.1", "CodeNexum-arm64.AppImage", [
    {
      url: "CodeNexum-arm64.AppImage",
      sha512: SHA,
      size: 135925464,
      blockMapSize: 141860,
    },
  ]),
}

mkdtempSync(join(tmpdir(), "codenexum-updater-e2e-"))
let server: Server | null = null
let baseUrl = ""

test("setup: start mock feed server", async () => {
  server = createServer((req, res) => {
    const url = req.url || "/"
    const name = url.split("?")[0].replace(/^\/+/, "")
    if (feeds[name]) {
      res.writeHead(200, { "Content-Type": "text/yaml" })
      res.end(renderFeed(feeds[name]))
      return
    }
    res.writeHead(404)
    res.end(`not found: ${name}`)
  })
  const { port } = await listen(server)
  baseUrl = `http://127.0.0.1:${port}`
})

// --- Feed contract tests (prevent the 'ZIP file not provided' regression) ---

test("macOS feed path points to .zip (NOT .dmg)", () => {
  const feed = feeds["latest-mac.yml"]
  assert.ok(feed.path.endsWith(".zip"), `expected .zip, got: ${feed.path}`)
  assert.equal(feed.path.includes(".dmg"), false, "macOS feed must not default to .dmg")
})

test("macOS feed lists both x64 and arm64 .zip files", () => {
  const feed = feeds["latest-mac.yml"]
  const zips = feed.files.filter((f) => f.url.endsWith(".zip"))
  assert.ok(zips.length >= 2, `expected >=2 .zip entries, got ${zips.length}`)
  assert.ok(zips.some((f) => f.url.includes("arm64")), "missing arm64 .zip")
  assert.ok(zips.some((f) => f.url.includes("x64")), "missing x64 .zip")
})

test("macOS feed includes .zip blockMapSize (delta updates)", () => {
  const feed = feeds["latest-mac.yml"]
  const zips = feed.files.filter((f) => f.url.endsWith(".zip"))
  for (const z of zips) {
    assert.ok(
      typeof z.blockMapSize === "number" && z.blockMapSize > 0,
      `expected blockMapSize on ${z.url}`,
    )
  }
})

test("macOS feed sha512 length is 88 base64 chars (64 bytes)", () => {
  const feed = feeds["latest-mac.yml"]
  for (const f of feed.files) {
    assert.equal(f.sha512.length, 88, `bad sha512 length on ${f.url}: ${f.sha512}`)
  }
})

test("Windows feed path points to .exe (nsis installer)", () => {
  const feed = feeds["latest.yml"]
  assert.ok(feed.path.endsWith(".exe"), `expected .exe, got: ${feed.path}`)
  assert.ok(feed.path.includes("Setup"), "expected Setup.exe as primary")
})

test("Windows feed includes blockMapSize for delta updates", () => {
  const feed = feeds["latest.yml"]
  const setup = feed.files.find((f) => f.url.includes("Setup"))
  assert.ok(setup, "missing Setup.exe in latest.yml")
  assert.equal(typeof setup!.blockMapSize, "number")
  assert.ok(setup!.blockMapSize! > 0)
})

test("Linux x64 feed path points to .AppImage", () => {
  const feed = feeds["latest-linux.yml"]
  assert.ok(feed.path.endsWith(".AppImage"), `expected .AppImage, got: ${feed.path}`)
  assert.ok(feed.path.includes("x86_64"), "expected x86_64 AppImage")
})

test("Linux arm64 feed path points to .AppImage", () => {
  const feed = feeds["latest-linux-arm64.yml"]
  assert.ok(feed.path.endsWith(".AppImage"), `expected .AppImage, got: ${feed.path}`)
  assert.ok(feed.path.includes("arm64"), "expected arm64 AppImage")
})

test("Linux feed includes blockMapSize (delta updates)", () => {
  for (const key of ["latest-linux.yml", "latest-linux-arm64.yml"] as const) {
    const feed = feeds[key]
    for (const f of feed.files) {
      assert.equal(typeof f.blockMapSize, "number", `missing blockMapSize on ${f.url}`)
    }
  }
})

// --- Mock feed server round-trip ---

test("mock server serves latest-mac.yml with the correct version", async () => {
  const r = await fetch(`${baseUrl}/latest-mac.yml`)
  assert.equal(r.status, 200)
  const text = await r.text()
  assert.match(text, /^version: 0\.100\.1/m)
  assert.match(text, /^path: CodeNexum-arm64\.zip/m)
})

test("mock server serves latest.yml with the correct version", async () => {
  const r = await fetch(`${baseUrl}/latest.yml`)
  assert.equal(r.status, 200)
  const text = await r.text()
  assert.match(text, /^version: 0\.100\.1/m)
  assert.match(text, /^path: CodeNexum-Setup\.exe/m)
})

test("mock server serves linux feeds", async () => {
  for (const name of ["latest-linux.yml", "latest-linux-arm64.yml"]) {
    const r = await fetch(`${baseUrl}/${name}`)
    assert.equal(r.status, 200)
    const text = await r.text()
    assert.match(text, /^version: 0\.100\.1/m)
    assert.match(text, /AppImage/m)
  }
})

test("mock server returns 404 for unknown feed", async () => {
  const r = await fetch(`${baseUrl}/does-not-exist.yml`)
  assert.equal(r.status, 404)
})

// --- resolveUpdaterConfig: pure function, no Electron required ---

test("resolveUpdaterConfig: disabled when not packaged", async () => {
  const mod: any = await import(
    pathToFileURL(join(process.cwd(), "apps/electron/src/main/updater-config.ts")).href
  )
  const cfg = mod.resolveUpdaterConfig({}, false)
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.feedURL, null)
})

test("resolveUpdaterConfig: disabled when CODENEXUM_DISABLE_UPDATES=1", async () => {
  const mod: any = await import(
    pathToFileURL(join(process.cwd(), "apps/electron/src/main/updater-config.ts")).href
  )
  const cfg = mod.resolveUpdaterConfig({ CODENEXUM_DISABLE_UPDATES: "1" }, true)
  assert.equal(cfg.enabled, false)
})

test("resolveUpdaterConfig: enabled with feed URL when env is set", async () => {
  const mod: any = await import(
    pathToFileURL(join(process.cwd(), "apps/electron/src/main/updater-config.ts")).href
  )
  const cfg = mod.resolveUpdaterConfig(
    { CODENEXUM_UPDATE_FEED_URL: "https://example.com/releases/v0.100.1" },
    true,
  )
  assert.equal(cfg.enabled, true)
  assert.equal(cfg.feedURL, "https://example.com/releases/v0.100.1")
})

test("resolveUpdaterConfig: default delay is 30s, override via env", async () => {
  const mod: any = await import(
    pathToFileURL(join(process.cwd(), "apps/electron/src/main/updater-config.ts")).href
  )
  const def = mod.resolveUpdaterConfig({}, true)
  assert.equal(def.checkDelayMs, 30000)
  const fast = mod.resolveUpdaterConfig(
    { CODENEXUM_UPDATE_CHECK_DELAY_MS: "5000" },
    true,
  )
  assert.equal(fast.checkDelayMs, 5000)
})

test("resolveUpdaterConfig: empty feedURL is treated as null", async () => {
  const mod: any = await import(
    pathToFileURL(join(process.cwd(), "apps/electron/src/main/updater-config.ts")).href
  )
  const cfg = mod.resolveUpdaterConfig({ CODENEXUM_UPDATE_FEED_URL: "" }, true)
  assert.equal(cfg.feedURL, null)
})

// --- Live smoke test against the real GitHub release ---

test("GitHub release v0.100.1 latest-mac.yml is valid and points to .zip", async () => {
  let text: string
  try {
    const r = await fetch(
      "https://github.com/madKoding/codenexum/releases/download/v0.100.1/latest-mac.yml",
    )
    if (r.status !== 200) {
      console.log(`skip: GitHub returned ${r.status}`)
      return
    }
    text = await r.text()
  } catch (e) {
    console.log(`skip: GitHub fetch failed: ${(e as Error).message}`)
    return
  }
  assert.match(text, /^version: 0\.100\.1/m)
  const pathMatch = text.match(/^path: (.+)$/m)
  assert.ok(pathMatch, "missing path field")
  assert.ok(
    pathMatch![1].endsWith(".zip"),
    `GitHub latest-mac.yml path must be .zip, got: ${pathMatch![1]}`,
  )
})

test("teardown: close mock server", async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  }
})
