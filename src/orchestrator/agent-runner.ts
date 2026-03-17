/**
 * Agent Runner — Manages AgentSession lifecycle for issue execution.
 */

import type { Issue, Workspace, RunAttempt } from "../domain/models"
import type { AgentConfig, AgentEvent } from "../sessions/agent-session"
import { createSession, registerBuiltinSessions } from "../sessions/session-factory"
import type { AgentSession } from "../sessions/agent-session"
import { logger } from "../observability/logger"

let sessionsRegistered = false

export interface RunOptions {
  agentType: string
  model?: string
  timeout: number
  prompt: string
  workspacePath: string
  env?: Record<string, string>
}

export interface RunCallbacks {
  onComplete: (result: RunAttempt) => void
  onError: (error: { code: string; message: string; recoverable: boolean }) => void
  onHeartbeat: (timestamp: string) => void
}

export class AgentRunnerService {
  private activeSessions = new Map<string, AgentSession>()

  async ensureRegistered(): Promise<void> {
    if (!sessionsRegistered) {
      await registerBuiltinSessions()
      sessionsRegistered = true
    }
  }

  async spawn(
    attempt: RunAttempt,
    options: RunOptions,
    callbacks: RunCallbacks,
  ): Promise<void> {
    await this.ensureRegistered()

    const session = createSession(options.agentType)
    this.activeSessions.set(attempt.id, session)

    // Wire up events
    session.on("heartbeat", (e) => callbacks.onHeartbeat(e.timestamp))

    session.on("complete", (e) => {
      const completed: RunAttempt = {
        ...attempt,
        finishedAt: new Date().toISOString(),
        exitCode: e.result.exitCode,
        agentOutput: e.result.output,
      }
      this.activeSessions.delete(attempt.id)
      callbacks.onComplete(completed)
    })

    session.on("error", (e) => {
      this.activeSessions.delete(attempt.id)
      callbacks.onError(e.error)
    })

    // Start session
    const config: AgentConfig = {
      type: options.agentType,
      model: options.model,
      timeout: options.timeout,
      workspacePath: options.workspacePath,
      env: options.env,
    }

    try {
      await session.start(config)
      await session.execute(options.prompt)

      logger.info("orchestrator", "Agent started", {
        issueId: attempt.issueId,
        attemptId: attempt.id,
        workspacePath: options.workspacePath,
      })
    } catch (err) {
      this.activeSessions.delete(attempt.id)
      callbacks.onError({
        code: "CRASH",
        message: `Failed to start agent: ${err}`,
        recoverable: true,
      })
    }

    // Timeout watchdog
    setTimeout(async () => {
      if (this.activeSessions.has(attempt.id)) {
        logger.warn("orchestrator", "Agent timed out", {
          attemptId: attempt.id,
          issueId: attempt.issueId,
          durationMs: options.timeout * 1000,
        })
        await this.kill(attempt.id)
        callbacks.onError({
          code: "TIMEOUT",
          message: `Agent timed out after ${options.timeout}s`,
          recoverable: true,
        })
      }
    }, options.timeout * 1000)
  }

  async kill(attemptId: string): Promise<void> {
    const session = this.activeSessions.get(attemptId)
    if (!session) return

    await session.cancel()
    // Give 10 seconds for graceful shutdown
    setTimeout(async () => {
      if (session.isAlive()) {
        await session.kill()
      }
      await session.dispose()
    }, 10_000)

    this.activeSessions.delete(attemptId)
  }

  async killAll(): Promise<void> {
    const ids = Array.from(this.activeSessions.keys())
    await Promise.all(ids.map((id) => this.kill(id)))
  }

  get activeCount(): number {
    return this.activeSessions.size
  }
}
