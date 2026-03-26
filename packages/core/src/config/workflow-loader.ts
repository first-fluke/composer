/**
 * Workflow Loader — Prompt template rendering and input sanitization.
 * Prompt template now comes from valley.yaml config, not WORKFLOW.md.
 */

import type { Issue, RunAttempt } from "../domain/models"

const MAX_ISSUE_BODY_LENGTH = 10_000

/**
 * Sanitize issue body text to prevent prompt injection and template injection.
 * Issue body is untrusted external input (see docs/harness/SAFETY.md §3).
 *
 * Steps:
 * 1. Truncate to MAX_ISSUE_BODY_LENGTH chars
 * 2. Strip template injection patterns: {{...}} and ${...}
 * 3. Strip common prompt injection patterns
 */
export function sanitizeIssueBody(text: string): string {
  if (!text) return ""

  // 1. Truncate to max length
  let sanitized = text.length > MAX_ISSUE_BODY_LENGTH ? text.slice(0, MAX_ISSUE_BODY_LENGTH) : text

  // 2. Strip template injection patterns: {{...}} and ${...}
  sanitized = sanitized.replace(/\{\{.*?\}\}/g, "")
  sanitized = sanitized.replace(/\$\{.*?\}/g, "")

  // 3. Strip common prompt injection patterns (case-insensitive)
  const injectionPatterns = [
    /ignore\s+previous\s+instructions/gi,
    /ignore\s+all\s+previous/gi,
    /disregard\s+previous\s+instructions/gi,
    /forget\s+previous\s+instructions/gi,
    /override\s+previous\s+instructions/gi,
    /^system\s*:/gim,
    /^assistant\s*:/gim,
    /^user\s*:/gim,
    /\bsystem\s+prompt\b/gi,
    /\bnew\s+instructions\s*:/gi,
    /\byou\s+are\s+now\b/gi,
    /\bact\s+as\s+if\b/gi,
  ]

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, "[redacted]")
  }

  return sanitized
}

export function renderPrompt(
  template: string,
  issue: Issue,
  workspacePath: string,
  attempt: RunAttempt,
  retryCount: number,
  retryReason = "",
): string {
  const sanitizedDescription = sanitizeIssueBody(issue.description)
  const sanitizedTitle = sanitizeIssueBody(issue.title)
  const sanitizedRetryReason = sanitizeIssueBody(retryReason)

  return template
    .replace(/\{\{issue\.identifier\}\}/g, issue.identifier.slice(0, 50))
    .replace(/\{\{issue\.title\}\}/g, sanitizedTitle)
    .replace(/\{\{issue\.description\}\}/g, sanitizedDescription)
    .replace(/\{\{workspace_path\}\}/g, workspacePath)
    .replace(/\{\{attempt\.id\}\}/g, attempt.id)
    .replace(/\{\{retry_count\}\}/g, String(retryCount))
    .replace(/\{\{retry_reason\}\}/g, sanitizedRetryReason)
}
