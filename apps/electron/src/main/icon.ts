import { app, nativeImage } from "electron"
import { existsSync } from "fs"
import { join } from "path"

let cached: Electron.NativeImage | null = null
let trayCache: Record<string, Electron.NativeImage> = {}

function resourceCandidates(name: string, appIcon: boolean): string[] {
  const out: string[] = []
  if (appIcon) {
    if (app.isPackaged) {
      out.push(join(process.resourcesPath, "build", "icon.png"))
      out.push(join(process.resourcesPath, "icon.png"))
    }
    out.push(join(app.getAppPath(), "build", "icon.png"))
    out.push(join(__dirname, "..", "..", "build", "icon.png"))
  } else {
    if (app.isPackaged) {
      out.push(join(process.resourcesPath, "tray", name))
    }
    out.push(join(app.getAppPath(), "build", "tray", name))
    out.push(join(__dirname, "..", "..", "build", "tray", name))
  }
  return out
}

export function getAppIcon(): Electron.NativeImage {
  if (cached && !cached.isEmpty()) return cached
  for (const p of resourceCandidates("icon.png", true)) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) { cached = img; return img }
    }
  }
  cached = nativeImage.createEmpty()
  return cached
}

export function getTrayIcon(size: 16 | 32 | 64 = 32): Electron.NativeImage {
  const key = String(size)
  if (trayCache[key] && !trayCache[key].isEmpty()) return trayCache[key]
  const names = [`tray-${size}.png`, size <= 16 ? "tray-16.png" : size <= 32 ? "tray-32.png" : "tray-64.png"]
  for (const n of names) {
    for (const p of resourceCandidates(n, false)) {
      if (existsSync(p)) {
        const img = nativeImage.createFromPath(p)
        if (!img.isEmpty()) {
          if (process.platform === "darwin") img.setTemplateImage(false)
          trayCache[key] = img
          return img
        }
      }
    }
  }
  const fallback = getAppIcon()
  if (!fallback.isEmpty()) {
    trayCache[key] = fallback
    return fallback
  }
  trayCache[key] = nativeImage.createEmpty()
  return trayCache[key]
}
