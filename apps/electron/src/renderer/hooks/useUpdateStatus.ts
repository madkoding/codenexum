import { useState, useEffect, useCallback } from "react"

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

export type UpdateInfo = {
  version: string
  releaseDate?: string
  releaseNotes?: string | string[] | null
}

export type UpdateSnapshot = {
  status: UpdateStatus
  progress: number
  info: UpdateInfo | null
  error: string | null
  currentVersion: string
}

const IDLE: UpdateSnapshot = {
  status: "idle",
  progress: 0,
  info: null,
  error: null,
  currentVersion: "0.0.0",
}

export function useUpdateStatus() {
  const [snap, setSnap] = useState<UpdateSnapshot>(IDLE)

  useEffect(() => {
    let mounted = true
    window.electronAPI.update.getStatus().then((s) => {
      if (mounted) setSnap(s)
    })
    const off = window.electronAPI.update.onStatusChange((s) => {
      if (mounted) setSnap(s)
    })
    return () => {
      mounted = false
      off()
    }
  }, [])

  const check = useCallback(() => window.electronAPI.update.check(), [])
  const download = useCallback(() => window.electronAPI.update.download(), [])
  const install = useCallback(() => window.electronAPI.update.install(), [])

  return { ...snap, check, download, install }
}
