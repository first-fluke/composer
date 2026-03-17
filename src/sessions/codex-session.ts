/**
 * CodexSession — Persistent JSON-RPC connection to `codex app-server`.
 *
 * Protocol: JSON-RPC 2.0 over stdio
 * Lifecycle: initialize → thread/start → turn/start → events → turn/completed
 */

import { BaseSession, buildAgentEnv } from "./base-session"
import type { AgentConfig } from "./agent-session"

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: "2.0"
  id?: number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string }
}

export class CodexSession extends BaseSession {
  private rpcId = 0
  private threadId: string | null = null
  private output = ""
  private filesChanged: string[] = []
  private pendingResolvers = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()

  async start(config: AgentConfig): Promise<void> {
    this.config = config
    this.startedAt = Date.now()

    const args = ["app-server", "--listen", "stdio://"]
    if (config.model) {
      args.push("-c", `model="${config.model}"`)
    }

    this.process = Bun.spawn(["codex", ...args], {
      cwd: config.workspacePath,
      env: buildAgentEnv("codex", config.env),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    this.readStream()

    await this.rpc("initialize", {
      clientInfo: { name: "symphony-orchestrator", version: "1.0" },
    })
  }

  async execute(prompt: string): Promise<void> {
    if (!this.assertStarted()) return

    this.output = ""
    this.filesChanged = []

    const threadResult = await this.rpc("thread/start", {
      cwd: this.config!.workspacePath,
      approvalPolicy: "never",
      ephemeral: true,
    }) as { thread: { id: string } }

    this.threadId = threadResult.thread.id

    await this.rpc("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: prompt }],
    })
  }

  async cancel(): Promise<void> {
    if (this.threadId) {
      try {
        await this.rpc("turn/interrupt", { threadId: this.threadId })
      } catch {
        await super.cancel()
      }
    } else {
      await super.cancel()
    }
  }

  async dispose(): Promise<void> {
    for (const [id, { reject }] of Array.from(this.pendingResolvers.entries())) {
      reject(new Error(`Session disposed while waiting for RPC id=${id}`))
    }
    this.pendingResolvers.clear()
    await super.dispose()
  }

  // ── JSON-RPC transport ──────────────────────────────────────────────────

  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.rpcId
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }
    const sink = this.process!.stdin as import("bun").FileSink
    sink.write(JSON.stringify(request) + "\n")
    sink.flush()

    return new Promise((resolve, reject) => {
      this.pendingResolvers.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pendingResolvers.has(id)) {
          this.pendingResolvers.delete(id)
          reject(new Error(`RPC timeout for ${method} (id=${id})`))
        }
      }, 30_000)
    })
  }

  private async readStream(): Promise<void> {
    if (!this.process?.stdout) return

    const stdout = this.process.stdout as ReadableStream<Uint8Array>
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
            const msg: JsonRpcResponse = JSON.parse(line)
            this.handleMessage(msg)
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

  private handleMessage(msg: JsonRpcResponse): void {
    // Response to a request we made
    if (msg.id != null && this.pendingResolvers.has(msg.id)) {
      const resolver = this.pendingResolvers.get(msg.id)!
      this.pendingResolvers.delete(msg.id)
      if (msg.error) {
        resolver.reject(new Error(msg.error.message))
      } else {
        resolver.resolve(msg.result)
      }
      return
    }

    // Server notification
    switch (msg.method) {
      case "item/agentMessage/delta": {
        const chunk = (msg.params?.["delta"] as string | undefined) ?? ""
        this.output += chunk
        this.emit({ type: "output", chunk })
        break
      }

      case "item/commandExecution/outputDelta": {
        const tool = (msg.params?.["command"] as string | undefined) ?? "shell"
        this.emit({ type: "toolUse", tool, args: msg.params })
        break
      }

      case "item/fileChange/outputDelta": {
        const path = (msg.params?.["path"] as string | undefined) ?? ""
        const rawType = msg.params?.["changeType"] as string | undefined
        const changeType: "add" | "modify" | "delete" =
          rawType === "add" || rawType === "delete" ? rawType : "modify"
        if (path && !this.filesChanged.includes(path)) {
          this.filesChanged.push(path)
        }
        this.emit({ type: "fileChange", path, changeType })
        break
      }

      case "turn/completed": {
        const result = this.buildRunResult(this.output, this.filesChanged)
        result.exitCode = 0
        this.emit({ type: "complete", result })
        break
      }

      case "error": {
        const errMsg = (msg.params?.["message"] as string | undefined) ?? "Unknown codex error"
        this.emitError("UNKNOWN", errMsg, true)
        break
      }

      default:
        this.emit({ type: "heartbeat", timestamp: new Date().toISOString() })
    }
  }
}
