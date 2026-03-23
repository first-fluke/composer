/**
 * Breakdown — Auto-decompose an issue into sub-issues with dependency DAG.
 * Uses Claude CLI to analyze and split a large issue into smaller tasks.
 */

import { spawn } from "node:child_process"
import * as p from "@clack/prompts"
import pc from "picocolors"

const BREAKDOWN_PROMPT = `You are a technical project decomposer. Given a feature description, break it down into concrete sub-issues with dependency relationships.

Output format (no markdown fences, just raw text):

PARENT_TITLE: type(scope): concise parent title
PARENT_DESCRIPTION:
## Goal
One sentence stating the overall objective.

SUB_ISSUES:
---
TITLE: type(scope): sub-issue title
DESCRIPTION: One-line description of this sub-task
BLOCKED_BY: (comma-separated indices of other sub-issues this depends on, or empty)
---
TITLE: type(scope): another sub-issue title
DESCRIPTION: One-line description
BLOCKED_BY: 1
---

Rules:
- Each sub-issue title must use conventional commit format: feat|fix|refactor|chore(scope): description
- Use 1-based indices for BLOCKED_BY references (e.g., "1" means blocked by the first sub-issue)
- Only add BLOCKED_BY when there is a genuine technical dependency
- Aim for 2-6 sub-issues (not too granular, not too coarse)
- Write in the same language as the input
- Sub-issues should be independently testable and assignable to an AI agent`

export interface BreakdownSubIssue {
  title: string
  description: string
  blockedByIndices: number[]
}

export interface BreakdownResult {
  parentTitle: string
  parentDescription: string
  subIssues: BreakdownSubIssue[]
}

export function parseBreakdownOutput(output: string): BreakdownResult {
  const parentTitleMatch = output.match(/^PARENT_TITLE:\s*(.+)$/m)
  const parentDescStart = output.match(/^PARENT_DESCRIPTION:\s*\n/m)
  const subIssuesStart = output.match(/^SUB_ISSUES:\s*\n/m)

  let parentDescription = ""
  if (parentDescStart && subIssuesStart) {
    const start = (parentDescStart.index ?? 0) + parentDescStart[0].length
    const end = subIssuesStart.index ?? output.length
    parentDescription = output.slice(start, end).trim()
  }

  const subIssues: BreakdownSubIssue[] = []
  const subSection = subIssuesStart ? output.slice((subIssuesStart.index ?? 0) + subIssuesStart[0].length) : ""
  const blocks = subSection.split(/^---$/m).filter((b) => b.trim())

  for (const block of blocks) {
    const titleMatch = block.match(/^TITLE:\s*(.+)$/m)
    const descMatch = block.match(/^DESCRIPTION:\s*(.+)$/m)
    const blockedMatch = block.match(/^BLOCKED_BY:\s*(.*)$/m)

    if (titleMatch) {
      const blockedByStr = blockedMatch?.[1]?.trim() ?? ""
      const blockedByIndices = blockedByStr
        ? blockedByStr
            .split(",")
            .map((s) => Number.parseInt(s.trim(), 10))
            .filter((n) => !Number.isNaN(n))
        : []

      subIssues.push({
        title: titleMatch[1]?.trim() ?? "",
        description: descMatch?.[1]?.trim() ?? "",
        blockedByIndices,
      })
    }
  }

  return {
    parentTitle: parentTitleMatch?.[1]?.trim() ?? "Untitled",
    parentDescription,
    subIssues,
  }
}

export function renderDagPreview(result: BreakdownResult): string {
  const lines: string[] = [
    pc.bold(result.parentTitle),
    result.parentDescription ? pc.dim(result.parentDescription.slice(0, 120)) : "",
    "",
  ]

  for (let i = 0; i < result.subIssues.length; i++) {
    const sub = result.subIssues[i]
    if (!sub) continue
    const isLast = i === result.subIssues.length - 1
    const prefix = isLast ? "└── " : "├── "
    const blockedStr =
      sub.blockedByIndices.length > 0 ? pc.yellow(` (blocked by: ${sub.blockedByIndices.join(", ")})`) : ""
    lines.push(`${prefix}${pc.cyan(`${i + 1}.`)} ${sub.title}${blockedStr}`)
  }

  return lines.join("\n")
}

async function expandBreakdownWithClaude(rawInput: string): Promise<BreakdownResult> {
  const output = await new Promise<string>((resolve, reject) => {
    const proc = spawn(
      "claude",
      ["--print", "--no-session-persistence", "-p", `${BREAKDOWN_PROMPT}\n\nInput: ${rawInput}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    )
    const chunks: Buffer[] = []
    proc.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk))
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error("Claude CLI failed during breakdown analysis."))
      else resolve(Buffer.concat(chunks).toString("utf-8"))
    })
    proc.on("error", reject)
  })

  if (!output) {
    throw new Error("Claude CLI failed during breakdown analysis.")
  }

  return parseBreakdownOutput(output)
}

export async function executeBreakdown(input: string, opts: { yes?: boolean }): Promise<void> {
  const apiKey = process.env.LINEAR_API_KEY
  const teamUuid = process.env.LINEAR_TEAM_UUID
  const todoStateId = process.env.LINEAR_WORKFLOW_STATE_TODO

  if (!apiKey || !teamUuid || !todoStateId) {
    console.log(pc.red("Setup required. Run `bun av setup` first."))
    process.exit(1)
  }

  p.intro(pc.bgMagenta(pc.black(" Issue Breakdown ")))
  const s = p.spinner()

  // Step 1: Claude decomposes the issue
  s.start("Decomposing issue...")
  let result: BreakdownResult
  try {
    result = await expandBreakdownWithClaude(input)
    s.stop("Issue decomposition complete")
  } catch (e) {
    s.stop(pc.red("Decomposition failed"))
    console.log(pc.red((e as Error).message))
    process.exit(1)
  }

  if (result.subIssues.length === 0) {
    console.log(pc.yellow("No sub-issues to create."))
    process.exit(0)
  }

  // Step 2: Preview
  p.note(renderDagPreview(result), "Breakdown Result")

  if (!opts.yes) {
    const confirmed = await p.confirm({ message: `Create ${result.subIssues.length} sub-issues?` })
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Cancelled")
      process.exit(0)
    }
  }

  // Step 3: Create parent issue
  s.start("Creating parent issue...")
  const { createSubIssue, createIssueRelation } = await import("@agent-valley/core/tracker/linear-client")

  let parentIssue: { id: string; identifier: string; title: string; url: string }
  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `mutation($teamId:String!,$title:String!,$description:String!,$stateId:String!){issueCreate(input:{teamId:$teamId,title:$title,description:$description,stateId:$stateId}){success issue{id identifier title url}}}`,
        variables: {
          teamId: teamUuid,
          title: result.parentTitle,
          description: result.parentDescription,
          stateId: todoStateId,
        },
      }),
    })
    const json = (await res.json()) as {
      data?: { issueCreate?: { success: boolean; issue?: typeof parentIssue } }
      errors?: { message: string }[]
    }
    if (json.errors) throw new Error(json.errors[0]?.message ?? "Unknown error")
    if (!json.data?.issueCreate?.success || !json.data.issueCreate.issue)
      throw new Error("Parent issue creation failed")
    parentIssue = json.data.issueCreate.issue
    s.stop(pc.green(`Parent issue: ${parentIssue.identifier}`))
  } catch (e) {
    s.stop(pc.red("Failed to create parent issue"))
    console.log(pc.red((e as Error).message))
    process.exit(1)
  }

  // Step 4: Create sub-issues
  const createdIds: Array<{ id: string; identifier: string; index: number }> = []
  s.start(`Creating sub-issues (0/${result.subIssues.length})...`)

  for (let i = 0; i < result.subIssues.length; i++) {
    const sub = result.subIssues[i]
    if (!sub) continue
    try {
      const created = await createSubIssue(apiKey, teamUuid, parentIssue.id, sub.title, sub.description, todoStateId)
      createdIds.push({ id: created.id, identifier: created.identifier, index: i + 1 })
      s.message(`Creating sub-issues (${i + 1}/${result.subIssues.length})...`)
    } catch (e) {
      s.stop(pc.yellow(`Failed to create sub-issue ${i + 1}`))
      console.log(pc.yellow(`Warning: ${(e as Error).message}`))
      console.log(pc.dim(`Already created: ${createdIds.map((c) => c.identifier).join(", ") || "none"}`))
      // Continue with remaining sub-issues
    }
  }
  s.stop(pc.green(`Created ${createdIds.length} sub-issues`))

  // Step 5: Create relations
  let relationsCreated = 0
  for (const created of createdIds) {
    const sub = result.subIssues[created.index - 1]
    if (!sub) continue
    for (const blockerIdx of sub.blockedByIndices) {
      const blocker = createdIds.find((c) => c.index === blockerIdx)
      if (blocker) {
        try {
          // "created blocked-by blocker" → Linear API: "blocker blocks created"
          await createIssueRelation(apiKey, blocker.id, created.id, "blocks")
          relationsCreated++
        } catch {
          // Non-critical: relation creation failure doesn't block
        }
      }
    }
  }

  // Step 6: Summary
  const summaryLines = [
    `${pc.bold(parentIssue.identifier)}: ${parentIssue.title}`,
    pc.dim(parentIssue.url),
    "",
    `Sub-issues: ${pc.green(String(createdIds.length))}`,
    `Dependencies: ${pc.yellow(String(relationsCreated))}`,
    "",
  ]
  for (const created of createdIds) {
    const sub = result.subIssues[created.index - 1]
    if (!sub) continue
    const blockedStr =
      sub.blockedByIndices.length > 0
        ? pc.dim(
            ` ← blocked by ${sub.blockedByIndices.map((i) => createdIds.find((c) => c.index === i)?.identifier ?? `#${i}`).join(", ")}`,
          )
        : ""
    summaryLines.push(`  ${created.identifier}: ${sub.title}${blockedStr}`)
  }

  p.note(summaryLines.join("\n"), "Breakdown Complete")
}
