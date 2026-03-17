/**
 * GeminiSession — Gemini CLI integration with ACP or CLI fallback.
 *
 * Primary: --experimental-acp (Agent Communication Protocol) — persistent session
 * Fallback: --yolo --output-format json — one-shot per execute()
 *
 * In fallback mode, each execute() spawns a new gemini process (like ClaudeSession).
 */

import { BaseSession, buildAgentEnv } from "./base-session"
import type { AgentConfig } from "./agent-session"

let acpSupportCache: boolean | null = null

export class GeminiSession extends BaseSession {
  private output = ""
  private filesChanged: string[] = []
  private useAcp = false
  private started = false

  async start(config: AgentConfig): Promise<void> {
    this.config = config
    this.useAcp = config.options?.useAcp === true && await this.detectAcpSupport()
    this.started = true

    if (this.useAcp) {
      // ACP mode: persistent process
      this.startedAt = Date.now()
      const args = this.buildAcpArgs(config)

      this.process = Bun.spawn(["gemini", ...args], {
        cwd: config.workspacePath,
        env: buildAgentEnv("gemini", config.env),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
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
      const sink = this.process!.stdin as import("bun").FileSink
      sink.write(message + "\n")
      sink.flush()
    } else {
      await this.runOneShotWithPrompt(prompt)
    }
  }

  isAlive(): boolean {
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

    // Write prompt to temp file to avoid CLI arg injection
    const promptFile = `/tmp/symphony-gemini-${Date.now()}.txt`
    await Bun.write(promptFile, prompt)
    const promptText = await Bun.file(promptFile).text()

    const config = this.config!
    const args = this.buildFallbackArgs(config)
    args.push("--prompt", promptText)

    // Cleanup temp file
    import("node:fs/promises").then(fs => {
      setTimeout(() => fs.unlink(promptFile).catch(() => {}), 5000)
    })

    this.process = Bun.spawn(["gemini", ...args], {
      cwd: config.workspacePath,
      env: buildAgentEnv("gemini", config.env),
      stdout: "pipe",
      stderr: "ignore",  // gemini outputs heavy MCP noise to stderr — ignore to prevent pipe blocking
    })

    try {
      await this.readFallbackOutput()
    } catch (err) {
      this.emitError("CRASH", `readFallbackOutput failed: ${err}`, true)
    }
  }

  private async readFallbackOutput(): Promise<void> {
    const proc = this.process
    if (!proc?.stdout) {
      this.emitError("CRASH", "gemini process has no stdout", false)
      return
    }

    // Collect all stdout
    const stdout = proc.stdout as ReadableStream<Uint8Array>
    const reader = stdout.getReader()
    const decoder = new TextDecoder()
    let raw = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        raw += decoder.decode(value, { stream: true })
      }
    } catch {
      // Stream ended
    }

    await proc.exited
    const exitCode = proc.exitCode ?? -1

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
  }

  // ── ACP stream parser (for future use) ──────────────────────────────────

  private async readAcpStream(): Promise<void> {
    const proc = this.process
    if (!proc?.stdout) return

    const stdout = proc.stdout as ReadableStream<Uint8Array>
    const reader = stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
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
      }
    } catch {
      // Stream ended
    }
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

  // ── ACP detection (cached) ──────────────────────────────────────────────

  private async detectAcpSupport(): Promise<boolean> {
    if (acpSupportCache !== null) return acpSupportCache

    // ACP is experimental and not reliably detectable via --help (always exits 0).
    // Disable ACP by default until Gemini CLI stabilizes ACP support.
    // Users can opt in via config.options.useAcp = true.
    acpSupportCache = false
    return acpSupportCache
  }
}
