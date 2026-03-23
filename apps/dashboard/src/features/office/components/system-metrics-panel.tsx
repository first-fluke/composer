"use client"

import type { SystemMetrics } from "@/features/office/types/agent"

interface SystemMetricsPanelProps {
  metrics: SystemMetrics | undefined
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0

  return (
    <div className="h-2 w-full rounded-full bg-gray-700">
      <div
        className={`h-2 rounded-full ${color}`}
        style={{ width: `${pct}%`, transition: "width 0.5s ease" }}
      />
    </div>
  )
}

export function SystemMetricsPanel({ metrics }: SystemMetricsPanelProps) {
  if (!metrics) return null

  const heapPct = metrics.memoryHeapTotal > 0
    ? Math.round((metrics.memoryHeapUsed / metrics.memoryHeapTotal) * 100)
    : 0

  const cpuTotal = metrics.cpuUser + metrics.cpuSystem
  // cpuUsage returns microseconds, normalize for display
  const cpuUserPct = cpuTotal > 0 ? Math.round((metrics.cpuUser / cpuTotal) * 100) : 0

  return (
    <div className="absolute bottom-4 right-4 bg-gray-800/90 rounded-lg p-4 min-w-56 border border-gray-700">
      <h2 className="text-sm font-bold text-gray-300 mb-3">System</h2>

      <div className="space-y-3 text-xs">
        {/* Memory RSS */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-gray-400">RSS</span>
            <span className="text-white">{formatBytes(metrics.memoryRss)}</span>
          </div>
        </div>

        {/* Heap */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-gray-400">Heap</span>
            <span className="text-white">
              {formatBytes(metrics.memoryHeapUsed)} / {formatBytes(metrics.memoryHeapTotal)}
              <span className="text-gray-500 ml-1">({heapPct}%)</span>
            </span>
          </div>
          <Bar
            value={metrics.memoryHeapUsed}
            max={metrics.memoryHeapTotal}
            color={heapPct > 85 ? "bg-red-500" : heapPct > 60 ? "bg-yellow-500" : "bg-green-500"}
          />
        </div>

        {/* CPU split */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-gray-400">CPU</span>
            <span className="text-white">
              user {cpuUserPct}% / sys {100 - cpuUserPct}%
            </span>
          </div>
          <div className="flex h-2 w-full rounded-full overflow-hidden bg-gray-700">
            <div
              className="bg-blue-500 h-2"
              style={{ width: `${cpuUserPct}%`, transition: "width 0.5s ease" }}
            />
            <div
              className="bg-purple-500 h-2"
              style={{ width: `${100 - cpuUserPct}%`, transition: "width 0.5s ease" }}
            />
          </div>
        </div>

        {/* Uptime */}
        <div className="flex justify-between">
          <span className="text-gray-400">Uptime</span>
          <span className="text-white">{formatUptime(metrics.uptime)}</span>
        </div>
      </div>
    </div>
  )
}
