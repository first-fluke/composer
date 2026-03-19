/**
 * E2E Test: Todo lifecycle flow
 *
 * Verifies that Symphony:
 * 1. Receives a webhook when an issue transitions to "In Progress"
 * 2. Creates an isolated workspace (git worktree)
 * 3. Spawns an agent session
 * 4. Handles agent completion and cleans up state
 * 5. Handles duplicate/concurrent webhook events correctly
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test"
import { registerSession, createSession } from "../src/sessions/session-factory"
import type { AgentSession, AgentConfig, AgentEventHandler, AgentEventType, AgentEvent } from "../src/sessions/agent-session"
import { configureLogger } from "../src/observability/logger"

// ── Fake AgentSession ─────────────────────────────────────────────────────────

class FakeAgentSession implements AgentSession {
  private listeners = new Map<string, Set<AgentEventHandler<any>>>()
  private _isAlive = false
  private autoComplete: boolean

  constructor(autoComplete = true) {
    this.autoComplete = autoComplete
  }

  async start(_config: AgentConfig): Promise<void> {
    this._isAlive = true
  }

  async execute(_prompt: string): Promise<void> {
    if (this.autoComplete) {
      // Simulate agent completing work after a short delay
      setTimeout(() => {
        this.emit({
          type: "complete",
          result: {
            exitCode: 0,
            output: "Work completed successfully",
            durationMs: 100,
            filesChanged: ["src/example.ts"],
          },
        })
        this._isAlive = false
      }, 50)
    }
  }

  async cancel(): Promise<void> {
    this._isAlive = false
  }

  async kill(): Promise<void> {
    this._isAlive = false
  }

  isAlive(): boolean {
    return this._isAlive
  }

  on<T extends AgentEventType>(event: T, handler: AgentEventHandler<T>): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(handler)
  }

  off<T extends AgentEventType>(event: T, handler: AgentEventHandler<T>): void {
    this.listeners.get(event)?.delete(handler)
  }

  async dispose(): Promise<void> {
    this._isAlive = false
    this.listeners.clear()
  }

  /** Emit an event to registered listeners */
  emit(event: AgentEvent): void {
    const handlers = this.listeners.get(event.type)
    if (handlers) {
      for (const handler of handlers) handler(event)
    }
  }
}

// ── Test Helpers ──────────────────────────────────────────────────────────────

const TEST_PORT = 19876
const TEST_WEBHOOK_SECRET = "test-secret-12345"
const TEST_IN_PROGRESS_STATE = "state-in-progress-uuid"
const TEST_DONE_STATE = "state-done-uuid"
const TEST_CANCELLED_STATE = "state-cancelled-uuid"

async function computeHmacSignature(payload: string, secret: string): Promise<string> {
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

function makeIssueWebhookPayload(overrides: {
  issueId?: string
  identifier?: string
  title?: string
  stateId?: string
  stateName?: string
  prevStateId?: string | null
  action?: string
} = {}): string {
  const payload: Record<string, unknown> = {
    action: overrides.action ?? "update",
    type: "Issue",
    data: {
      id: overrides.issueId ?? "issue-uuid-1",
      identifier: overrides.identifier ?? "ACR-99",
      title: overrides.title ?? "Test issue",
      description: "A test issue for E2E",
      url: "https://linear.app/test/issue/ACR-99",
      state: {
        id: overrides.stateId ?? TEST_IN_PROGRESS_STATE,
        name: overrides.stateName ?? "In Progress",
        type: "started",
      },
      team: {
        id: "team-uuid",
        key: "ACR",
      },
    },
    updatedFrom: overrides.prevStateId !== undefined
      ? { stateId: overrides.prevStateId }
      : { stateId: "state-todo-uuid" },
  }
  return JSON.stringify(payload)
}

async function sendWebhook(
  payload: string,
  port: number = TEST_PORT,
  secret: string = TEST_WEBHOOK_SECRET,
): Promise<Response> {
  const signature = await computeHmacSignature(payload, secret)
  return fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "linear-signature": signature,
    },
    body: payload,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Todo lifecycle E2E", () => {
  let orchestrator: InstanceType<typeof import("../src/orchestrator/orchestrator").Orchestrator>
  let fakeSessionInstances: FakeAgentSession[]

  beforeAll(() => {
    // Suppress log noise during tests
    configureLogger("error", "text")

    // Register a fake agent session
    fakeSessionInstances = []
    registerSession("fake", () => {
      const session = new FakeAgentSession()
      fakeSessionInstances.push(session)
      return session
    })
  })

  beforeEach(() => {
    fakeSessionInstances = []
  })

  afterAll(async () => {
    if (orchestrator) {
      await orchestrator.stop()
    }
  })

  test("health endpoint responds before orchestrator processes webhooks", async () => {
    // Import and create orchestrator with test config
    const { Orchestrator } = await import("../src/orchestrator/orchestrator")

    // Mock the startup sync to avoid real Linear API calls
    const originalFetch = globalThis.fetch
    const mockFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes("linear.app/graphql")) {
        return new Response(JSON.stringify({ data: { issues: { nodes: [] } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      return originalFetch(input, init)
    }
    globalThis.fetch = Object.assign(mockFetch, { preconnect: originalFetch.preconnect }) as typeof fetch

    orchestrator = new Orchestrator({
      linearApiKey: "lin_api_test",
      linearTeamId: "ACR",
      linearTeamUuid: "team-uuid",
      linearWebhookSecret: TEST_WEBHOOK_SECRET,
      workflowStates: {
        inProgress: TEST_IN_PROGRESS_STATE,
        done: TEST_DONE_STATE,
        cancelled: TEST_CANCELLED_STATE,
      },
      workspaceRoot: "/tmp/symphony-test-workspaces",
      agentType: "fake",
      agentTimeout: 60,
      agentMaxRetries: 3,
      agentRetryDelay: 5,
      maxParallel: 3,
      serverPort: TEST_PORT,
      logLevel: "error",
      logFormat: "text",
    })

    // WORKFLOW.md already exists in the repo root — orchestrator reads it from cwd
    await orchestrator.start()

    // Restore fetch
    globalThis.fetch = originalFetch

    // Health endpoint should respond
    const healthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/health`)
    expect(healthRes.status).toBe(200)
    const healthBody = await healthRes.json() as Record<string, unknown>
    expect(healthBody.status).toBe("ok")
  })

  test("status endpoint shows orchestrator state", async () => {
    const statusRes = await fetch(`http://127.0.0.1:${TEST_PORT}/status`)
    expect(statusRes.status).toBe(200)
    const status = await statusRes.json() as Record<string, unknown>
    expect(status.isRunning).toBe(true)
    expect(status.activeAgents).toBe(0)
    expect(status.config).toBeDefined()
  })

  test("rejects webhook with invalid signature", async () => {
    const payload = makeIssueWebhookPayload()
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "linear-signature": "invalid-signature",
      },
      body: payload,
    })
    expect(res.status).toBe(403)
    const body = await res.json() as Record<string, string>
    expect(body.error).toBe("Invalid signature")
  })

  test("accepts webhook with valid signature and processes issue", async () => {
    // Mock workspace creation (git worktree)
    const origSpawn = Bun.spawn
    const spawnCalls: string[][] = []

    // @ts-expect-error - Mocking Bun.spawn for test
    Bun.spawn = (cmd: string[], opts?: Record<string, unknown>) => {
      spawnCalls.push(cmd)

      if (cmd[0] === "git" && cmd[1] === "worktree") {
        // Simulate worktree creation: create the directory
        const path = cmd[3] as string
        return {
          exited: Promise.resolve(0),
          exitCode: 0,
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
          pid: 12345,
          kill: () => {},
        }
      }

      if (cmd[0] === "mkdir") {
        return {
          exited: Promise.resolve(0),
          exitCode: 0,
        }
      }

      return origSpawn(cmd, opts)
    }

    const payload = makeIssueWebhookPayload({
      issueId: "issue-lifecycle-1",
      identifier: "ACR-100",
      title: "Lifecycle test issue",
      stateId: TEST_IN_PROGRESS_STATE,
    })

    const res = await sendWebhook(payload)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.ok).toBe(true)

    // Wait for async agent spawn
    await new Promise(resolve => setTimeout(resolve, 200))

    // Verify a workspace creation was attempted (git worktree add)
    const worktreeCall = spawnCalls.find(c => c[0] === "git" && c[1] === "worktree" && c[2] === "add")
    expect(worktreeCall).toBeDefined()
    expect(worktreeCall![4]).toBe("-b") // branch flag
    expect(worktreeCall![5]).toContain("symphony/") // branch name

    // Verify agent session was created
    expect(fakeSessionInstances.length).toBeGreaterThanOrEqual(1)

    // Wait for fake agent completion
    await new Promise(resolve => setTimeout(resolve, 200))

    // Check status — agent should have completed and been cleaned up
    const statusRes = await fetch(`http://127.0.0.1:${TEST_PORT}/status`)
    const status = await statusRes.json() as Record<string, unknown>
    expect(status.activeAgents).toBe(0)

    // Restore
    // @ts-expect-error - Restoring Bun.spawn
    Bun.spawn = origSpawn
  })

  test("skips duplicate issue when already active", async () => {
    const origSpawn = Bun.spawn
    let worktreeCalls = 0

    // Create a non-auto-completing session to keep the issue "active"
    registerSession("fake", () => {
      const session = new FakeAgentSession(false) // won't auto-complete
      fakeSessionInstances.push(session)
      return session
    })

    // @ts-expect-error - Mocking Bun.spawn for test
    Bun.spawn = (cmd: string[], opts?: Record<string, unknown>) => {
      if (cmd[0] === "git" && cmd[1] === "worktree") {
        worktreeCalls++
        return {
          exited: Promise.resolve(0),
          exitCode: 0,
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
          pid: 12345,
          kill: () => {},
        }
      }
      if (cmd[0] === "mkdir") {
        return { exited: Promise.resolve(0), exitCode: 0 }
      }
      return origSpawn(cmd, opts)
    }

    const issueId = "issue-dup-test"
    const payload = makeIssueWebhookPayload({
      issueId,
      identifier: "ACR-101",
      stateId: TEST_IN_PROGRESS_STATE,
    })

    // First webhook — should create workspace
    const res1 = await sendWebhook(payload)
    expect(res1.status).toBe(200)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(worktreeCalls).toBe(1)

    // Second webhook for same issue — should be skipped (duplicate)
    const res2 = await sendWebhook(payload)
    expect(res2.status).toBe(200)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(worktreeCalls).toBe(1) // no additional worktree created

    // Manually complete the session so cleanup happens
    for (const session of fakeSessionInstances) {
      session.emit({
        type: "complete",
        result: { exitCode: 0, output: "done", durationMs: 50, filesChanged: [] },
      })
    }
    await new Promise(resolve => setTimeout(resolve, 100))

    // Re-register auto-completing session for subsequent tests
    registerSession("fake", () => {
      const session = new FakeAgentSession()
      fakeSessionInstances.push(session)
      return session
    })

    // @ts-expect-error - Restoring Bun.spawn
    Bun.spawn = origSpawn
  })

  test("skips non-issue webhook events", async () => {
    const payload = JSON.stringify({
      action: "update",
      type: "Comment",
      data: { id: "comment-1" },
    })

    const res = await sendWebhook(payload)
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.skipped).toBe("not an issue event")
  })

  test("handles issue leaving In Progress", async () => {
    const origSpawn = Bun.spawn

    // Use non-auto-completing session
    registerSession("fake", () => {
      const session = new FakeAgentSession(false)
      fakeSessionInstances.push(session)
      return session
    })

    // @ts-expect-error - Mocking Bun.spawn
    Bun.spawn = (cmd: string[], opts?: Record<string, unknown>) => {
      if (cmd[0] === "git" && cmd[1] === "worktree") {
        return {
          exited: Promise.resolve(0),
          exitCode: 0,
          stdout: new ReadableStream(),
          stderr: new ReadableStream(),
          pid: 12345,
          kill: () => {},
        }
      }
      if (cmd[0] === "mkdir") {
        return { exited: Promise.resolve(0), exitCode: 0 }
      }
      return origSpawn(cmd, opts)
    }

    const issueId = "issue-leave-ip"

    // Move to In Progress
    const inProgressPayload = makeIssueWebhookPayload({
      issueId,
      identifier: "ACR-102",
      stateId: TEST_IN_PROGRESS_STATE,
    })
    await sendWebhook(inProgressPayload)
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify workspace is active
    let statusRes = await fetch(`http://127.0.0.1:${TEST_PORT}/status`)
    let status = await statusRes.json() as Record<string, unknown>
    const workspaces = status.activeWorkspaces as Array<{ issueId: string }>
    expect(workspaces.some(w => w.issueId === issueId)).toBe(true)

    // Move issue OUT of In Progress (to Done)
    const donePayload = makeIssueWebhookPayload({
      issueId,
      identifier: "ACR-102",
      stateId: TEST_DONE_STATE,
      stateName: "Done",
      prevStateId: TEST_IN_PROGRESS_STATE,
    })
    await sendWebhook(donePayload)
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify workspace was removed
    statusRes = await fetch(`http://127.0.0.1:${TEST_PORT}/status`)
    status = await statusRes.json() as Record<string, unknown>
    const updatedWorkspaces = status.activeWorkspaces as Array<{ issueId: string }>
    expect(updatedWorkspaces.some(w => w.issueId === issueId)).toBe(false)

    // Re-register auto-completing session
    registerSession("fake", () => {
      const session = new FakeAgentSession()
      fakeSessionInstances.push(session)
      return session
    })

    // @ts-expect-error - Restoring
    Bun.spawn = origSpawn
  })

  test("webhook signature verification works with correct secret", async () => {
    const { verifyWebhookSignature } = await import("../src/tracker/webhook-handler")

    const payload = '{"test":"data"}'
    const signature = await computeHmacSignature(payload, TEST_WEBHOOK_SECRET)

    const valid = await verifyWebhookSignature(payload, signature, TEST_WEBHOOK_SECRET)
    expect(valid).toBe(true)

    const invalid = await verifyWebhookSignature(payload, "wrong-sig", TEST_WEBHOOK_SECRET)
    expect(invalid).toBe(false)
  })

  test("webhook event parsing extracts issue fields correctly", async () => {
    const { parseWebhookEvent } = await import("../src/tracker/webhook-handler")

    const payload = makeIssueWebhookPayload({
      issueId: "parse-test-id",
      identifier: "ACR-200",
      title: "Parse test",
      stateId: "state-123",
      prevStateId: "state-456",
    })

    const event = parseWebhookEvent(payload)
    expect(event).not.toBeNull()
    expect(event!.issueId).toBe("parse-test-id")
    expect(event!.issue.identifier).toBe("ACR-200")
    expect(event!.issue.title).toBe("Parse test")
    expect(event!.stateId).toBe("state-123")
    expect(event!.prevStateId).toBe("state-456")
  })

  test("prompt template renders issue variables correctly", async () => {
    const { renderPrompt } = await import("../src/config/workflow-loader")

    const issue = {
      id: "id-1",
      identifier: "ACR-42",
      title: "Fix the thing",
      description: "It is broken",
      status: { id: "s1", name: "In Progress", type: "started" },
      team: { id: "t1", key: "ACR" },
      url: "https://linear.app/test/issue/ACR-42",
    }

    const attempt = {
      id: "attempt-uuid",
      issueId: "id-1",
      workspacePath: "/tmp/ws",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      agentOutput: null,
    }

    const template = "Issue: {{issue.identifier}} — {{issue.title}}\nPath: {{workspace_path}}\nAttempt: {{attempt.id}} retry={{retry_count}}"
    const rendered = renderPrompt(template, issue, "/tmp/ws", attempt, 2)

    expect(rendered).toBe("Issue: ACR-42 — Fix the thing\nPath: /tmp/ws\nAttempt: attempt-uuid retry=2")
  })
})
