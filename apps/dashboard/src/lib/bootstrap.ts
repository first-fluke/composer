/**
 * Orchestrator bootstrap — Node.js only.
 * Separated from instrumentation.ts to avoid Edge Runtime static analysis warnings.
 */

import path from "node:path"
import { toOrchestratorConfig } from "@/lib/env"
import { configureLogger, logger } from "@agent-valley/core/observability/logger"
import { Orchestrator } from "@agent-valley/core/orchestrator/orchestrator"
import { setOrchestrator } from "@/lib/orchestrator-singleton"

export async function bootstrap() {
  // CWD is apps/dashboard/ — move to project root so Orchestrator finds WORKFLOW.md
  process.chdir(path.resolve(process.cwd(), "../.."))

  const config = toOrchestratorConfig()
  configureLogger(config.logLevel, config.logFormat)

  const orchestrator = new Orchestrator(config)
  await orchestrator.start()

  const handlers = orchestrator.getHandlers()
  setOrchestrator({
    getStatus: handlers.getStatus,
    handleWebhook: handlers.onWebhook,
  })

  logger.info("instrumentation", "Symphony Orchestrator initialized")
}
