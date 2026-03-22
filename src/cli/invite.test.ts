import { describe, expect, it } from "bun:test"
import type { InviteData } from "./invite"
import { decodeInvite, encodeInvite } from "./invite"

const sampleInvite: InviteData = {
  teamId: "ACR",
  teamUuid: "uuid-team-123",
  webhookSecret: "lin_wh_secret456",
  todoStateId: "state-todo",
  inProgressStateId: "state-ip",
  doneStateId: "state-done",
  cancelledStateId: "state-cancel",
  agentType: "claude",
  serverPort: "9741",
}

describe("encodeInvite", () => {
  it("produces av://invite/ prefixed string", () => {
    const encoded = encodeInvite(sampleInvite)
    expect(encoded.startsWith("av://invite/")).toBe(true)
  })

  it("produces valid base64url after prefix", () => {
    const encoded = encodeInvite(sampleInvite)
    const b64 = encoded.slice("av://invite/".length)
    expect(() => Buffer.from(b64, "base64url")).not.toThrow()
  })
})

describe("decodeInvite", () => {
  it("roundtrips with encodeInvite", () => {
    const encoded = encodeInvite(sampleInvite)
    const decoded = decodeInvite(encoded)
    expect(decoded).toEqual(sampleInvite)
  })

  it("returns null for invalid prefix", () => {
    expect(decodeInvite("https://example.com")).toBeNull()
  })

  it("returns null for invalid base64", () => {
    expect(decodeInvite("av://invite/!!!invalid")).toBeNull()
  })

  it("returns null for valid base64 but missing fields", () => {
    const partial = Buffer.from(JSON.stringify({ teamId: "ACR" })).toString("base64url")
    expect(decodeInvite(`av://invite/${partial}`)).toBeNull()
  })

  it("returns null for non-string field values", () => {
    const bad = Buffer.from(JSON.stringify({ ...sampleInvite, teamId: 123 })).toString("base64url")
    expect(decodeInvite(`av://invite/${bad}`)).toBeNull()
  })

  it("handles whitespace around the encoded string", () => {
    const encoded = encodeInvite(sampleInvite)
    const decoded = decodeInvite(`${encoded}  `)
    expect(decoded).toEqual(sampleInvite)
  })
})
