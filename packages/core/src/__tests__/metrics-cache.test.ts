/**
 * System metrics caching regression tests.
 *
 * Ensures buildOrchestratorStatus caches process.memoryUsage()/cpuUsage()
 * calls with a TTL, preventing expensive synchronous syscalls on every
 * SSE poll interval.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { Config } from "../config/env"
import type { OrchestratorRuntimeState } from "../domain/models"
import type { AgentRunnerService } from "../orchestrator/agent-runner"
import { _resetMetricsCache, buildOrchestratorStatus } from "../orchestrator/helpers"
import type { RetryQueue } from "../orchestrator/retry-queue"

const memoryUsageSpy = vi.spyOn(process, "memoryUsage")
const cpuUsageSpy = vi.spyOn(process, "cpuUsage")

function makeState(): OrchestratorRuntimeState {
  return {
    isRunning: true,
    lastEventAt: "2026-03-23T00:00:00Z",
    activeWorkspaces: new Map(),
    waitingIssues: new Map(),
  }
}

function makeAgentRunner(): AgentRunnerService {
  return {
    activeCount: 0,
    getLastOutput: () => undefined,
  } as unknown as AgentRunnerService
}

function makeRetryQueue(): RetryQueue {
  return { size: 0 } as unknown as RetryQueue
}

function makeConfig(): Config {
  return {
    agentType: "claude",
    maxParallel: 3,
    serverPort: 9741,
  } as Config
}

describe("buildOrchestratorStatus — metrics caching", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    memoryUsageSpy.mockClear()
    cpuUsageSpy.mockClear()
    _resetMetricsCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("calls process.memoryUsage() on first invocation", () => {
    buildOrchestratorStatus(makeState(), new Map(), makeAgentRunner(), makeRetryQueue(), makeConfig())

    expect(memoryUsageSpy).toHaveBeenCalledTimes(1)
    expect(cpuUsageSpy).toHaveBeenCalledTimes(1)
  })

  test("returns cached metrics within TTL window", () => {
    const args = [makeState(), new Map(), makeAgentRunner(), makeRetryQueue(), makeConfig()] as const

    buildOrchestratorStatus(...args)
    buildOrchestratorStatus(...args)
    buildOrchestratorStatus(...args)

    // Only 1 real call despite 3 invocations
    expect(memoryUsageSpy).toHaveBeenCalledTimes(1)
    expect(cpuUsageSpy).toHaveBeenCalledTimes(1)
  })

  test("refreshes metrics after TTL expires", () => {
    const args = [makeState(), new Map(), makeAgentRunner(), makeRetryQueue(), makeConfig()] as const

    buildOrchestratorStatus(...args)
    expect(memoryUsageSpy).toHaveBeenCalledTimes(1)

    // Advance past 5s TTL
    vi.advanceTimersByTime(5_001)

    buildOrchestratorStatus(...args)
    expect(memoryUsageSpy).toHaveBeenCalledTimes(2)
    expect(cpuUsageSpy).toHaveBeenCalledTimes(2)
  })

  test("returns systemMetrics in the status payload", () => {
    const result = buildOrchestratorStatus(
      makeState(),
      new Map(),
      makeAgentRunner(),
      makeRetryQueue(),
      makeConfig(),
    ) as { systemMetrics: Record<string, number> }

    expect(result.systemMetrics).toBeDefined()
    expect(typeof result.systemMetrics.memoryRss).toBe("number")
    expect(typeof result.systemMetrics.memoryHeapUsed).toBe("number")
    expect(typeof result.systemMetrics.cpuUser).toBe("number")
    expect(typeof result.systemMetrics.uptime).toBe("number")
  })

  test("rapid polling (simulating multiple SSE connections) stays cached", () => {
    const args = [makeState(), new Map(), makeAgentRunner(), makeRetryQueue(), makeConfig()] as const

    // Simulate 4 SSE connections polling every 2s over 4s (total = 8 calls)
    for (let i = 0; i < 8; i++) {
      buildOrchestratorStatus(...args)
    }

    // All within TTL — only 1 real syscall
    expect(memoryUsageSpy).toHaveBeenCalledTimes(1)
  })
})
