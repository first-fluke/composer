/**
 * Workflow Loader — Parse WORKFLOW.md YAML front matter + prompt template.
 */

import type { Issue, RunAttempt } from "../domain/models"

interface WorkflowConfig {
  tracker: Record<string, unknown>
  workspace: Record<string, unknown>
  agent: Record<string, unknown>
  concurrency: Record<string, unknown>
  server: Record<string, unknown>
}

interface ParsedWorkflow {
  config: WorkflowConfig
  promptTemplate: string
}

export function parseWorkflow(content: string): ParsedWorkflow {
  const parts = content.split("---")
  if (parts.length < 3) {
    throw new Error(
      "WORKFLOW.md must have YAML front matter between --- delimiters.\n" +
      "  Fix: Ensure WORKFLOW.md starts with --- and has a closing ---"
    )
  }

  // YAML front matter is between first and second ---
  const yamlStr = parts[1]!
  const promptTemplate = parts.slice(2).join("---").trim()

  // Simple YAML parser for the flat structure we need
  // Bun doesn't have built-in YAML, so we parse the subset we use
  const config = parseSimpleYaml(yamlStr) as unknown as WorkflowConfig

  return { config, promptTemplate }
}

export function renderPrompt(
  template: string,
  issue: Issue,
  workspacePath: string,
  attempt: RunAttempt,
  retryCount: number,
): string {
  return template
    .replace(/\{\{issue\.identifier\}\}/g, issue.identifier)
    .replace(/\{\{issue\.title\}\}/g, issue.title)
    .replace(/\{\{issue\.description\}\}/g, issue.description)
    .replace(/\{\{workspace_path\}\}/g, workspacePath)
    .replace(/\{\{attempt\.id\}\}/g, attempt.id)
    .replace(/\{\{retry_count\}\}/g, String(retryCount))
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = yaml.split("\n")
  let currentSection = ""

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    // Top-level key (no leading spaces)
    if (!line.startsWith(" ") && !line.startsWith("\t") && trimmed.includes(":")) {
      const [key, ...valueParts] = trimmed.split(":")
      const value = valueParts.join(":").trim()
      if (value) {
        result[key!.trim()] = resolveValue(value)
      } else {
        currentSection = key!.trim()
        result[currentSection] = result[currentSection] ?? {}
      }
    }
    // Nested key
    else if (currentSection && trimmed.includes(":")) {
      const [key, ...valueParts] = trimmed.split(":")
      const value = valueParts.join(":").trim()
      const section = result[currentSection] as Record<string, unknown>
      section[key!.trim()] = resolveValue(value)
    }
  }

  return result
}

function resolveValue(value: string): string | number | boolean {
  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  // Remove inline comments
  const commentIdx = value.indexOf("  #")
  if (commentIdx > 0) value = value.slice(0, commentIdx).trim()

  // Resolve $VAR env references
  if (value.startsWith("$")) {
    const envKey = value.slice(1)
    return process.env[envKey] ?? ""
  }

  // Numbers
  if (/^\d+$/.test(value)) return parseInt(value, 10)

  // Booleans
  if (value === "true") return true
  if (value === "false") return false

  return value
}
