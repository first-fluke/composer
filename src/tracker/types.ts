/**
 * Tracker types — Linear webhook and API response types.
 */

import type { Issue } from "../domain/models"

export interface WebhookEvent {
  action: "create" | "update" | "remove"
  issueId: string
  issue: Issue
  stateId: string
  prevStateId: string | null
}

export interface LinearGraphQLResponse {
  data?: {
    issues?: {
      nodes: LinearIssueNode[]
    }
  }
  errors?: Array<{ message: string }>
}

export interface LinearIssueNode {
  id: string
  identifier: string
  title: string
  description: string
  url: string
  state: { id: string; name: string; type: string }
  team: { id: string; key: string }
}
