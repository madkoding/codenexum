import { app, nativeImage } from "electron"
import { existsSync } from "fs"
import { join } from "path"

let cached: Electron.NativeImage | null = null

export function getAppIcon(): Electron.NativeImage {
  if (cached && !cached.isEmpty()) return cached

  const candidates: string[] = []

  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, "build", "icon.png"))
    candidates.push(join(process.resourcesPath, "icon.png"))
  } else {
    candidates.push(join(app.getAppPath(), "build", "icon.png"))
    candidates.push(join(__dirname, "..", "..", "build", "icon.png"))
  }

  for (const p of candidates) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) {
        cached = img
        return img
      }
    }
  }

  cached = nativeImage.createEmpty()
  return cached
}
