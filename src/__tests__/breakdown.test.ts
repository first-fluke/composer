/**
 * Breakdown parser tests — parseBreakdownOutput, renderDagPreview.
 */

import { describe, expect, test } from "bun:test"
import { parseBreakdownOutput, renderDagPreview } from "../cli/breakdown"

describe("parseBreakdownOutput", () => {
  test("parses complete breakdown output", () => {
    const output = `PARENT_TITLE: feat(auth): 인증 시스템 구축
PARENT_DESCRIPTION:
## Goal
사용자 인증 시스템을 구축한다.

SUB_ISSUES:
---
TITLE: feat(auth): DB 스키마 설계
DESCRIPTION: 사용자 테이블 및 세션 테이블 생성
BLOCKED_BY:
---
TITLE: feat(auth): JWT 미들웨어
DESCRIPTION: JWT 토큰 검증 미들웨어 구현
BLOCKED_BY: 1
---
TITLE: feat(auth): Login API
DESCRIPTION: 로그인 엔드포인트 구현
BLOCKED_BY: 1, 2
---`

    const result = parseBreakdownOutput(output)
    expect(result.parentTitle).toBe("feat(auth): 인증 시스템 구축")
    expect(result.parentDescription).toContain("사용자 인증 시스템을 구축한다")
    expect(result.subIssues).toHaveLength(3)

    expect(result.subIssues[0]?.title).toBe("feat(auth): DB 스키마 설계")
    expect(result.subIssues[0]?.blockedByIndices).toEqual([])

    expect(result.subIssues[1]?.title).toBe("feat(auth): JWT 미들웨어")
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
