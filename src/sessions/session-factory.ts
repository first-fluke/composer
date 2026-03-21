/**
 * SessionFactory — Registry-based factory for creating AgentSession instances.
 *
 * Built-in sessions: codex, claude, gemini.
 * Community/custom sessions can be registered at runtime.
 */

import type { AgentSession } from "./agent-session"

type SessionConstructor = () => AgentSession

/**
 * SessionRegistry — encapsulates the mutable registry map.
 * Avoids module-level shared mutable state (CONSTRAINTS.md rule 6).
 */
export class SessionRegistry {
  private registry = new Map<string, SessionConstructor>()

  /**
   * Register a session implementation for an agent type.
   * Overwrites any existing registration for the same type.
   */
  register(type: string, constructor: SessionConstructor): void {
    this.registry.set(type, constructor)
  }

  /**
   * Create a new AgentSession instance for the given agent type.
   * Throws if the type is not registered.
   */
  create(type: string): AgentSession {
    const constructor = this.registry.get(type)
    if (!constructor) {
      const available = Array.from(this.registry.keys()).join(", ") || "(none)"
      throw new Error(
        `Unknown agent type: "${type}". ` +
          `Available: ${available}. ` +
          `Register custom agents via registerSession("${type}", () => new YourSession())`,
      )
    }
    return constructor()
  }

  /**
   * List all registered agent types.
   */
  list(): string[] {
    return Array.from(this.registry.keys())
  }

  /**
   * Register built-in sessions. Called once at startup.
   * Lazy imports to avoid loading unused session implementations.
   */
  async registerBuiltins(): Promise<void> {
    const { CodexSession } = await import("./codex-session")
    const { ClaudeSession } = await import("./claude-session")
    const { GeminiSession } = await import("./gemini-session")

    this.register("codex", () => new CodexSession())
    this.register("claude", () => new ClaudeSession())
    this.register("gemini", () => new GeminiSession())
  }
}

/** Default registry instance — backward compatible with prior module-level API */
export const defaultRegistry = new SessionRegistry()

// ── Backward-compatible function exports ─────────────────────────────────────

export function registerSession(type: string, constructor: SessionConstructor): void {
  defaultRegistry.register(type, constructor)
}

export function createSession(type: string): AgentSession {
  return defaultRegistry.create(type)
}

export function listSessionTypes(): string[] {
  return defaultRegistry.list()
}

export async function registerBuiltinSessions(): Promise<void> {
  return defaultRegistry.registerBuiltins()
}
