/**
 * Webhook Handler — Verify Linear webhook signatures and parse payloads.
 */

import { z } from "zod/v4"
import type { Issue } from "../domain/models"
import { parseScoreFromLabels } from "../domain/models"
import { logger } from "../observability/logger"
import type { WebhookEvent } from "./types"

/**
 * Verify HMAC-SHA256 webhook signature.
 */
export async function verifyWebhookSignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ])
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

// ── Webhook Payload Schema ──────────────────────────────────────────

const webhookPayloadSchema = z.object({
  action: z.enum(["create", "update", "remove"]),
  type: z.string(),
  data: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string().optional().default(""),
    description: z.string().nullable().optional().default(""),
    url: z.string().optional().default(""),
    state: z
      .object({
        id: z.string(),
        name: z.string().optional().default(""),
        type: z.string().optional().default(""),
      })
      .optional(),
    team: z
      .object({
        id: z.string().optional().default(""),
        key: z.string().optional().default(""),
      })
      .optional(),
    labels: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      )
      .optional()
      .default([]),
  }),
  updatedFrom: z
    .object({
      stateId: z.string(),
    })
    .optional(),
})

/**
 * Parse Linear webhook payload into a WebhookEvent.
 */
export function parseWebhookEvent(payload: string): WebhookEvent | null {
  try {
    const raw = JSON.parse(payload)
    const result = webhookPayloadSchema.safeParse(raw)

    if (!result.success) {
      logger.error("tracker-client", "Webhook payload validation failed", {
        error: result.error.message,
      })
      return null
    }

    const data = result.data

    if (data.type !== "Issue") return null

    const issue: Issue = {
      id: data.data.id,
      identifier: data.data.identifier,
      title: data.data.title,
      description: data.data.description ?? "",
      url: data.data.url,
      status: {
        id: data.data.state?.id ?? "",
        name: data.data.state?.name ?? "",
        type: data.data.state?.type ?? "",
      },
      team: {
        id: data.data.team?.id ?? "",
        key: data.data.team?.key ?? "",
      },
      labels: data.data.labels.map((l) => l.name),
      score: parseScoreFromLabels(data.data.labels.map((l) => l.name)),
    }

    const stateId = data.data.state?.id ?? ""
    const prevStateId = data.updatedFrom?.stateId ?? null

    return {
      action: data.action,
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
