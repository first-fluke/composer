"use client"

import { PixiCanvas } from "@/components/pixi-canvas"
import { StatusHud } from "@/features/office/components/status-hud"
import { IssuePanel } from "@/features/office/components/issue-panel"
import { ConnectionStatus as ConnectionStatusBar } from "@/features/orchestrator/components/connection-status"
import { useOrchestratorSSE } from "@/features/orchestrator/utils/use-orchestrator-sse"
import { TeamHud } from "@/features/team/components/team-hud"
import { TeamPanel } from "@/features/team/components/team-panel"
import { useLocalOrchestrator } from "@/features/team/hooks/use-local-orchestrator"

// Team mode is enabled when NEXT_PUBLIC_SUPABASE_URL is set
const isTeamMode = !!process.env.NEXT_PUBLIC_SUPABASE_URL

export default function DashboardPage() {
  // Standalone mode: existing SSE + team adapter
  const { data, status, reconnect } = useOrchestratorSSE("/api/events")
  const { teamState, status: teamStatus } = useLocalOrchestrator("/api/events")

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-gray-950">
      <PixiCanvas state={data} />

      {/* Team mode: show team components */}
      {teamState && (
        <>
          <TeamHud teamState={teamState} connectionStatus={teamStatus} />
          <TeamPanel teamState={teamState} />
        </>
      )}

      {/* Standalone mode: show original components */}
      {!teamState && (
        <>
          <StatusHud state={data} connectionStatus={status} />
          <IssuePanel workspaces={data?.activeWorkspaces ?? []} />
        </>
      )}

      <ConnectionStatusBar status={status} onReconnect={reconnect} />
    </main>
  )
}
