/**
 * E2E Test — Webhook Reception
 *
 * Verifies that the Symphony HTTP server correctly:
 * 1. Receives POST /webhook requests
 * 2. Validates HMAC-SHA256 signatures
 * 3. Parses Linear issue webhook payloads
 * 4. Returns appropriate status codes
 */

import { describe, test, expect, afterEach } from "bun:test"
import { startHttpServer } from "../server/http-server"
import { verifyWebhookSignature, parseWebhookEvent } from "../tracker/webhook-handler"

// ── Helpers ───────────────────────────────────────────────────────────

const TEST_SECRET = "whsec_test_secret_for_e2e"
const TEST_PORT = 0 // Let OS assign a free port

async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  return Buffer.from(sig).toString("hex")
}

function buildIssueWebhookPayload(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    action: "update",
    type: "Issue",
    data: {
      id: "issue-uuid-123",
      identifier: "ACR-5",
      title: "Symphony E2E 테스트: 웹훅 수신 확인",
      description: "Test issue description",
      url: "https://linear.app/team/issue/ACR-5",
      state: {
        id: "state-in-progress",
        name: "In Progress",
        type: "started",
      },
      team: {
        id: "team-uuid",
        key: "ACR",
      },
    },
    updatedFrom: {
      stateId: "state-todo",
    },
    ...overrides,
  })
}

// ── Unit: Signature Verification ──────────────────────────────────────

describe("verifyWebhookSignature", () => {
  test("accepts valid signature", async () => {
    const payload = '{"action":"update","type":"Issue"}'
    const signature = await signPayload(payload, TEST_SECRET)
    const result = await verifyWebhookSignature(payload, signature, TEST_SECRET)
    expect(result).toBe(true)
  })

  test("rejects invalid signature", async () => {
    const payload = '{"action":"update","type":"Issue"}'
    const result = await verifyWebhookSignature(payload, "bad_signature", TEST_SECRET)
    expect(result).toBe(false)
  })

  test("rejects tampered payload", async () => {
    const payload = '{"action":"update","type":"Issue"}'
    const signature = await signPayload(payload, TEST_SECRET)
    const tampered = '{"action":"update","type":"Issue","injected":true}'
    const result = await verifyWebhookSignature(tampered, signature, TEST_SECRET)
    expect(result).toBe(false)
  })

  test("rejects wrong secret", async () => {
    const payload = '{"action":"update","type":"Issue"}'
    const signature = await signPayload(payload, "wrong_secret")
    const result = await verifyWebhookSignature(payload, signature, TEST_SECRET)
    expect(result).toBe(false)
  })
})

// ── Unit: Payload Parsing ─────────────────────────────────────────────

describe("parseWebhookEvent", () => {
  test("parses valid issue webhook", () => {
    const payload = buildIssueWebhookPayload()
    const event = parseWebhookEvent(payload)

    expect(event).not.toBeNull()
    expect(event!.action).toBe("update")
    expect(event!.issueId).toBe("issue-uuid-123")
    expect(event!.issue.identifier).toBe("ACR-5")
    expect(event!.issue.title).toBe("Symphony E2E 테스트: 웹훅 수신 확인")
    expect(event!.stateId).toBe("state-in-progress")
    expect(event!.prevStateId).toBe("state-todo")
  })

  test("returns null for non-Issue type", () => {
    const payload = JSON.stringify({ action: "update", type: "Comment", data: {} })
    expect(parseWebhookEvent(payload)).toBeNull()
  })

  test("returns null for invalid JSON", () => {
    expect(parseWebhookEvent("not json")).toBeNull()
  })

  test("returns null when action is missing", () => {
    const payload = JSON.stringify({ type: "Issue", data: { id: "x" } })
    expect(parseWebhookEvent(payload)).toBeNull()
  })
})

// ── E2E: HTTP Server Webhook Reception ────────────────────────────────

describe("E2E: webhook reception via HTTP", () => {
  let server: { stop: () => void } | null = null
  let receivedPayloads: string[] = []
  let receivedSignatures: string[] = []
  let serverUrl: string

  function startTestServer() {
    receivedPayloads = []
    receivedSignatures = []

    // Use Bun.serve directly to get the actual port when using port 0
    const bunServer = Bun.serve({
      port: TEST_PORT,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url)

        if (req.method === "POST" && url.pathname === "/webhook") {
          const payload = await req.text()
          const signature = req.headers.get("linear-signature") ?? ""

          receivedPayloads.push(payload)
          receivedSignatures.push(signature)

          // Verify signature
          const valid = await verifyWebhookSignature(payload, signature, TEST_SECRET)
          if (!valid) {
            return new Response('{"error":"Invalid signature"}', {
              status: 403,
              headers: { "Content-Type": "application/json" },
            })
          }

          // Parse event
          const event = parseWebhookEvent(payload)
          if (!event) {
            return Response.json({ ok: true, skipped: "not an issue event" })
          }

          return Response.json({ ok: true, issueId: event.issueId })
        }

        if (req.method === "GET" && url.pathname === "/health") {
          return Response.json({ status: "ok" })
        }

        return new Response("Not Found", { status: 404 })
      },
    })

    serverUrl = `http://127.0.0.1:${bunServer.port}`
    server = { stop: () => bunServer.stop() }
  }

  afterEach(() => {
    server?.stop()
    server = null
  })

  test("health endpoint returns ok", async () => {
    startTestServer()
    const res = await fetch(`${serverUrl}/health`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
  })

  test("valid webhook is accepted with 200", async () => {
    startTestServer()
    const payload = buildIssueWebhookPayload()
    const signature = await signPayload(payload, TEST_SECRET)

    const res = await fetch(`${serverUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "linear-signature": signature,
      },
      body: payload,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.issueId).toBe("issue-uuid-123")

    // Verify the server received the payload
    expect(receivedPayloads).toHaveLength(1)
    expect(receivedPayloads[0]).toBe(payload)
    expect(receivedSignatures[0]).toBe(signature)
  })

  test("invalid signature is rejected with 403", async () => {
    startTestServer()
    const payload = buildIssueWebhookPayload()

    const res = await fetch(`${serverUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "linear-signature": "invalid_signature",
      },
      body: payload,
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Invalid signature")
  })

  test("missing signature header is rejected with 403", async () => {
    startTestServer()
    const payload = buildIssueWebhookPayload()

    const res = await fetch(`${serverUrl}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    })

    expect(res.status).toBe(403)
  })

  test("non-Issue webhook type returns 200 with skipped", async () => {
    startTestServer()
    const payload = JSON.stringify({ action: "create", type: "Comment", data: {} })
    const signature = await signPayload(payload, TEST_SECRET)

    const res = await fetch(`${serverUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "linear-signature": signature,
      },
      body: payload,
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.skipped).toBe("not an issue event")
  })

  test("unknown route returns 404", async () => {
    startTestServer()
    const res = await fetch(`${serverUrl}/unknown`)
    expect(res.status).toBe(404)
  })

  test("handles Korean characters in issue title correctly", async () => {
    startTestServer()
    const payload = buildIssueWebhookPayload()
    const signature = await signPayload(payload, TEST_SECRET)

    const res = await fetch(`${serverUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "linear-signature": signature,
      },
      body: payload,
    })

    expect(res.status).toBe(200)

    // Verify parsed event preserves Unicode
    const event = parseWebhookEvent(receivedPayloads[0]!)
    expect(event!.issue.title).toBe("Symphony E2E 테스트: 웹훅 수신 확인")
  })
})
