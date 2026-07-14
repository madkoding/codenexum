import { app, BrowserWindow } from "electron"
import { autoUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater"

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error"
  | "unsupported"
  | "disabled"

export type UpdateSnapshot = {
  status: UpdateStatus
  progress: number
  info: UpdateInfo | null
  error: string | null
  currentVersion: string
}

const CHECK_DELAY_MS = parseInt(process.env.CODENEXUM_UPDATE_CHECK_DELAY_MS || "30000", 10)

export class UpdateManager {
  status: UpdateStatus = "idle"
  progress = 0
  info: UpdateInfo | null = null
  error: string | null = null
  private timer: NodeJS.Timeout | null = null

  init() {
    if (!app.isPackaged) {
      this.setStatus("disabled")
      return
    }
    if (process.env.CODENEXUM_DISABLE_UPDATES === "1") {
      this.setStatus("disabled")
      return
    }
    if (process.env.CODENEXUM_UPDATE_FEED_URL) {
      autoUpdater.setFeedURL({ provider: "generic", url: process.env.CODENEXUM_UPDATE_FEED_URL })
    }
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on("checking-for-update", () => {
      this.setStatus("checking")
    })
    autoUpdater.on("update-available", (info) => {
      this.info = info
      this.setStatus("available")
    })
    autoUpdater.on("update-not-available", () => {
      this.setStatus("not-available")
    })
    autoUpdater.on("download-progress", (p: ProgressInfo) => {
      this.progress = Math.round(p.percent)
      this.setStatus("downloading")
    })
    autoUpdater.on("update-downloaded", (info) => {
      this.info = info
      this.progress = 100
      this.setStatus("downloaded")
    })
    autoUpdater.on("error", (err) => {
      this.error = err?.message || String(err)
      this.setStatus("error")
    })
    this.timer = setTimeout(() => this.check(), CHECK_DELAY_MS)
  }

  async check(): Promise<void> {
    if (this.status === "disabled" || this.status === "unsupported") return
    this.error = null
    try {
      await autoUpdater.checkForUpdates()
    } catch (e: any) {
      this.error = e?.message || String(e)
      this.setStatus("error")
    }
  }

  async download(): Promise<void> {
    if (this.status === "disabled" || this.status === "unsupported") return
    try {
      await autoUpdater.downloadUpdate()
    } catch (e: any) {
      this.error = e?.message || String(e)
      this.setStatus("error")
    }
  }

  installAndRestart(): void {
    if (this.status === "disabled" || this.status === "unsupported") return
    autoUpdater.quitAndInstall()
  }

  getStatus(): UpdateSnapshot {
    return {
      status: this.status,
      progress: this.progress,
      info: this.info,
      error: this.error,
      currentVersion: app.getVersion(),
    }
  }

  private setStatus(s: UpdateStatus) {
    this.status = s
    this.broadcast()
  }

  private broadcast() {
    const snap = this.getStatus()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("update:status-changed", snap)
    }
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
  }
}
