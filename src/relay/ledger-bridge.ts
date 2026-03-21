/**
 * LedgerBridge — Listens to Orchestrator events and publishes to LedgerEventPublisher.
 * Fire-and-forget: Supabase failures must never stop the Orchestrator.
 */

import type { LedgerEventPublisher } from "../domain/ledger"
import { logger } from "../observability/logger"
import type { Orchestrator } from "../orchestrator/orchestrator"

export class LedgerBridge {
  private handlers = new Map<string, (payload: Record<string, unknown>) => void>()

  constructor(
    private orchestrator: Orchestrator,
    private publisher: LedgerEventPublisher,
    private nodeId: string,
  ) {
    this.register("node.join", (payload) => this.publish("node.join", payload))
    this.register("node.leave", (payload) => this.publish("node.leave", payload))
    this.register("agent.start", (payload) => this.publish("agent.start", payload))
    this.register("agent.done", (payload) => this.publish("agent.done", payload))
    this.register("agent.failed", (payload) => this.publish("agent.failed", payload))
    this.register("agent.cancelled", (payload) => this.publish("agent.cancelled", payload))
  }

  private register(event: string, handler: (payload: Record<string, unknown>) => void): void {
    this.handlers.set(event, handler)
    this.orchestrator.on(event, handler)
  }

  private publish(type: string, payload: Record<string, unknown>): void {
    this.publisher
      .publish({
        type: type as any,
        nodeId: this.nodeId,
        clientTimestamp: new Date().toISOString(),
        payload: payload as any,
      })
      .catch((err) => {
        logger.warn("ledger-bridge", `Failed to publish ${type} event`, { error: String(err) })
      })
  }

  async dispose(): Promise<void> {
    for (const [event, handler] of this.handlers) {
      this.orchestrator.off(event, handler)
    }
    this.handlers.clear()
    await this.publisher.dispose()
  }
}
