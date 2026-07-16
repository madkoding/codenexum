export interface UpdaterConfig {
  enabled: boolean
  feedURL: string | null
  checkDelayMs: number
}

export function resolveUpdaterConfig(
  env: NodeJS.ProcessEnv = process.env,
  isPackaged = true,
): UpdaterConfig {
  if (!isPackaged) {
    return { enabled: false, feedURL: null, checkDelayMs: 0 }
  }
  if (env.CODENEXUM_DISABLE_UPDATES === "1") {
    return { enabled: false, feedURL: null, checkDelayMs: 0 }
  }
  const feedURL =
    typeof env.CODENEXUM_UPDATE_FEED_URL === "string" && env.CODENEXUM_UPDATE_FEED_URL.length > 0
      ? env.CODENEXUM_UPDATE_FEED_URL
      : null
  const checkDelayMs = parseInt(env.CODENEXUM_UPDATE_CHECK_DELAY_MS || "30000", 10)
  return { enabled: true, feedURL, checkDelayMs }
}
