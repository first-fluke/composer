#!/usr/bin/env bun

/**
 * CLI entry point — `bun av`
 *
 * Commands:
 *   up       Start dashboard + ngrok as background daemon
 *   down     Stop background daemon
 *   dev      Start in foreground (with file watching + auto-restart)
 *   status   Query orchestrator status
 *   issue    Create a Linear issue
 *   setup    Interactive setup wizard
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { program } from "commander"
import pc from "picocolors"

/** Project root = cwd where user runs `bunx av` */
const ROOT = process.cwd()
const PID_FILE = resolve(ROOT, ".av.pid")
const LOG_FILE = resolve(ROOT, ".av.log")

// ── PID file helpers ─────────────────────────────────────────────────────────

interface PidState {
  dashboard: number
  ngrok?: number
  port: number
  startedAt: string
}

function writePids(state: PidState): void {
  writeFileSync(PID_FILE, JSON.stringify(state, null, 2))
}

function readPids(): PidState | null {
  if (!existsSync(PID_FILE)) return null
  try {
    return JSON.parse(readFileSync(PID_FILE, "utf-8"))
  } catch {
    return null
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function ensureEnv(): void {
  if (!existsSync(resolve(ROOT, ".env"))) {
    console.log(pc.red("No .env found. Run `av setup` first."))
    process.exit(1)
  }
}

// ── ngrok helper ─────────────────────────────────────────────────────────────

function spawnNgrok(port: string): ChildProcess | null {
  const which = spawnSync("which", ["ngrok"])
  if (which.status !== 0) {
    console.log(pc.yellow("⚠ ngrok not found — Linear webhooks won't reach localhost"))
    console.log(pc.dim("  Install: brew install ngrok"))
    return null
  }

  const proc = spawn("ngrok", ["http", port, "--log", "stdout", "--log-format", "json"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })

  let found = false
  proc.stdout?.on("data", (chunk: Buffer) => {
    if (found) return
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue
      try {
        const log = JSON.parse(line)
        if (log.url?.startsWith("https://")) {
          found = true
          console.log(pc.green(`▶ ngrok → ${log.url}`))
          console.log(pc.dim(`  Webhook URL: ${log.url}/api/webhook`))
        }
      } catch {
        // not JSON
      }
    }
  })

  return proc
}

program.name("av").description("Agent Valley — AI agent orchestrator").version("0.1.0")

// ── setup ────────────────────────────────────────────────────────────────────
program
  .command("setup")
  .description("Interactive setup wizard")
  .option("--edit", "Modify specific values in existing .env")
  .action(async (opts: { edit?: boolean }) => {
    if (opts.edit) {
      const { setupEdit } = await import("./setup")
      await setupEdit()
    } else {
      const { setup } = await import("./setup")
      await setup()
    }
  })

// ── invite ───────────────────────────────────────────────────────────────────
program
  .command("invite")
  .description("Copy team config to clipboard for new members")
  .action(async () => {
    const { invite } = await import("./invite")
    await invite()
  })

// ── up ───────────────────────────────────────────────────────────────────────
program
  .command("up")
  .description("Start dashboard + orchestrator + ngrok (background daemon)")
  .action(async () => {
    ensureEnv()

    // Check if already running
    const existing = readPids()
    if (existing && isProcessAlive(existing.dashboard)) {
      console.log(pc.yellow(`Already running (dashboard pid: ${existing.dashboard}, port: ${existing.port})`))
      console.log(pc.dim(`  Stop with: av down`))
      return
    }

    const port = process.env.SERVER_PORT ?? "9741"

    // Start dashboard as detached background process
    const dashProc = spawn("bun", ["run", "dev"], {
      cwd: resolve(ROOT, "apps/dashboard"),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    })

    // Pipe output to log file
    const logStream = require("node:fs").createWriteStream(LOG_FILE, { flags: "a" })
    dashProc.stdout?.pipe(logStream)
    dashProc.stderr?.pipe(logStream)
    dashProc.unref()

    // Start ngrok
    const ngrokProc = spawnNgrok(port)
    ngrokProc?.unref()

    // Write PID file
    writePids({
      dashboard: dashProc.pid ?? 0,
      ngrok: ngrokProc?.pid,
      port: Number(port),
      startedAt: new Date().toISOString(),
    })

    console.log(pc.green(`▶ Dashboard started (pid: ${dashProc.pid}) → http://localhost:${port}`))
    console.log(pc.dim(`  Logs: tail -f ${LOG_FILE}`))
    console.log(pc.dim(`  Stop: av down`))

    // Wait a moment for ngrok URL detection, then exit
    await new Promise((r) => setTimeout(r, 5_000))
  })

// ── down ─────────────────────────────────────────────────────────────────────
program
  .command("down")
  .description("Stop background dashboard + ngrok")
  .action(() => {
    const state = readPids()
    if (!state) {
      console.log(pc.yellow("Not running (no .av.pid found)"))
      return
    }

    let stopped = 0

    if (isProcessAlive(state.dashboard)) {
      // Kill process group (dashboard + its children)
      try {
        process.kill(-state.dashboard, "SIGTERM")
      } catch {
        process.kill(state.dashboard, "SIGTERM")
      }
      console.log(pc.green(`▪ Dashboard stopped (pid: ${state.dashboard})`))
      stopped++
    }

    if (state.ngrok && isProcessAlive(state.ngrok)) {
      try {
        process.kill(-state.ngrok, "SIGTERM")
      } catch {
        process.kill(state.ngrok, "SIGTERM")
      }
      console.log(pc.green(`▪ ngrok stopped (pid: ${state.ngrok})`))
      stopped++
    }

    unlinkSync(PID_FILE)

    if (stopped === 0) {
      console.log(pc.yellow("Processes were already dead. Cleaned up PID file."))
    } else {
      console.log(pc.green(`✓ Stopped ${stopped} process(es)`))
    }
  })

// ── dev (foreground) ─────────────────────────────────────────────────────────
program
  .command("dev")
  .description("Start in foreground (with file watching + auto-restart)")
  .action(async () => {
    ensureEnv()

    const port = process.env.SERVER_PORT ?? "9741"
    let dashProc: ChildProcess | null = null
    let shuttingDown = false

    const startDashboard = () => {
      dashProc = spawn("bun", ["run", "dev"], {
        cwd: resolve(ROOT, "apps/dashboard"),
        stdio: "inherit",
      })
      console.log(pc.green(`▶ Dashboard started (pid: ${dashProc.pid}) → http://localhost:${port}`))

      dashProc.on("exit", (code) => {
        if (shuttingDown) return
        console.log(pc.red(`✗ Dashboard exited (code ${code}). Restarting in 3s...`))
        setTimeout(startDashboard, 3_000)
      })
    }

    startDashboard()

    // ngrok
    const ngrokProc = spawnNgrok(port)

    // Watch config files
    const chokidar = await import("chokidar")
    const watcher = chokidar.watch([resolve(ROOT, "WORKFLOW.md"), resolve(ROOT, ".env")], {
      ignoreInitial: true,
    })

    watcher.on("change", (path: string) => {
      console.log(pc.dim(`  changed: ${path}`))
      shuttingDown = true
      dashProc?.kill()
      console.log(pc.yellow("↻ Restarting dashboard..."))
      shuttingDown = false
      startDashboard()
    })

    const shutdown = () => {
      shuttingDown = true
      watcher.close()
      dashProc?.kill()
      ngrokProc?.kill()
      process.exit(0)
    }

    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
  })

// ── issue ────────────────────────────────────────────────────────────────────
program
  .command("issue [description]")
  .description("Create a Linear issue (triggers agent automatically)")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--raw", "Skip Claude CLI expansion, use input as-is")
  .option("--parent <identifier>", "Create as sub-issue of the given parent (e.g. ACR-10)")
  .option("--blocked-by <identifier>", "Mark as blocked by the given issue (e.g. ACR-12)")
  .option("--breakdown", "Auto-decompose into sub-issues with dependency DAG")
  .action(
    async (
      description: string | undefined,
      opts: { yes?: boolean; raw?: boolean; parent?: string; blockedBy?: string; breakdown?: boolean },
    ) => {
      const { createIssue } = await import("./issue")
      await createIssue(description, {
        yes: opts.yes,
        raw: opts.raw,
        parent: opts.parent,
        blockedBy: opts.blockedBy,
        breakdown: opts.breakdown,
      })
    },
  )

// ── status ───────────────────────────────────────────────────────────────────
program
  .command("status")
  .description("Show orchestrator status")
  .action(async () => {
    const port = process.env.SERVER_PORT ?? "9741"
    const pids = readPids()

    // Daemon status
    if (pids) {
      const dashAlive = isProcessAlive(pids.dashboard)
      const ngrokAlive = pids.ngrok ? isProcessAlive(pids.ngrok) : false
      console.log(dashAlive ? pc.green(`● Dashboard running (pid: ${pids.dashboard})`) : pc.red("○ Dashboard dead"))
      console.log(ngrokAlive ? pc.green(`● ngrok running (pid: ${pids.ngrok})`) : pc.dim("○ ngrok not running"))
      console.log()
    }

    // Orchestrator status
    try {
      const res = await fetch(`http://localhost:${port}/api/status`)
      const data = await res.json()
      console.log(JSON.stringify(data, null, 2))
    } catch {
      console.log(pc.red(`Server is not responding on port ${port}`))
    }
  })

// ── login ────────────────────────────────────────────────────────────────────
program
  .command("login")
  .description("Login to Agent Valley team (Supabase auth)")
  .action(async () => {
    const { login } = await import("./login")
    await login()
  })

// ── logout ───────────────────────────────────────────────────────────────────
program
  .command("logout")
  .description("Logout from Agent Valley team")
  .action(async () => {
    const { logout } = await import("./login")
    await logout()
  })

// ── default: show help ───────────────────────────────────────────────────────
program.action(() => {
  program.help()
})

program.parse()
