/**
 * Symphony Orchestrator — Entry Point
 *
 * Usage:
 *   bun run src/main.ts
 *
 * HTTP endpoints are served by the Next.js dashboard (dashboard/).
 * This process runs the orchestrator only.
 */

import { isTeamMode, loadConfig } from "./config/env"
import { configureLogger, logger } from "./observability/logger"
import { Orchestrator } from "./orchestrator/orchestrator"
import type { LedgerBridge } from "./relay/ledger-bridge"

// Load config (exits on validation failure)
const config = loadConfig()

// Configure logger
configureLogger(config.logLevel, config.logFormat)

// Create and start orchestrator
const orchestrator = new Orchestrator(config)

// Team mode: wire up LedgerBridge for Supabase broadcasting
let bridge: LedgerBridge | null = null

if (isTeamMode(config)) {
  const { generateNodeId } = await import("./relay/node-id")
  const { SupabaseLedgerClient } = await import("./relay/supabase-ledger-client")
  const { LedgerBridge: Bridge } = await import("./relay/ledger-bridge")
  const { loadCredentials } = await import("./cli/login")

  const creds = loadCredentials()
  if (!creds || creds.expiresAt <= Date.now()) {
    logger.error("main", "Team mode requires login or token has expired. Run `bun av login` first.")
    process.exit(1)
  }

  const nodeId = generateNodeId()
  const publisher = new SupabaseLedgerClient(
    config.supabaseUrl ?? "",
    config.supabaseAnonKey ?? "",
    creds.accessToken,
    nodeId,
    config.teamId ?? "",
    creds.userId,
  )
  bridge = new Bridge(orchestrator, publisher, nodeId)

  logger.info("main", `Team mode enabled — nodeId: ${nodeId}, user: ${creds.email}`)
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info("main", `${signal} received`)
  await orchestrator.stop()
  await bridge?.dispose()
  process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))

// Start
logger.info("main", "Symphony Orchestrator starting...")
await orchestrator.start()

logger.info("main", "Symphony Orchestrator ready")
