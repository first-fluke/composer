/**
 * Dashboard-side TeamState types.
 * Reuses AgentType and ActiveIssue from domain. Adds serializable TeamNode (array-based).
 */

export type { AgentType, ActiveIssue } from "@agent-valley/domain/ledger"
import type { AgentType, ActiveIssue } from "@agent-valley/domain/ledger"

export interface TeamNode {
  nodeId: string
  displayName: string
  defaultAgentType: AgentType
  maxParallel: number
  online: boolean
  joinedAt: string
  activeIssues: ActiveIssue[]
}

export interface TeamState {
  nodes: TeamNode[]
  lastSeq: number
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error"
