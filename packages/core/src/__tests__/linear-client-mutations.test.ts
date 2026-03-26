/**
 * Linear client mutation tests — updateIssueState, addIssueComment,
 * addIssueLabel, createSubIssue, fetchIssuesByState, fetchIssueLabels.
 */
import { describe, expect, test, vi } from "vitest"

// ── Shared mock helpers ─────────────────────────────────────────────

interface MockFetchOpts {
  data: unknown
  status?: number
  headers?: Record<string, string>
}

function mockFetch(opts: MockFetchOpts): {
  getCaptured: () => { query: string; variables: Record<string, unknown> }
  getCallCount: () => number
  restore: () => void
} {
  const original = globalThis.fetch
  let captured = { query: "", variables: {} as Record<string, unknown> }
  let callCount = 0

  globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    callCount++
    const body = JSON.parse(init?.body as string)
    captured = { query: body.query, variables: body.variables }
    return new Response(JSON.stringify({ data: opts.data }), {
      status: opts.status ?? 200,
      headers: { "Content-Type": "application/json", ...opts.headers },
    })
  }) as unknown as typeof fetch

  return {
    getCaptured: () => captured,
    getCallCount: () => callCount,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function mockFetchSequence(responses: MockFetchOpts[]): {
  getAllCaptured: () => Array<{ query: string; variables: Record<string, unknown> }>
  restore: () => void
} {
  const original = globalThis.fetch
  const captured: Array<{ query: string; variables: Record<string, unknown> }> = []
  let callIdx = 0

  globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string)
    captured.push({ query: body.query, variables: body.variables })
    const lastResp = responses[responses.length - 1]
    const resp = responses[callIdx] ?? lastResp
    callIdx++
    return new Response(JSON.stringify({ data: resp.data }), {
      status: resp.status ?? 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as unknown as typeof fetch

  return {
    getAllCaptured: () => captured,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function mockFetchError(status: number, body = ""): { restore: () => void } {
  const original = globalThis.fetch
  globalThis.fetch = vi.fn(async () => {
    return new Response(body, {
      status,
      statusText: status === 401 ? "Unauthorized" : status === 429 ? "Too Many Requests" : "Error",
      headers: { "Content-Type": "application/json", "Retry-After": "30" },
    })
  }) as unknown as typeof fetch
  return {
    restore: () => {
      globalThis.fetch = original
    },
  }
}

// ── updateIssueState ───────────────────────────────────────────────

describe("updateIssueState", () => {
  test("sends correct mutation variables", async () => {
    const { updateIssueState } = await import("../tracker/linear-client")
    const { getCaptured, restore } = mockFetch({
      data: { issueUpdate: { success: true } },
    })

    try {
      await updateIssueState("lin_api_test", "issue-123", "state-done")
      expect(getCaptured().variables).toEqual({ issueId: "issue-123", stateId: "state-done" })
    } finally {
      restore()
    }
  })

  test("throws on unsuccessful mutation", async () => {
    const { updateIssueState } = await import("../tracker/linear-client")
    const { restore } = mockFetch({
      data: { issueUpdate: { success: false } },
    })

    try {
      await expect(updateIssueState("lin_api_test", "issue-123", "state-done")).rejects.toThrow(
        "Failed to update issue state",
      )
    } finally {
      restore()
    }
  })

  test("throws on 401 auth error", async () => {
    const { updateIssueState } = await import("../tracker/linear-client")
    const { restore } = mockFetchError(401)

    try {
      await expect(updateIssueState("bad-key", "i1", "s1")).rejects.toThrow("authentication failed")
    } finally {
      restore()
    }
  })

  test("throws on 429 rate limit", async () => {
    const { updateIssueState } = await import("../tracker/linear-client")
    const { restore } = mockFetchError(429)

    try {
      await expect(updateIssueState("key", "i1", "s1")).rejects.toThrow("rate limit")
    } finally {
      restore()
    }
  })
})

// ── addIssueComment ───────────────────────────────────────────────

describe("addIssueComment", () => {
  test("sends correct mutation variables", async () => {
    const { addIssueComment } = await import("../tracker/linear-client")
    const { getCaptured, restore } = mockFetch({
      data: { commentCreate: { success: true } },
    })

    try {
      await addIssueComment("lin_api_test", "issue-123", "Work summary here")
      expect(getCaptured().variables).toEqual({ issueId: "issue-123", body: "Work summary here" })
    } finally {
      restore()
    }
  })

  test("throws on unsuccessful comment creation", async () => {
    const { addIssueComment } = await import("../tracker/linear-client")
    const { restore } = mockFetch({
      data: { commentCreate: { success: false } },
    })

    try {
      await expect(addIssueComment("key", "i1", "body")).rejects.toThrow("Failed to add comment")
    } finally {
      restore()
    }
  })
})

// ── fetchIssueLabels ───────────────────────────────────────────────

describe("fetchIssueLabels", () => {
  test("returns label names", async () => {
    const { fetchIssueLabels } = await import("../tracker/linear-client")
    const { restore } = mockFetch({
      data: { issue: { labels: { nodes: [{ name: "backend" }, { name: "score:5" }] } } },
    })

    try {
      const labels = await fetchIssueLabels("key", "issue-1")
      expect(labels).toEqual(["backend", "score:5"])
    } finally {
      restore()
    }
  })

  test("returns empty array when no labels", async () => {
    const { fetchIssueLabels } = await import("../tracker/linear-client")
    const { restore } = mockFetch({
      data: { issue: { labels: { nodes: [] } } },
    })

    try {
      const labels = await fetchIssueLabels("key", "issue-1")
      expect(labels).toEqual([])
    } finally {
      restore()
    }
  })

  test("returns empty array when issue not found", async () => {
    const { fetchIssueLabels } = await import("../tracker/linear-client")
    const { restore } = mockFetch({ data: { issue: null } })

    try {
      const labels = await fetchIssueLabels("key", "nonexistent")
      expect(labels).toEqual([])
    } finally {
      restore()
    }
  })
})

// ── fetchIssuesByState ──────────────────────────────────────────────

describe("fetchIssuesByState", () => {
  const baseNode = {
    id: "issue-1",
    identifier: "ACR-1",
    title: "Test",
    description: "desc",
    url: "https://linear.app/acr/issue/ACR-1",
    state: { id: "s1", name: "Todo", type: "unstarted" },
    team: { id: "t1", key: "ACR" },
    labels: { nodes: [] },
    parent: null,
    children: { nodes: [] },
    relations: { nodes: [] },
  }

  test("fetches and maps issues to domain model", async () => {
    const { fetchIssuesByState } = await import("../tracker/linear-client")
    const { getCaptured, restore } = mockFetch({
      data: {
        team: {
          issues: {
            nodes: [baseNode],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    })

    try {
      const issues = await fetchIssuesByState("key", "team-uuid", ["s1"])
      expect(issues).toHaveLength(1)
      expect(issues[0]?.id).toBe("issue-1")
      expect(issues[0]?.identifier).toBe("ACR-1")
      expect(issues[0]?.parentId).toBeNull()
      expect(issues[0]?.children).toEqual([])
      expect(getCaptured().variables.stateIds).toEqual(["s1"])
    } finally {
      restore()
    }
  })

  test("handles pagination", async () => {
    const { fetchIssuesByState } = await import("../tracker/linear-client")
    const { getAllCaptured, restore } = mockFetchSequence([
      {
        data: {
          team: {
            issues: {
              nodes: [{ ...baseNode, id: "i1", identifier: "ACR-1" }],
              pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
            },
          },
        },
      },
      {
        data: {
          team: {
            issues: {
              nodes: [{ ...baseNode, id: "i2", identifier: "ACR-2" }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    ])

    try {
      const issues = await fetchIssuesByState("key", "team-uuid", ["s1"])
      expect(issues).toHaveLength(2)
      expect(getAllCaptured()).toHaveLength(2)
      expect(getAllCaptured()[1]?.variables.cursor).toBe("cursor-1")
    } finally {
      restore()
    }
  })

  test("maps parent, children, and relations", async () => {
    const { fetchIssuesByState } = await import("../tracker/linear-client")
    const { restore } = mockFetch({
      data: {
        team: {
          issues: {
            nodes: [
              {
                ...baseNode,
                parent: { id: "parent-1", identifier: "ACR-0" },
                children: { nodes: [{ id: "child-1", identifier: "ACR-2", state: baseNode.state }] },
                relations: {
                  nodes: [
                    { type: "blocks", relatedIssue: { id: "rel-1", identifier: "ACR-3", state: baseNode.state } },
                  ],
                },
                labels: { nodes: [{ name: "score:7" }] },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    })

    try {
      const issues = await fetchIssuesByState("key", "team-uuid", ["s1"])
      expect(issues).toHaveLength(1)
      const issue = issues[0] as (typeof issues)[number]
      expect(issue.parentId).toBe("parent-1")
      expect(issue.children).toEqual(["child-1"])
      expect(issue.relations).toHaveLength(1)
      expect(issue.relations[0]?.type).toBe("blocks")
      expect(issue.score).toBe(7)
    } finally {
      restore()
    }
  })

  test("throws on validation failure", async () => {
    const { fetchIssuesByState } = await import("../tracker/linear-client")
    const { restore } = mockFetch({
      data: { team: "invalid-not-an-object" },
    })

    try {
      await expect(fetchIssuesByState("key", "team-uuid", ["s1"])).rejects.toThrow()
    } finally {
      restore()
    }
  })
})

// ── addIssueLabel ─────────────────────────────────────────────────

describe("addIssueLabel", () => {
  test("finds existing label and attaches it", async () => {
    const { addIssueLabel } = await import("../tracker/linear-client")
    const { getAllCaptured, restore } = mockFetchSequence([
      // findLabel
      { data: { issueLabels: { nodes: [{ id: "label-1", name: "bug" }] } } },
      // fetchIssueLabelsById
      { data: { issue: { labels: { nodes: [{ id: "existing-label" }] } } } },
      // addLabelToIssue
      { data: { issueUpdate: { success: true } } },
    ])

    try {
      await addIssueLabel("key", "team-1", "issue-1", "bug")
      const calls = getAllCaptured()
      expect(calls).toHaveLength(3)
      // Last call should include both existing and new label IDs
      expect(calls[2]?.variables.labelIds).toContain("label-1")
      expect(calls[2]?.variables.labelIds).toContain("existing-label")
    } finally {
      restore()
    }
  })

  test("creates label when not found and attaches it", async () => {
    const { addIssueLabel } = await import("../tracker/linear-client")
    const { getAllCaptured, restore } = mockFetchSequence([
      // findLabel — not found
      { data: { issueLabels: { nodes: [] } } },
      // createLabel
      { data: { issueLabelCreate: { success: true, issueLabel: { id: "new-label-1" } } } },
      // fetchIssueLabelsById
      { data: { issue: { labels: { nodes: [] } } } },
      // addLabelToIssue
      { data: { issueUpdate: { success: true } } },
    ])

    try {
      await addIssueLabel("key", "team-1", "issue-1", "new-label")
      const calls = getAllCaptured()
      expect(calls).toHaveLength(4)
      expect(calls[3]?.variables.labelIds).toContain("new-label-1")
    } finally {
      restore()
    }
  })

  test("gracefully handles label creation failure", async () => {
    const { addIssueLabel } = await import("../tracker/linear-client")
    const { getAllCaptured, restore } = mockFetchSequence([
      // findLabel — not found
      { data: { issueLabels: { nodes: [] } } },
      // createLabel — fails (no issueLabel in response)
      { data: { issueLabelCreate: { success: false } } },
    ])

    try {
      // Should not throw — label attachment is non-critical
      await expect(addIssueLabel("key", "team-1", "issue-1", "bad-label")).resolves.toBeUndefined()
      expect(getAllCaptured()).toHaveLength(2)
    } finally {
      restore()
    }
  })

  test("catches and swallows errors (non-critical)", async () => {
    const { addIssueLabel } = await import("../tracker/linear-client")
    const { restore } = mockFetchError(500)

    try {
      await expect(addIssueLabel("key", "team-1", "issue-1", "label")).resolves.toBeUndefined()
    } finally {
      restore()
    }
  })
})

// ── createSubIssue ────────────────────────────────────────────────

describe("createSubIssue", () => {
  test("sends correct mutation and returns created issue", async () => {
    const { createSubIssue } = await import("../tracker/linear-client")
    const { getCaptured, restore } = mockFetch({
      data: {
        issueCreate: {
          success: true,
          issue: { id: "new-1", identifier: "ACR-10", title: "Sub task", url: "https://linear.app/acr/issue/ACR-10" },
        },
      },
    })

    try {
      const result = await createSubIssue("key", "team-1", "parent-1", "Sub task", "Description", "state-todo")
      expect(result.id).toBe("new-1")
      expect(result.identifier).toBe("ACR-10")
      expect(getCaptured().variables).toEqual({
        teamId: "team-1",
        parentId: "parent-1",
        title: "Sub task",
        description: "Description",
        stateId: "state-todo",
      })
    } finally {
      restore()
    }
  })

  test("throws on unsuccessful creation", async () => {
    const { createSubIssue } = await import("../tracker/linear-client")
    const { restore } = mockFetch({
      data: { issueCreate: { success: false } },
    })

    try {
      await expect(createSubIssue("key", "t1", "p1", "title", "desc", "s1")).rejects.toThrow(
        "Failed to create sub-issue",
      )
    } finally {
      restore()
    }
  })
})

// ── linearGraphQL error handling ──────────────────────────────────

describe("linearGraphQL error handling", () => {
  test("throws on GraphQL-level errors", async () => {
    const { updateIssueState } = await import("../tracker/linear-client")
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: null,
          errors: [{ message: "Field not found" }, { message: "Invalid query" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }) as unknown as typeof fetch

    try {
      await expect(updateIssueState("key", "i1", "s1")).rejects.toThrow("Field not found; Invalid query")
    } finally {
      globalThis.fetch = original
    }
  })

  test("throws on non-2xx status", async () => {
    const { addIssueComment } = await import("../tracker/linear-client")
    const { restore } = mockFetchError(500, "Internal Server Error")

    try {
      await expect(addIssueComment("key", "i1", "body")).rejects.toThrow("Linear API error: 500")
    } finally {
      restore()
    }
  })
})
