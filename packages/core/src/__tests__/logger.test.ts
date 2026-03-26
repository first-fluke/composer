/**
 * Logger tests — configureLogger, level filtering, and format switching.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { configureLogger, logger } from "../observability/logger"

describe("logger", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    // Reset to defaults
    configureLogger("info", "json")
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    configureLogger("info", "json")
  })

  test("info logs in JSON format by default", () => {
    logger.info("test-component", "hello world")

    expect(consoleSpy).toHaveBeenCalledOnce()
    const output = consoleSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(output)
    expect(parsed.level).toBe("info")
    expect(parsed.component).toBe("test-component")
    expect(parsed.message).toBe("hello world")
    expect(parsed.timestamp).toBeDefined()
  })

  test("includes extra fields in JSON output", () => {
    logger.info("comp", "msg", { issueId: "i1", durationMs: 100 })

    const output = consoleSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(output)
    expect(parsed.issueId).toBe("i1")
    expect(parsed.durationMs).toBe(100)
  })

  test("warn and error log at info level", () => {
    logger.warn("comp", "warning")
    logger.error("comp", "error")

    expect(consoleSpy).toHaveBeenCalledTimes(2)
  })

  test("debug is filtered out at info level", () => {
    logger.debug("comp", "debug message")

    expect(consoleSpy).not.toHaveBeenCalled()
  })

  test("configureLogger changes minimum level to debug", () => {
    configureLogger("debug", "json")
    logger.debug("comp", "now visible")

    expect(consoleSpy).toHaveBeenCalledOnce()
  })

  test("configureLogger with error level filters out info and warn", () => {
    configureLogger("error", "json")

    logger.debug("comp", "hidden")
    logger.info("comp", "hidden")
    logger.warn("comp", "hidden")
    logger.error("comp", "visible")

    expect(consoleSpy).toHaveBeenCalledOnce()
  })

  test("text format outputs human-readable log line", () => {
    configureLogger("info", "text")
    logger.info("my-comp", "something happened")

    const output = consoleSpy.mock.calls[0]?.[0] as string
    expect(output).toContain("[INFO]")
    expect(output).toContain("[my-comp]")
    expect(output).toContain("something happened")
  })

  test("text format includes extra fields as key=value pairs", () => {
    configureLogger("info", "text")
    logger.warn("comp", "msg", { issueId: "i1", exitCode: 1 })

    const output = consoleSpy.mock.calls[0]?.[0] as string
    expect(output).toContain("[WARN]")
    expect(output).toContain("issueId=i1")
    expect(output).toContain("exitCode=1")
  })

  test("text format without fields omits extra section", () => {
    configureLogger("info", "text")
    logger.info("comp", "plain msg")

    const output = consoleSpy.mock.calls[0]?.[0] as string
    expect(output).toMatch(/\[INFO\] \[comp\] plain msg$/)
  })
})
