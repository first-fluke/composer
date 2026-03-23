/**
 * Breakdown parser tests — parseBreakdownOutput, renderDagPreview.
 */

import { describe, expect, test } from "vitest"
import { parseBreakdownOutput, renderDagPreview } from "../breakdown"

describe("parseBreakdownOutput", () => {
  test("parses complete breakdown output", () => {
    const output = `PARENT_TITLE: feat(auth): build authentication system
PARENT_DESCRIPTION:
## Goal
Build a user authentication system.

SUB_ISSUES:
---
TITLE: feat(auth): design DB schema
DESCRIPTION: Create user and session tables
BLOCKED_BY:
---
TITLE: feat(auth): JWT middleware
DESCRIPTION: Implement JWT token verification middleware
BLOCKED_BY: 1
---
TITLE: feat(auth): Login API
DESCRIPTION: Implement login endpoint
BLOCKED_BY: 1, 2
---`

    const result = parseBreakdownOutput(output)
    expect(result.parentTitle).toBe("feat(auth): build authentication system")
    expect(result.parentDescription).toContain("Build a user authentication system")
    expect(result.subIssues).toHaveLength(3)

    expect(result.subIssues[0]?.title).toBe("feat(auth): design DB schema")
    expect(result.subIssues[0]?.blockedByIndices).toEqual([])

    expect(result.subIssues[1]?.title).toBe("feat(auth): JWT middleware")
    expect(result.subIssues[1]?.blockedByIndices).toEqual([1])

    expect(result.subIssues[2]?.title).toBe("feat(auth): Login API")
    expect(result.subIssues[2]?.blockedByIndices).toEqual([1, 2])
  })

  test("handles empty sub-issues section", () => {
    const output = `PARENT_TITLE: chore: small task
PARENT_DESCRIPTION:
Nothing to decompose.
SUB_ISSUES:
`
    const result = parseBreakdownOutput(output)
    expect(result.parentTitle).toBe("chore: small task")
    expect(result.subIssues).toHaveLength(0)
  })

  test("handles missing parent title", () => {
    const output = `SUB_ISSUES:
---
TITLE: feat: something
DESCRIPTION: desc
BLOCKED_BY:
---`
    const result = parseBreakdownOutput(output)
    expect(result.parentTitle).toBe("Untitled")
    expect(result.subIssues).toHaveLength(1)
  })
})

describe("renderDagPreview", () => {
  test("renders tree with dependencies", () => {
    const preview = renderDagPreview({
      parentTitle: "Auth System",
      parentDescription: "Build auth",
      subIssues: [
        { title: "DB Schema", description: "tables", blockedByIndices: [] },
        { title: "JWT", description: "middleware", blockedByIndices: [1] },
        { title: "Login", description: "endpoint", blockedByIndices: [1, 2] },
      ],
    })
    expect(preview).toContain("Auth System")
    expect(preview).toContain("DB Schema")
    expect(preview).toContain("JWT")
    expect(preview).toContain("Login")
    expect(preview).toContain("blocked by")
  })
})
