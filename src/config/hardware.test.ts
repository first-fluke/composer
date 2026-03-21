import { describe, expect, it } from "bun:test"
import { detectHardware } from "./hardware"

describe("detectHardware", () => {
  it("returns positive cpuCores", () => {
    const hw = detectHardware()
    expect(hw.cpuCores).toBeGreaterThan(0)
  })

  it("returns positive totalMemoryGB", () => {
    const hw = detectHardware()
    expect(hw.totalMemoryGB).toBeGreaterThan(0)
  })

  it("returns recommended >= 1", () => {
    const hw = detectHardware()
    expect(hw.recommended).toBeGreaterThanOrEqual(1)
  })

  it("recommended does not exceed CPU cores", () => {
    const hw = detectHardware()
    expect(hw.recommended).toBeLessThanOrEqual(hw.cpuCores)
  })

  it("recommended does not exceed RAM / 4", () => {
    const hw = detectHardware()
    expect(hw.recommended).toBeLessThanOrEqual(Math.floor(hw.totalMemoryGB / 4))
  })
})
