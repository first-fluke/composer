/**
 * Symphony Orchestrator — Entry Point
 *
 * Usage:
 *   bun run src/main.ts
 */

import { loadConfig } from "./config/config"
import { configureLogger, logger } from "./observability/logger"
import { Orchestrator } from "./orchestrator/orchestrator"

// Load config (exits on validation failure)
const config = loadConfig()

// Configure logger
configureLogger(config.logLevel, config.logFormat)

// Create and start orchestrator
const orchestrator = new Orchestrator(config)

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("main", "SIGTERM received")
  await orchestrator.stop()
  process.exit(0)
})

process.on("SIGINT", async () => {
  logger.info("main", "SIGINT received")
  await orchestrator.stop()
  process.exit(0)
})

// Start
logger.info("main", "Symphony Orchestrator starting...")
await orchestrator.start()
logger.info("main", `Symphony ready — listening on :${config.serverPort}`)
