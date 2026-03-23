/**
 * Supervisor — keeps the dashboard alive with auto-restart on crash.
 * Spawned by `av up` as a detached background process.
 *
 * Usage: bun apps/cli/src/supervisor.ts <dashboard-cwd> <port>
 */

import { spawn } from "node:child_process"
import { appendFileSync } from "node:fs"
import { resolve } from "node:path"

const dashboardCwd = process.argv[2]
const port = process.argv[3] ?? "9741"
const logFile = resolve(process.cwd(), ".av.log")

const MAX_RESTARTS = 20
const RESTART_DELAY = 3_000

let restarts = 0

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] [supervisor] ${msg}\n`
  appendFileSync(logFile, line)
}

function startDashboard(): void {
  const proc = spawn("bun", ["run", "dev"], {
    cwd: dashboardCwd,
    stdio: ["ignore", "pipe", "pipe"],
  })

  // Pipe to log file
  proc.stdout?.on("data", (chunk: Buffer) => appendFileSync(logFile, chunk))
  proc.stderr?.on("data", (chunk: Buffer) => appendFileSync(logFile, chunk))

  log(`Dashboard started (pid: ${proc.pid})`)

  proc.on("exit", (code, signal) => {
    log(`Dashboard exited (code: ${code}, signal: ${signal})`)
    restarts++

    if (restarts > MAX_RESTARTS) {
      log(`Max restarts (${MAX_RESTARTS}) exceeded. Giving up.`)
      process.exit(1)
    }

    log(`Restarting in ${RESTART_DELAY / 1000}s... (restart ${restarts}/${MAX_RESTARTS})`)
    setTimeout(startDashboard, RESTART_DELAY)
  })
}

log(`Supervisor started — port ${port}, cwd ${dashboardCwd}`)
startDashboard()
