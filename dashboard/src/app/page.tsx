"use client"

import { PixiCanvas } from "@/components/pixi-canvas"
import { StatusHud } from "@/features/office/components/status-hud"
import { IssuePanel } from "@/features/office/components/issue-panel"
import { ConnectionStatus as ConnectionStatusBar } from "@/features/orchestrator/components/connection-status"
import { useOrchestratorSSE } from "@/features/orchestrator/utils/use-orchestrator-sse"
import { TeamHud } from "@/features/team/components/team-hud"
import { TeamPanel } from "@/features/team/components/team-panel"
import { useLocalOrchestrator } from "@/features/team/hooks/use-local-orchestrator"

// Split into two components to avoid conditional hook execution
function StandaloneDashboard() {
  const { data, status, reconnect } = useOrchestratorSSE("/api/events")
  const { teamState, status: teamStatus } = useLocalOrchestrator("/api/events")

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-gray-950">
      <PixiCanvas state={data} />
      <TeamHud teamState={teamState} connectionStatus={teamStatus} />
      <TeamPanel teamState={teamState} />
      <ConnectionStatusBar status={status} onReconnect={reconnect} />
    </main>
  )
}

function TeamDashboard() {
  // TODO: wire useTeamLedger when Supabase is configured
  // For now, fall back to standalone
  const { data, status, reconnect } = useOrchestratorSSE("/api/events")
  const { teamState, status: teamStatus } = useLocalOrchestrator("/api/events")

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-gray-950">
      <PixiCanvas state={data} />
      <TeamHud teamState={teamState} connectionStatus={teamStatus} />
      <TeamPanel teamState={teamState} />
      <ConnectionStatusBar status={status} onReconnect={reconnect} />
    </main>
  )
}

export default function DashboardPage() {
  return <StandaloneDashboard />
}
