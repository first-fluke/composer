/**
 * GeminiSession — Gemini CLI integration with ACP or CLI fallback.
 *
 * Primary: --experimental-acp (Agent Communication Protocol) — persistent session
 * Fallback: --yolo --output-format json — one-shot per execute()
 *
 * In fallback mode, each execute() spawns a new gemini process (like ClaudeSession).
 */

import { spawn } from "node:child_process"
import { BaseSession, buildAgentEnv, waitForExit } from "./base-session"
import type { AgentConfig } from "./agent-session"

export class GeminiSession extends BaseSession {
  private output = ""
  private filesChanged: string[] = []
  private useAcp = false
  private started = false
  private acpSupportCache: boolean | null = null

  async start(config: AgentConfig): Promise<void> {
    this.config = config
    this.useAcp = config.options?.useAcp === true && await this.detectAcpSupport()
    this.started = true

    if (this.useAcp) {
      // ACP mode: persistent process
      this.startedAt = Date.now()
      const args = this.buildAcpArgs(config)

      this.process = spawn("gemini", args, {
        cwd: config.workspacePath,
        env: buildAgentEnv("gemini", config.env) as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      })
    }
    // Fallback mode: process spawned per execute() call
  }

  async execute(prompt: string): Promise<void> {
    if (!this.started || !this.config) {
      this.emitError("CRASH", "execute() called before start()", false)
      return
    }

    this.output = ""
    this.filesChanged = []

    if (this.useAcp) {
      if (!this.assertStarted()) return
      const message = JSON.stringify({ type: "prompt", content: prompt })
      this.process!.stdin!.write(message + "\n")
    } else {
      await this.runOneShotWithPrompt(prompt)
    }
  }

  override isAlive(): boolean {
    if (!this.process) return this.started
    return this.process.exitCode === null
  }

  // ── Args builders ───────────────────────────────────────────────────────

  private buildAcpArgs(config: AgentConfig): string[] {
    const args = ["--experimental-acp"]
    if (config.model) args.push("--model", config.model)
    const approvalMode = config.options?.approvalMode as string | undefined
    if (approvalMode) args.push("--approval-mode", approvalMode)
    return args
  }

  private buildFallbackArgs(config: AgentConfig): string[] {
    const args = ["--yolo", "--output-format", "json"]
    if (config.model) args.push("--model", config.model)
    return args
  }

  // ── Fallback: one-shot execution ────────────────────────────────────────

  private async runOneShotWithPrompt(prompt: string): Promise<void> {
    this.startedAt = Date.now()

    const config = this.config!
    const args = this.buildFallbackArgs(config)

    // Pass prompt via stdin to avoid CLI arg injection and temp file issues
    this.process = spawn("gemini", args, {
      cwd: config.workspacePath,
      env: buildAgentEnv("gemini", config.env) as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "ignore"],  // gemini outputs heavy MCP noise to stderr — ignore to prevent pipe blocking
    })

    this.process.stdin!.write(prompt, "utf-8")
    this.process.stdin!.end()

    try {
      await this.readFallbackOutput()
    } catch (err) {
      this.emitError("CRASH", `readFallbackOutput failed: ${err}`, true)
    }
  }

  private readFallbackOutput(): Promise<void> {
    return new Promise((resolve) => {
      const proc = this.process
      if (!proc?.stdout) {
        this.emitError("CRASH", "gemini process has no stdout", false)
        resolve()
        return
      }

      // Collect all stdout
      const decoder = new TextDecoder()
      let raw = ""

      proc.stdout.on("data", (chunk: Buffer) => {
        raw += decoder.decode(chunk, { stream: true })
      })

      proc.stdout.on("error", () => {
        // Stream error — proceed to close
      })

      proc.once("close", (code) => {
        const exitCode = code ?? -1

        // Parse the JSON response (gemini outputs a single JSON object)
        if (exitCode === 0) {
          try {
            // Find the JSON object in the output (skip stderr-like noise that leaked to stdout)
            const jsonStart = raw.indexOf("{")
            if (jsonStart >= 0) {
              const jsonStr = raw.slice(jsonStart)
              const result = JSON.parse(jsonStr) as Record<string, unknown>
              this.output = (result["response"] as string | undefined)
                ?? (result["text"] as string | undefined)
                ?? raw
            } else {
              this.output = raw
            }
          } catch {
            this.output = raw
          }

          this.emit({ type: "output", chunk: this.output })
          this.emit({
            type: "complete",
            result: this.buildRunResult(this.output, this.filesChanged),
          })
        } else {
          this.emitError(
            exitCode === -1 ? "TIMEOUT" : "CRASH",
            `gemini exited with code ${exitCode}`,
            true,
          )
        }

        resolve()
      })
    })
  }

  // ── ACP stream parser (for future use) ──────────────────────────────────

  private readAcpStream(): Promise<void> {
    return new Promise((resolve) => {
      const proc = this.process
      if (!proc?.stdout) {
        resolve()
        return
      }

      const decoder = new TextDecoder()
      let buffer = ""

      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event: unknown = JSON.parse(line)
            this.handleAcpEvent(event)
          } catch {
            this.output += line + "\n"
            this.emit({ type: "output", chunk: line })
          }
        }
      })

      proc.stdout.on("error", () => {
        resolve()
      })

      proc.once("close", () => resolve())
    })
  }

  private handleAcpEvent(event: unknown): void {
    if (typeof event !== "object" || event === null) return
    const e = event as Record<string, unknown>

    switch (e["type"]) {
      case "text":
      case "message": {
        const text = (e["content"] as string | undefined) ?? (e["text"] as string | undefined) ?? ""
        if (text) {
          this.output += text
          this.emit({ type: "output", chunk: text })
        }
        break
      }
      case "tool_call": {
        this.emit({
          type: "toolUse",
          tool: (e["name"] as string | undefined) ?? "unknown",
          args: e["args"] ?? {},
        })
        break
      }
      default:
        this.emit({ type: "heartbeat", timestamp: new Date().toISOString() })
    }
  }

  // ── ACP detection (cached per instance) ───────────────────────────────

  private async detectAcpSupport(): Promise<boolean> {
    if (this.acpSupportCache !== null) return this.acpSupportCache

    // ACP is experimental and not reliably detectable via --help (always exits 0).
    // Disable ACP by default until Gemini CLI stabilizes ACP support.
    // Users can opt in via config.options.useAcp = true.
    this.acpSupportCache = false
    return this.acpSupportCache
  }
}
