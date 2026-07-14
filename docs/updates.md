# Releases & Auto-updates

CodeNexum ships auto-updates via GitHub Releases. The Electron app polls the latest release on startup and surfaces a modal in-app when a new version is available.

## Architecture

- `apps/electron/src/main/updater.ts` — `UpdateManager` class wrapping `electron-updater`.
- `apps/electron/src/renderer/components/UpdateModal.tsx` — global modal showing update state.
- Feed source: `publish` block in `apps/electron/package.json` → `github` provider, owner `madKoding`, repo `codenexum`.
- Status is broadcast to the renderer via `update:status-changed` IPC; the modal subscribes and renders accordingly.

## Update states

| State | Meaning | UI |
| --- | --- | --- |
| `idle` | Initial, no check yet | None |
| `checking` | Network call to GitHub in flight | None |
| `available` | New version found, ready to download | Centered modal: "Download" / "Later" |
| `downloading` | Bytes in flight | Bottom-right toast with progress bar |
| `downloaded` | Ready to install | Centered modal: "Restart now" / "On next quit" |
| `not-available` | Local matches latest | None (tray check shows toast) |
| `unsupported` | Platform format doesn't support auto-update (e.g. win portable) | Modal with link to GitHub release page |
| `error` | Network or signature failure | Bottom-right toast with retry |
| `disabled` | Dev mode, `CODENEXUM_DISABLE_UPDATES=1`, or running from `bun run dev` | None |

## How a release is consumed by the app

1. `UpdateManager.init()` runs on `app.whenReady`. After a configurable delay (default 30s), it calls `autoUpdater.checkForUpdates()`.
2. `electron-updater` fetches `https://api.github.com/repos/madKoding/codenexum/releases/latest`, reads the `latest.yml` (mac/linux) or `latest.yml` (win) from the release assets, and compares the version to `app.getVersion()`.
3. If remote is newer, the user sees the `available` modal. On click "Download", `autoUpdater.downloadUpdate()` runs; on completion, the `downloaded` modal invites a restart.
4. Restart triggers `autoUpdater.quitAndInstall()`, which closes the app and replaces it with the new version.

## Build targets

| Platform | Target | Auto-update? |
| --- | --- | --- |
| macOS | dmg (x64 + arm64) | Yes |
| Windows | nsis installer (x64) | Yes |
| Windows | portable (x64) | No — modal links to manual download |
| Linux | AppImage (x64 + arm64) | Yes |

The Windows portable build is kept for users who prefer it, but it does not receive auto-updates. The first time such a user opens the app after we publish a new version, they will see the "unsupported" modal with a link to GitHub Releases.

## Release procedure (manual)

The CI workflow is optional. Releases are uploaded to GitHub manually with `gh`:

```bash
# 1. Bump version
$EDITOR packages/core/src/version.ts  # APP_VERSION = "0.99.5"

# 2. Commit + tag
git add packages/core/src/version.ts
git commit -m "release: v0.99.5"
git tag v0.99.5
git push origin develop --follow-tags

# 3. Build
bun install --frozen-lockfile
bun run --filter @codenexum/plugin build
bun run --filter @codenexum/plugin bundle
bun run --filter @codenexum/electron package

# 4. Upload to GitHub
gh release create v0.99.5 \
  --title "v0.99.5" \
  --generate-notes \
  apps/electron/out/*
```

`apps/electron/out/` will contain (per platform):

- `CodeNexum-0.99.5-mac-x64.dmg`, `CodeNexum-0.99.5-mac-arm64.dmg`, `latest-mac.yml`
- `CodeNexum Setup 0.99.5.exe`, `latest.yml` (nsis)
- `CodeNexum-0.99.5-portable.exe` (no feed entry — by design)
- `CodeNexum-0.99.5-x64.AppImage`, `CodeNexum-0.99.5-arm64.AppImage`, `latest-linux.yml`

`gh release create` uploads everything in the glob. Electron-builder generated the `latest*.yml` files during `package` — no extra step.

### Marking the release as latest

`gh release create` marks the release as "Latest" by default. Prereleases (e.g. `v0.99.5-rc.1`) are tagged with `--prerelease` and won't trigger auto-update for stable users.

## Smoke test

Before tagging a real release, validate the feed manually:

1. Build a candidate locally and push it to a draft release:
   ```bash
   gh release create v0.99.5-rc.1 --prerelease --draft apps/electron/out/*
   ```
2. Install a previous stable build (e.g. v0.99.4) on a test machine. Launch it with:
   ```bash
   CODENEXUM_UPDATE_FEED_URL=https://github.com/madKoding/codenexum/releases/expanded_assets/v0.99.5-rc.1 \
     /Applications/CodeNexum.app/Contents/MacOS/CodeNexum
   ```
   (electron-updater does not consume this URL shape directly — see workaround below.)
3. To force a feed override, publish the candidate as a non-prerelease tag (e.g. `v0.99.5-test`) and use:
   ```bash
   CODENEXUM_UPDATE_FEED_URL='{"provider":"generic","url":"https://github.com/madKoding/codenexum/releases/download/v0.99.5-test"}' \
     /Applications/CodeNexum.app/Contents/MacOS/CodeNexum
   ```
   (pass JSON in the env var; `UpdateManager` reads it as the `setFeedURL` arg — note: the current implementation passes the env as a string URL only; this requires a small adjustment if you need a JSON feed URL — see "Test feed override" below).
4. Verify the modal sequence: `available` → `downloading` → `downloaded` → "Restart now" → relaunch shows the new version.

### Test feed override (current code)

The current `UpdateManager.init()` reads `CODENEXUM_UPDATE_FEED_URL` as a URL string and calls `autoUpdater.setFeedURL({ provider: "generic", url })`. For GitHub provider testing, use the default `provider: "github"` path with no env var — push a real release and the running app will pick it up.

For local mock servers (e.g. `npx http-server ./out` serving `latest-mac.yml`):

```bash
CODENEXUM_UPDATE_FEED_URL=http://127.0.0.1:8080/ \
  CODENEXUM_DISABLE_UPDATES=0 \
  open -na apps/electron/out/mac-arm64/CodeNexum.app
```

## Disabling updates

- Dev (`bun run dev`): updates are disabled because `app.isPackaged` is false.
- Packaged: set `CODENEXUM_DISABLE_UPDATES=1` to force-disable without rebuilding.

## Rollback

There is no native rollback. To revert a bad release, publish a hotfix version (e.g. `v0.99.6`) and yank the previous release's assets on GitHub (or mark as draft). Users on the bad version will receive the hotfix on next check.

## Known caveats

- **macOS Gatekeeper**: builds are not signed. The first time users open an updated `.dmg`, macOS will ask them to confirm via System Settings → Privacy & Security → Open Anyway. This is constant per build, not per launch.
- **Windows portable users**: do not receive auto-updates. The modal offers manual download.
- **Single-instance lock + update**: the lock is held during the `quitAndInstall()` flow. If a second instance is started while the first is updating, it will quit immediately — this is intentional.
