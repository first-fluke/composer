/**
 * SessionFactory — Registry-based factory for creating AgentSession instances.
 *
 * Built-in sessions: codex, claude, gemini.
 * Community/custom sessions can be registered at runtime.
 */

import type { AgentSession } from "./agent-session"

type SessionConstructor = () => AgentSession

const registry = new Map<string, SessionConstructor>()

/**
 * Register a session implementation for an agent type.
 * Overwrites any existing registration for the same type.
 */
export function registerSession(type: string, constructor: SessionConstructor): void {
  registry.set(type, constructor)
}

/**
 * Create a new AgentSession instance for the given agent type.
 * Throws if the type is not registered.
 */
export function createSession(type: string): AgentSession {
  const constructor = registry.get(type)
  if (!constructor) {
    const available = Array.from(registry.keys()).join(", ") || "(none)"
    throw new Error(
      `Unknown agent type: "${type}". ` +
      `Available: ${available}. ` +
      `Register custom agents via registerSession("${type}", () => new YourSession())`
    )
  }
  return constructor()
}

/**
 * List all registered agent types.
 */
export function listSessionTypes(): string[] {
  return Array.from(registry.keys())
}

/**
 * Register built-in sessions. Called once at startup.
 * Lazy imports to avoid loading unused session implementations.
 */
export async function registerBuiltinSessions(): Promise<void> {
  const { CodexSession } = await import("./codex-session")
  const { ClaudeSession } = await import("./claude-session")
  const { GeminiSession } = await import("./gemini-session")

  registerSession("codex", () => new CodexSession())
  registerSession("claude", () => new ClaudeSession())
  registerSession("gemini", () => new GeminiSession())
}
