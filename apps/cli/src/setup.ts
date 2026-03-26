/**
 * Interactive setup wizard — guides users through YAML configuration
 * using the Linear API to auto-discover teams and workflow states.
 *
 * Outputs:
 *   - ~/.config/agent-valley/settings.yaml (global — API key, agent defaults)
 *   - valley.yaml (project — team, workspace, prompt, routing)
 *
 * Features:
 *   - Step-based loop with back navigation
 *   - Step progress indicator (Step N/M)
 *   - Webhook pause confirmation
 *   - Final preview with masked API key
 *   - Fast track via invite clipboard detection
 *   - Partial reconfiguration (--edit mode)
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { detectHardware } from "@agent-valley/core/config/hardware"
import {
  type GlobalConfig,
  loadGlobalConfig,
  loadProjectConfig,
  type ProjectConfig,
  resolveGlobalConfigDir,
  resolveGlobalConfigPath,
} from "@agent-valley/core/config/yaml-loader"
import * as p from "@clack/prompts"
import pc from "picocolors"
import { stringify as yamlStringify } from "yaml"
import type { InviteData } from "./invite"
import { detectInviteFromClipboard } from "./invite"

// ── Types ────────────────────────────────────────────────────────────────────

export interface LinearTeam {
  id: string
  key: string
  name: string
}

export interface WorkflowState {
  id: string
  name: string
  type: string
}

// ── Step loop constants ──────────────────────────────────────────────────────

const BACK = Symbol("BACK")
const CANCEL = Symbol("CANCEL")
type StepResult = typeof BACK | typeof CANCEL | undefined

// ── Pure utility functions (tested independently) ────────────────────────────

export async function linearQuery(apiKey: string, query: string): Promise<Record<string, unknown>> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })

  if (!res.ok) throw new Error(`Linear API HTTP ${res.status}`)

  const data = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] }
  if (data.errors) throw new Error(data.errors[0]?.message)

  if (!data.data) throw new Error("Linear API returned no data")
  return data.data
}

export function findWorkflowState(states: WorkflowState[], names: string[], type: string): WorkflowState | undefined {
  return states.find((st) => names.includes(st.name)) ?? states.find((st) => st.type === type)
}

export function buildGlobalYaml(config: { apiKey: string; agentType: string; maxParallel: number }): string {
  const obj: GlobalConfig = {
    linear: { api_key: config.apiKey },
    agent: { type: config.agentType as "claude" | "codex" | "gemini" },
    logging: { level: "info", format: "json" },
    server: { port: 9741 },
  }
  return yamlStringify(obj, { lineWidth: 0 })
}

const DEFAULT_PROMPT = `You are working on {{issue.identifier}}: {{issue.title}}.

## Description
{{issue.description}}

## Workspace
Path: {{workspace_path}}

## Instructions
1. Read AGENTS.md first
2. Implement the requested changes
3. Run tests before finishing
`

export function buildProjectYaml(config: {
  teamKey: string
  teamUuid: string
  webhookSecret: string
  todoStateId: string
  inProgressStateId: string
  doneStateId: string
  cancelledStateId: string
  workspaceRoot: string
  prompt?: string
}): string {
  const obj: ProjectConfig = {
    linear: {
      team_id: config.teamKey,
      team_uuid: config.teamUuid,
      webhook_secret: config.webhookSecret,
      workflow_states: {
        todo: config.todoStateId,
        in_progress: config.inProgressStateId,
        done: config.doneStateId,
        cancelled: config.cancelledStateId,
      },
    },
    workspace: { root: config.workspaceRoot },
    delivery: { mode: "merge" },
    prompt: config.prompt ?? DEFAULT_PROMPT,
  }
  return yamlStringify(obj, { lineWidth: 0 })
}

export function maskApiKey(key: string): string {
  if (key.length <= 12) return "****"
  return `${key.slice(0, 8)}****${key.slice(-4)}`
}

// ── Setup context (accumulated across steps) ─────────────────────────────────

interface SetupContext {
  apiKey: string
  teams: LinearTeam[]
  orgUrlKey: string
  teamUuid: string
  selectedTeam: LinearTeam
  states: WorkflowState[]
  todoStateId: string
  inProgressStateId: string
  doneStateId: string
  cancelledStateId: string
  webhookSecret: string
  workspaceRoot: string
  agentType: string
  maxParallel: number
}

// ── Step definitions ─────────────────────────────────────────────────────────

function stepLabel(current: number, total: number, label: string): string {
  return `${pc.dim(`[${current}/${total}]`)} ${label}`
}

async function stepApiKey(ctx: Partial<SetupContext>, step: number, total: number): Promise<StepResult> {
  const apiKey = await p.text({
    message: stepLabel(step, total, "Linear API Key"),
    placeholder: "lin_api_xxx",
    initialValue: ctx.apiKey,
    validate: (v) => {
      if (!v) return "Required"
      if (!v.startsWith("lin_api_")) return "Must start with lin_api_. Generate one at Settings → API"
    },
  })
  if (p.isCancel(apiKey)) return CANCEL

  ctx.apiKey = apiKey
  return
}

async function stepTeam(ctx: Partial<SetupContext>, step: number, total: number): Promise<StepResult> {
  if (!ctx.apiKey) return BACK

  const s = p.spinner()
  s.start("Fetching Linear teams...")

  try {
    const [teamsData, viewerData] = await Promise.all([
      linearQuery(ctx.apiKey, "{ teams { nodes { id key name } } }"),
      linearQuery(ctx.apiKey, "{ viewer { organization { urlKey } } }"),
    ])
    ctx.teams = (teamsData as Record<string, Record<string, unknown>>).teams?.nodes as LinearTeam[]
    ctx.orgUrlKey = (viewerData as Record<string, Record<string, Record<string, unknown>>>).viewer?.organization
      ?.urlKey as string
    s.stop("Teams fetched")
  } catch (e) {
    s.stop(pc.red("Linear API call failed"))
    p.log.error(`Check your API key: ${(e as Error).message}`)
    return BACK
  }

  if (ctx.teams.length === 0) {
    p.log.error("No teams found. Create a team in Linear first.")
    return BACK
  }

  const teamUuid = await p.select({
    message: stepLabel(step, total, "Select a team"),
    options: ctx.teams.map((t) => ({ value: t.id, label: `${t.name} (${t.key})` })),
  })
  if (p.isCancel(teamUuid)) return CANCEL

  ctx.teamUuid = teamUuid
  ctx.selectedTeam = ctx.teams.find((t) => t.id === teamUuid)
  return
}

async function stepWorkflowStates(ctx: Partial<SetupContext>, step: number, total: number): Promise<StepResult> {
  if (!ctx.apiKey || !ctx.teamUuid) return BACK

  const s = p.spinner()
  s.start("Fetching workflow states...")

  try {
    const data = await linearQuery(ctx.apiKey, `{ team(id: "${ctx.teamUuid}") { states { nodes { id name type } } } }`)
    ctx.states = (data as Record<string, Record<string, Record<string, unknown>>>).team?.states
      ?.nodes as WorkflowState[]
    s.stop("Workflow states fetched")
  } catch (e) {
    s.stop(pc.red("Failed to fetch workflow states"))
    p.log.error((e as Error).message)
    return BACK
  }

  const todoState = findWorkflowState(ctx.states, ["Todo"], "unstarted")
  const inProgressState = findWorkflowState(ctx.states, ["In Progress"], "started")
  const doneState = findWorkflowState(ctx.states, ["Done"], "completed")
  const cancelledState = findWorkflowState(ctx.states, ["Canceled", "Cancelled"], "canceled")

  const fmt = (label: string, st: WorkflowState | undefined) =>
    st ? `${label}: ${pc.green(st.name)} ${pc.dim(st.id)}` : `${label}: ${pc.red("mapping failed")}`

  p.note(
    [
      fmt("Todo", todoState),
      fmt("In Progress", inProgressState),
      fmt("Done", doneState),
      fmt("Cancelled", cancelledState),
    ].join("\n"),
    stepLabel(step, total, "Workflow State Mapping"),
  )

  const stateOptions = ctx.states.map((st) => ({ value: st.id, label: `${st.name} (${st.type})` }))

  const selectMissing = async (label: string, current: WorkflowState | undefined) => {
    if (current) return current
    const id = await p.select({ message: `Select the ${label} state`, options: stateOptions })
    if (p.isCancel(id)) return CANCEL
    const found = (ctx.states ?? []).find((st) => st.id === id)
    if (!found) return CANCEL
    return found
  }

  const todo = await selectMissing("Todo", todoState)
  if (todo === CANCEL) return CANCEL
  const inProgress = await selectMissing("In Progress", inProgressState)
  if (inProgress === CANCEL) return CANCEL
  const done = await selectMissing("Done", doneState)
  if (done === CANCEL) return CANCEL
  const cancelled = await selectMissing("Cancelled", cancelledState)
  if (cancelled === CANCEL) return CANCEL

  ctx.todoStateId = (todo as WorkflowState).id
  ctx.inProgressStateId = (inProgress as WorkflowState).id
  ctx.doneStateId = (done as WorkflowState).id
  ctx.cancelledStateId = (cancelled as WorkflowState).id
  return
}

async function stepWebhook(ctx: Partial<SetupContext>, step: number, total: number): Promise<StepResult> {
  if (!ctx.orgUrlKey || !ctx.selectedTeam) return BACK

  const webhookUrl = `https://linear.app/${ctx.orgUrlKey}/settings/api`

  p.note(
    [
      `Go to ${pc.cyan(webhookUrl)}:`,
      "",
      `1. Click ${pc.bold("Create webhook")}`,
      `2. Label: ${pc.dim("Symphony")}`,
      `3. URL: your ngrok tunnel URL + ${pc.bold("/webhook")}`,
      `4. Events: check ${pc.bold("Issues")}`,
      `5. Team: select ${pc.bold(ctx.selectedTeam.name)}`,
      `6. Copy the Signing secret after creation`,
    ].join("\n"),
    stepLabel(step, total, "Webhook Setup Guide"),
  )

  const ready = await p.confirm({ message: "Have you completed the webhook setup in Linear?" })
  if (p.isCancel(ready)) return CANCEL
  if (!ready) return BACK

  const webhookSecret = await p.text({
    message: "Webhook Signing Secret",
    placeholder: "lin_wh_xxx",
    initialValue: ctx.webhookSecret,
    validate: (v) => {
      if (!v) return "Required"
    },
  })
  if (p.isCancel(webhookSecret)) return CANCEL

  ctx.webhookSecret = webhookSecret
  return
}

async function stepWorkspace(ctx: Partial<SetupContext>, step: number, total: number): Promise<StepResult> {
  const defaultWorkspace = ctx.workspaceRoot ?? `${process.env.HOME}/workspaces`

  const workspaceRoot = await p.text({
    message: stepLabel(step, total, "Agent workspace path (absolute)"),
    placeholder: `${process.env.HOME}/workspaces`,
    initialValue: defaultWorkspace,
    validate: (v) => {
      if (!v) return "Required"
      if (!v.startsWith("/")) return "Must be an absolute path"
    },
  })
  if (p.isCancel(workspaceRoot)) return CANCEL

  ctx.workspaceRoot = workspaceRoot
  return
}

async function stepAgentType(ctx: Partial<SetupContext>, step: number, total: number): Promise<StepResult> {
  const agentType = await p.select({
    message: stepLabel(step, total, "Select agent"),
    options: [
      { value: "claude", label: "Claude", hint: "Anthropic Claude Code" },
      { value: "codex", label: "Codex", hint: "OpenAI Codex" },
      { value: "gemini", label: "Gemini", hint: "Google Gemini" },
    ],
  })
  if (p.isCancel(agentType)) return CANCEL

  ctx.agentType = agentType
  return
}

async function stepParallel(ctx: Partial<SetupContext>, step: number, total: number): Promise<StepResult> {
  const hw = detectHardware()

  p.note(
    [
      `CPU: ${pc.cyan(String(hw.cpuCores))} cores`,
      `RAM: ${pc.cyan(String(hw.totalMemoryGB))} GB`,
      `Recommended parallel agents: ${pc.green(String(hw.recommended))}`,
    ].join("\n"),
    stepLabel(step, total, "Hardware Detection"),
  )

  const useRecommended = await p.confirm({
    message: `Set parallel agents to ${pc.green(String(hw.recommended))}?`,
    initialValue: true,
  })
  if (p.isCancel(useRecommended)) return CANCEL

  if (useRecommended) {
    ctx.maxParallel = hw.recommended
  } else {
    const custom = await p.text({
      message: "Number of parallel agents",
      initialValue: String(ctx.maxParallel ?? hw.cpuCores),
      validate: (v) => {
        const n = Number(v)
        if (!Number.isInteger(n) || n < 1) return "Must be a positive integer"
      },
    })
    if (p.isCancel(custom)) return CANCEL
    ctx.maxParallel = Number(custom)
  }

  return
}

// ── Preview ──────────────────────────────────────────────────────────────────

function renderPreview(ctx: SetupContext): string {
  const globalPath = resolveGlobalConfigPath()
  const lines = [
    pc.bold("Global") + pc.dim(` (${globalPath})`),
    `  linear.api_key        = ${pc.dim(maskApiKey(ctx.apiKey))}`,
    `  agent.type             = ${pc.cyan(ctx.agentType)}`,
    "",
    pc.bold("Project") + pc.dim(" (valley.yaml)"),
    `  linear.team_id         = ${ctx.selectedTeam.key}`,
    `  linear.team_uuid       = ${pc.dim(ctx.teamUuid)}`,
    `  linear.webhook_secret  = ${pc.dim(maskApiKey(ctx.webhookSecret))}`,
    `  workspace.root         = ${ctx.workspaceRoot}`,
    `  delivery.mode          = merge`,
  ]
  return lines.join("\n")
}

// ── Save YAML files ─────────────────────────────────────────────────────────

async function saveConfig(ctx: SetupContext): Promise<void> {
  // Save global config
  const globalDir = resolveGlobalConfigDir()
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true })
  }
  const globalContent = buildGlobalYaml({
    apiKey: ctx.apiKey,
    agentType: ctx.agentType,
    maxParallel: ctx.maxParallel,
  })
  writeFileSync(resolveGlobalConfigPath(), globalContent, "utf-8")
  p.log.success(`Global config saved: ${resolveGlobalConfigPath()}`)

  // Save project config
  const projectContent = buildProjectYaml({
    teamKey: ctx.selectedTeam.key,
    teamUuid: ctx.teamUuid,
    webhookSecret: ctx.webhookSecret,
    todoStateId: ctx.todoStateId,
    inProgressStateId: ctx.inProgressStateId,
    doneStateId: ctx.doneStateId,
    cancelledStateId: ctx.cancelledStateId,
    workspaceRoot: ctx.workspaceRoot,
  })
  writeFileSync("valley.yaml", projectContent, "utf-8")
  p.log.success("Project config saved: valley.yaml")

  // Create workspace directory
  if (!existsSync(ctx.workspaceRoot)) {
    mkdirSync(ctx.workspaceRoot, { recursive: true })
    p.log.success(`Workspace directory created: ${ctx.workspaceRoot}`)
  }
}

// ── Fast track (invite clipboard) ────────────────────────────────────────────

async function fastTrackSetup(invite: InviteData): Promise<void> {
  p.log.info(pc.green("Invite data detected. Loading team configuration."))

  const ctx: Partial<SetupContext> = {
    teamUuid: invite.teamUuid,
    webhookSecret: invite.webhookSecret,
    todoStateId: invite.todoStateId,
    inProgressStateId: invite.inProgressStateId,
    doneStateId: invite.doneStateId,
    cancelledStateId: invite.cancelledStateId,
    agentType: invite.agentType,
  }

  const teamKey = invite.teamId

  const fastSteps = [
    async (_c: Partial<SetupContext>, step: number, total: number) => stepApiKey(_c, step, total),
    async (_c: Partial<SetupContext>, step: number, total: number) => stepWorkspace(_c, step, total),
    async (_c: Partial<SetupContext>, step: number, total: number) => stepParallel(_c, step, total),
  ]

  const totalSteps = fastSteps.length
  let i = 0
  while (i < fastSteps.length) {
    const result = await fastSteps[i]?.(ctx, i + 1, totalSteps)
    if (result === BACK) {
      i = Math.max(0, i - 1)
      continue
    }
    if (result === CANCEL) {
      p.cancel("Cancelled")
      process.exit(0)
    }
    i++
  }

  if (!ctx.apiKey || !ctx.workspaceRoot || ctx.maxParallel == null) {
    p.log.error("Missing configuration values. Please try again.")
    process.exit(1)
  }

  const fullCtx: SetupContext = {
    apiKey: ctx.apiKey,
    teams: [],
    orgUrlKey: "",
    teamUuid: invite.teamUuid,
    selectedTeam: { id: invite.teamUuid, key: teamKey, name: teamKey },
    states: [],
    todoStateId: invite.todoStateId,
    inProgressStateId: invite.inProgressStateId,
    doneStateId: invite.doneStateId,
    cancelledStateId: invite.cancelledStateId,
    webhookSecret: invite.webhookSecret,
    workspaceRoot: ctx.workspaceRoot,
    agentType: invite.agentType,
    maxParallel: ctx.maxParallel,
  }

  p.note(renderPreview(fullCtx), "Configuration Review")
  const confirmed = await p.confirm({ message: "Save this configuration?" })
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled")
    process.exit(0)
  }

  await saveConfig(fullCtx)
  p.outro(pc.green("Setup complete! Start the server with `bun av up`."))
}

// ── Edit mode (partial reconfiguration) ──────────────────────────────────────

const EDITABLE_FIELDS: { value: string; label: string; scope: "global" | "project" }[] = [
  { value: "apiKey", label: "Linear API Key", scope: "global" },
  { value: "webhookSecret", label: "Webhook Secret", scope: "project" },
  { value: "workspaceRoot", label: "Workspace Path", scope: "project" },
  { value: "agentType", label: "Agent Type", scope: "global" },
]

export async function setupEdit(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" Agent Valley Setup — Edit ")))

  const globalConfig = loadGlobalConfig()
  const projectConfig = loadProjectConfig()

  if (!globalConfig && !projectConfig) {
    p.log.error("No config files found. Run `bun av setup` first.")
    process.exit(1)
  }

  const fields = await p.multiselect({
    message: "Select fields to change",
    options: EDITABLE_FIELDS.map((f) => ({ value: f.value, label: `${f.label} ${pc.dim(`(${f.scope})`)}` })),
    required: true,
  })
  if (p.isCancel(fields)) {
    p.cancel("Cancelled")
    process.exit(0)
  }

  const selectedFields = fields as string[]
  let globalChanged = false
  let projectChanged = false

  // Work with mutable copies
  const gConfig = globalConfig ?? {}
  const pConfig = projectConfig ?? {}

  if (selectedFields.includes("apiKey")) {
    const apiKey = await p.text({
      message: "Linear API Key",
      placeholder: "lin_api_xxx",
      initialValue: gConfig.linear?.api_key,
      validate: (v) => {
        if (!v) return "Required"
        if (!v.startsWith("lin_api_")) return "Must start with lin_api_"
      },
    })
    if (p.isCancel(apiKey)) {
      p.cancel("Cancelled")
      process.exit(0)
    }
    if (!gConfig.linear) gConfig.linear = {}
    gConfig.linear.api_key = apiKey
    globalChanged = true
  }

  if (selectedFields.includes("webhookSecret")) {
    const secret = await p.text({
      message: "Webhook Signing Secret",
      placeholder: "lin_wh_xxx",
      initialValue: pConfig.linear?.webhook_secret,
      validate: (v) => {
        if (!v) return "Required"
      },
    })
    if (p.isCancel(secret)) {
      p.cancel("Cancelled")
      process.exit(0)
    }
    if (!pConfig.linear) pConfig.linear = {}
    pConfig.linear.webhook_secret = secret
    projectChanged = true
  }

  if (selectedFields.includes("workspaceRoot")) {
    const root = await p.text({
      message: "Agent workspace path (absolute)",
      initialValue: pConfig.workspace?.root,
      validate: (v) => {
        if (!v) return "Required"
        if (!v.startsWith("/")) return "Must be an absolute path"
      },
    })
    if (p.isCancel(root)) {
      p.cancel("Cancelled")
      process.exit(0)
    }
    if (!pConfig.workspace) pConfig.workspace = {}
    pConfig.workspace.root = root
    projectChanged = true
  }

  if (selectedFields.includes("agentType")) {
    const agent = await p.select({
      message: "Select agent",
      options: [
        { value: "claude", label: "Claude", hint: "Anthropic Claude Code" },
        { value: "codex", label: "Codex", hint: "OpenAI Codex" },
        { value: "gemini", label: "Gemini", hint: "Google Gemini" },
      ],
    })
    if (p.isCancel(agent)) {
      p.cancel("Cancelled")
      process.exit(0)
    }
    if (!gConfig.agent) gConfig.agent = {}
    gConfig.agent.type = agent as "claude" | "codex" | "gemini"
    globalChanged = true
  }

  const confirmed = await p.confirm({ message: "Save changes?" })
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled")
    process.exit(0)
  }

  if (globalChanged) {
    const globalDir = resolveGlobalConfigDir()
    if (!existsSync(globalDir)) mkdirSync(globalDir, { recursive: true })
    writeFileSync(resolveGlobalConfigPath(), yamlStringify(gConfig, { lineWidth: 0 }), "utf-8")
    p.log.success(`Global config updated: ${resolveGlobalConfigPath()}`)
  }

  if (projectChanged) {
    writeFileSync("valley.yaml", yamlStringify(pConfig, { lineWidth: 0 }), "utf-8")
    p.log.success("Project config updated: valley.yaml")
  }

  p.outro(pc.green("Configuration updated!"))
}

// ── Full setup ───────────────────────────────────────────────────────────────

export async function setup(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" Agent Valley Setup ")))

  // ── Check existing config ────────────────────────────────────────────────
  const hasGlobal = existsSync(resolveGlobalConfigPath())
  const hasProject = existsSync("valley.yaml")

  if (hasGlobal && hasProject) {
    const overwrite = await p.confirm({ message: "Config files already exist. Overwrite?" })
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Cancelled")
      process.exit(0)
    }
  } else if (hasGlobal) {
    p.log.info(pc.dim("Global config found. Only project setup needed."))
  }

  // ── Detect invite in clipboard ─────────────────────────────────────────────
  const invite = await detectInviteFromClipboard()
  if (invite) {
    const useInvite = await p.confirm({ message: "Invite data detected in clipboard. Use it?" })
    if (!p.isCancel(useInvite) && useInvite) {
      return fastTrackSetup(invite)
    }
  }

  // ── Pre-populate from existing global config ─────────────────────────────
  const ctx: Partial<SetupContext> = {}
  if (hasGlobal) {
    try {
      const existing = loadGlobalConfig()
      if (existing) {
        ctx.apiKey = existing.linear?.api_key
        ctx.agentType = existing.agent?.type
      }
    } catch {
      // Ignore — will be overwritten
    }
  }

  // ── Full step-based setup ──────────────────────────────────────────────────
  type StepFn = (ctx: Partial<SetupContext>, step: number, total: number) => Promise<StepResult>

  const steps: StepFn[] = [
    stepApiKey,
    stepTeam,
    stepWorkflowStates,
    stepWebhook,
    stepWorkspace,
    stepAgentType,
    stepParallel,
  ]

  const totalSteps = steps.length
  let i = 0
  while (i < steps.length) {
    const result = await steps[i]?.(ctx, i + 1, totalSteps)
    if (result === BACK) {
      i = Math.max(0, i - 1)
      continue
    }
    if (result === CANCEL) {
      p.cancel("Cancelled")
      process.exit(0)
    }
    i++
  }

  const fullCtx = ctx as SetupContext

  // ── Final preview ──────────────────────────────────────────────────────────
  p.note(renderPreview(fullCtx), "Configuration Review")

  const confirmed = await p.confirm({ message: "Save this configuration?" })
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled")
    process.exit(0)
  }

  await saveConfig(fullCtx)
  p.outro(pc.green("Setup complete! Start the server with `bun av up`."))
}
