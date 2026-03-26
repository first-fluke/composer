/**
 * Invite — encode/decode team config for clipboard sharing.
 *
 * Flow:
 *   Existing member:  `av invite` → encodes team config → clipboard
 *   New member:       `av setup`  → detects invite in clipboard → fast track
 *
 * Format: av://invite/<base64-json>
 */

import { spawn } from "node:child_process"
import * as p from "@clack/prompts"
import pc from "picocolors"

const INVITE_PREFIX = "av://invite/"

export interface InviteData {
  teamId: string
  teamUuid: string
  webhookSecret: string
  todoStateId: string
  inProgressStateId: string
  doneStateId: string
  cancelledStateId: string
  agentType: string
  serverPort: string
}

const INVITE_KEYS: (keyof InviteData)[] = [
  "teamId",
  "teamUuid",
  "webhookSecret",
  "todoStateId",
  "inProgressStateId",
  "doneStateId",
  "cancelledStateId",
  "agentType",
  "serverPort",
]

import { loadGlobalConfig, loadProjectConfig } from "@agent-valley/core/config/yaml-loader"

export function encodeInvite(data: InviteData): string {
  const json = JSON.stringify(data)
  const b64 = Buffer.from(json).toString("base64url")
  return `${INVITE_PREFIX}${b64}`
}

export function decodeInvite(raw: string): InviteData | null {
  if (!raw.startsWith(INVITE_PREFIX)) return null

  try {
    const b64 = raw.slice(INVITE_PREFIX.length).trim()
    const json = Buffer.from(b64, "base64url").toString("utf-8")
    const data = JSON.parse(json) as Record<string, unknown>

    for (const key of INVITE_KEYS) {
      if (typeof data[key] !== "string") return null
    }

    return data as unknown as InviteData
  } catch {
    return null
  }
}

export async function readClipboard(): Promise<string | null> {
  try {
    const cmd = process.platform === "darwin" ? "pbpaste" : "xclip -selection clipboard -o"
    const parts = cmd.split(" ")
    const proc = spawn(parts[0] as string, parts.slice(1), { stdio: ["pipe", "pipe", "pipe"] })

    const { text, exitCode } = await new Promise<{ text: string; exitCode: number }>((resolve, reject) => {
      const chunks: Buffer[] = []
      proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
      proc.stdout.on("error", reject)
      proc.on("close", (code) => resolve({ text: Buffer.concat(chunks).toString("utf-8"), exitCode: code ?? 1 }))
      proc.on("error", reject)
    })

    return exitCode === 0 ? text.trim() : null
  } catch {
    return null
  }
}

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    const cmd = process.platform === "darwin" ? "pbcopy" : "xclip -selection clipboard"
    const parts = cmd.split(" ")
    const proc = spawn(parts[0] as string, parts.slice(1), { stdio: ["pipe", "pipe", "pipe"] })

    proc.stdin.write(text)
    proc.stdin.end()

    const exitCode = await new Promise<number>((resolve, reject) => {
      proc.on("close", (code) => resolve(code ?? 1))
      proc.on("error", reject)
    })

    return exitCode === 0
  } catch {
    return false
  }
}

export async function detectInviteFromClipboard(): Promise<InviteData | null> {
  const clip = await readClipboard()
  if (!clip) return null
  return decodeInvite(clip)
}

export function extractInviteFromConfig(): InviteData | null {
  try {
    const global = loadGlobalConfig()
    const project = loadProjectConfig()
    if (!project?.linear) return null

    const linear = project.linear
    const states = linear.workflow_states

    if (!linear.team_id || !linear.team_uuid || !linear.webhook_secret) return null
    if (!states?.todo || !states?.in_progress || !states?.done || !states?.cancelled) return null

    return {
      teamId: linear.team_id,
      teamUuid: linear.team_uuid,
      webhookSecret: linear.webhook_secret,
      todoStateId: states.todo,
      inProgressStateId: states.in_progress,
      doneStateId: states.done,
      cancelledStateId: states.cancelled,
      agentType: project.agent?.type ?? global?.agent?.type ?? "claude",
      serverPort: String(project.server?.port ?? global?.server?.port ?? 9741),
    }
  } catch {
    return null
  }
}

export async function invite(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" Agent Valley Invite ")))

  const data = extractInviteFromConfig()
  if (!data) {
    p.log.error("Setup required. Run `bun av setup` first.")
    process.exit(1)
  }

  const encoded = encodeInvite(data)
  const copied = await writeClipboard(encoded)

  if (copied) {
    p.log.success("Invite code copied to clipboard.")
  } else {
    p.log.warning("Failed to copy to clipboard. Share the code below manually:")
    console.log()
    console.log(encoded)
    console.log()
  }

  p.outro(pc.green("Share this with new members. It will be auto-detected when they run `bun av setup`."))
}
