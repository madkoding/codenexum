export type LogLevel = "debug" | "info" | "warn" | "error"

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const LEVEL_LABEL: Record<LogLevel, string> = { debug: "DBG", info: "INF", warn: "WRN", error: "ERR" }

let minLevel: LogLevel = (process.env.CODENEXUM_LOG_LEVEL as LogLevel) || "info"

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[minLevel]
}

function fmt(level: LogLevel, scope: string, msg: string, extra?: Record<string, unknown>): string {
  const ts = new Date().toISOString().slice(11, 23)
  let line = `[${ts}] [${LEVEL_LABEL[level]}] [${scope}] ${msg}`
  if (extra && Object.keys(extra).length > 0) {
    const ser = Object.entries(extra)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ")
    line += ` ${ser}`
  }
  return line
}

function emit(level: LogLevel, scope: string, msg: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) return
  const line = fmt(level, scope, msg, extra)
  if (level === "error" || level === "warn") {
    console.error(line)
  } else {
    console.log(line)
  }
}

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
  child(sub: string): Logger
}

export function createLogger(scope: string): Logger {
  const build = (s: string): Logger => ({
    debug: (m, e) => emit("debug", s, m, e),
    info: (m, e) => emit("info", s, m, e),
    warn: (m, e) => emit("warn", s, m, e),
    error: (m, e) => emit("error", s, m, e),
    child: (sub) => build(`${s}/${sub}`),
  })
  return build(scope)
}

export function setLogLevel(level: LogLevel): void {
  minLevel = level
}
