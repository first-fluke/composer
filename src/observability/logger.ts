/**
 * Structured Logger — JSON or text format based on LOG_FORMAT env var.
 * Required fields: timestamp, level, component, message.
 */

type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

let minLevel: LogLevel = "info"
let format: "json" | "text" = "json"

export function configureLogger(level: LogLevel, fmt: "json" | "text"): void {
  minLevel = level
  format = fmt
}

interface LogFields {
  issueId?: string
  attemptId?: string
  workspacePath?: string
  exitCode?: number
  durationMs?: number
  error?: string
  [key: string]: unknown
}

function log(level: LogLevel, component: string, message: string, fields?: LogFields): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return

  const timestamp = new Date().toISOString()

  if (format === "json") {
    const entry = { timestamp, level, component, message, ...fields }
    console.log(JSON.stringify(entry))
  } else {
    const extra = fields
      ? " " + Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" ")
      : ""
    console.log(`${timestamp} [${level.toUpperCase()}] [${component}] ${message}${extra}`)
  }
}

export const logger = {
  debug: (component: string, message: string, fields?: LogFields) => log("debug", component, message, fields),
  info: (component: string, message: string, fields?: LogFields) => log("info", component, message, fields),
  warn: (component: string, message: string, fields?: LogFields) => log("warn", component, message, fields),
  error: (component: string, message: string, fields?: LogFields) => log("error", component, message, fields),
}
