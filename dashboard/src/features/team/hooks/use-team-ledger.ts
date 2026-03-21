"use client"

import { useEffect, useRef, useState } from "react"
import type { TeamState, TeamNode, ConnectionStatus } from "../types/team"
import { replayLedger } from "@agent-valley/relay/replay"
import type { LedgerEvent } from "@agent-valley/domain/ledger"
import type { NodePresence } from "@agent-valley/domain/ledger"

interface LedgerRow {
  seq: number
  team_id: string
  node_id: string
  user_id: string
  type: string
  payload: Record<string, unknown>
  client_timestamp: string
  created_at: string
}

/** Convert Supabase REST row to LedgerEvent for shared replay */
function rowToLedgerEvent(row: LedgerRow): LedgerEvent {
  return {
    v: 1,
    seq: row.seq,
    relayTimestamp: row.created_at,
    clientTimestamp: row.client_timestamp,
    nodeId: row.node_id,
    type: row.type as LedgerEvent["type"],
    payload: row.payload as any,
  } as LedgerEvent
}

/** Convert domain NodePresence (Map-based) to dashboard TeamNode (array-based) */
function toTeamNodes(nodes: Map<string, NodePresence>): TeamNode[] {
  return Array.from(nodes.values()).map((n) => ({
    nodeId: n.nodeId,
    displayName: n.displayName,
    defaultAgentType: n.defaultAgentType,
    maxParallel: n.maxParallel,
    online: n.online,
    joinedAt: n.joinedAt,
    activeIssues: n.activeIssues,
  }))
}

interface UseTeamLedgerOptions {
  supabaseUrl: string
  supabaseAnonKey: string
  teamId: string
}

export function useTeamLedger(options: UseTeamLedgerOptions | null) {
  const [teamState, setTeamState] = useState<TeamState | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>("connecting")
  const lastSeqRef = useRef(0)

  useEffect(() => {
    if (!options) {
      setStatus("disconnected")
      return
    }

    let active = true
    const { supabaseUrl, supabaseAnonKey, teamId } = options

    const fetchAndSync = async () => {
      try {
        const res = await fetch(
          `${supabaseUrl}/rest/v1/ledger_events?team_id=eq.${teamId}&order=seq.asc`,
          {
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${supabaseAnonKey}`,
            },
          },
        )

        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)

        const rows = (await res.json()) as LedgerRow[]
        if (!active) return

        const events = rows.map(rowToLedgerEvent)
        const state = replayLedger(events)

        lastSeqRef.current = state.lastSeq
        setTeamState({ nodes: toTeamNodes(state.nodes), lastSeq: state.lastSeq })
        setStatus("connected")
      } catch {
        if (active) setStatus("error")
      }
    }

    // Poll for incremental changes
    const pollInterval = setInterval(async () => {
      if (!active) return
      try {
        const res = await fetch(
          `${supabaseUrl}/rest/v1/ledger_events?team_id=eq.${teamId}&seq=gt.${lastSeqRef.current}&order=seq.asc`,
          {
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${supabaseAnonKey}`,
            },
          },
        )
        if (!res.ok) return

        const rows = (await res.json()) as LedgerRow[]
        if (rows.length === 0 || !active) return

        // Re-fetch full ledger and replay (simpler than incremental merge)
        await fetchAndSync()
      } catch {
        // silent — will retry next poll
      }
    }, 3000)

    fetchAndSync()

    return () => {
      active = false
      clearInterval(pollInterval)
    }
  }, [options?.supabaseUrl, options?.supabaseAnonKey, options?.teamId])

  return { teamState, status }
}
