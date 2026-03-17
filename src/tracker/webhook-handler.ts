/**
 * Webhook Handler — Verify Linear webhook signatures and parse payloads.
 */

import type { Issue } from "../domain/models"
import type { WebhookEvent } from "./types"
import { logger } from "../observability/logger"

/**
 * Verify HMAC-SHA256 webhook signature.
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  const expected = Buffer.from(sig).toString("hex")

  // Constant-time comparison
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Parse Linear webhook payload into a WebhookEvent.
 */
export function parseWebhookEvent(payload: string): WebhookEvent | null {
  try {
    const data = JSON.parse(payload) as Record<string, unknown>

    const action = data.action as string | undefined
    const type = data.type as string | undefined
    if (type !== "Issue" || !action) return null

    const issueData = data.data as Record<string, unknown> | undefined
    if (!issueData) return null

    const stateData = issueData.state as Record<string, unknown> | undefined
    const teamData = issueData.team as Record<string, unknown> | undefined

    const issue: Issue = {
      id: issueData.id as string,
      identifier: issueData.identifier as string,
      title: (issueData.title as string) ?? "",
      description: (issueData.description as string) ?? "",
      url: (issueData.url as string) ?? "",
      status: {
        id: (stateData?.id as string) ?? "",
        name: (stateData?.name as string) ?? "",
        type: (stateData?.type as string) ?? "",
      },
      team: {
        id: (teamData?.id as string) ?? "",
        key: (teamData?.key as string) ?? "",
      },
    }

    const updatedFrom = data.updatedFrom as Record<string, unknown> | undefined
    const prevStateId = (updatedFrom?.stateId as string) ?? null
    const stateId = stateData?.id as string ?? ""

    return {
      action: action as WebhookEvent["action"],
      issueId: issue.id,
      issue,
      stateId,
      prevStateId,
    }
  } catch (err) {
    logger.error("tracker-client", "Failed to parse webhook payload", { error: String(err) })
    return null
  }
}
