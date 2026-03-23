import { describe, expect, it } from "vitest"
import { parseExpandedIssue, parseIssueInput } from "../issue"

describe("parseIssueInput", () => {
  it("splits title and description on newline", () => {
    const result = parseIssueInput("Add login feature\nJWT token issuance, bcrypt validation included")
    expect(result.title).toBe("Add login feature")
    expect(result.description).toBe("JWT token issuance, bcrypt validation included")
  })

  it("uses full text as title when no newline", () => {
    const result = parseIssueInput("Add login feature")
    expect(result.title).toBe("Add login feature")
    expect(result.description).toBe("")
  })

  it("trims whitespace", () => {
    const result = parseIssueInput("  title  \n  description  ")
    expect(result.title).toBe("title")
    expect(result.description).toBe("description")
  })

  it("handles multi-line description", () => {
    const result = parseIssueInput("title\nline1\nline2\nline3")
    expect(result.title).toBe("title")
    expect(result.description).toBe("line1\nline2\nline3")
  })

  it("handles empty string", () => {
    const result = parseIssueInput("")
    expect(result.title).toBe("")
    expect(result.description).toBe("")
  })
})

describe("parseExpandedIssue", () => {
  it("parses TITLE and DESCRIPTION from Claude output", () => {
    const output = `TITLE: feat(auth): implement login API endpoint
DESCRIPTION:
## Goal
Implement POST /auth/login endpoint.

## Requirements
- JWT token issuance
- bcrypt password verification
- 401 response on failure`

    const result = parseExpandedIssue(output)
    expect(result.title).toBe("feat(auth): implement login API endpoint")
    expect(result.description).toContain("## Goal")
    expect(result.description).toContain("JWT token issuance")
  })

  it("handles missing DESCRIPTION", () => {
    const output = "TITLE: fix(server): fix server crash"
    const result = parseExpandedIssue(output)
    expect(result.title).toBe("fix(server): fix server crash")
    expect(result.description).toBe("")
  })

  it("falls back to first 80 chars when no TITLE marker", () => {
    const output = "just plain text without markers"
    const result = parseExpandedIssue(output)
    expect(result.title).toBe("just plain text without markers")
  })

  it("truncates fallback title at 80 chars", () => {
    const long = "a".repeat(120)
    const result = parseExpandedIssue(long)
    expect(result.title.length).toBe(80)
  })

  it("handles multiline description with sections", () => {
    const output = `TITLE: feat(api): user profile API
DESCRIPTION:
## Goal
Implement user profile CRUD API.

## Requirements
- GET /users/:id
- PATCH /users/:id
- Apply auth middleware

## Notes
- Use existing User model`

    const result = parseExpandedIssue(output)
    expect(result.title).toBe("feat(api): user profile API")
    expect(result.description).toContain("## Goal")
    expect(result.description).toContain("## Requirements")
    expect(result.description).toContain("## Notes")
    expect(result.description).toContain("Use existing User model")
  })
})
