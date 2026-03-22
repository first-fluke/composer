/**
 * DAG Operations — Pure functions for dependency graph analysis.
 * No I/O, no external dependencies. Domain layer only.
 */

import type { DagNode } from "./models"

/**
 * Detect cycles using Kahn's algorithm (topological sort).
 * Returns arrays of issue IDs forming each cycle. Empty array = no cycles.
 */
export function detectCycles(nodes: Record<string, DagNode>): string[][] {
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const id of Object.keys(nodes)) {
    inDegree.set(id, 0)
    adjacency.set(id, [])
  }

  for (const node of Object.values(nodes)) {
    for (const blockerId of node.blockedBy) {
      if (nodes[blockerId]) {
        adjacency.get(blockerId)?.push(node.issueId)
        inDegree.set(node.issueId, (inDegree.get(node.issueId) ?? 0) + 1)
      }
    }
  }

  // BFS: process nodes with in-degree 0
  const queue: string[] = []
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id)
  }

  const visited = new Set<string>()
  while (queue.length > 0) {
    const id = queue.shift()
    if (!id) break
    visited.add(id)
    for (const neighbor of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) queue.push(neighbor)
    }
  }

  // Remaining nodes are in cycles
  const cycleNodes = Object.keys(nodes).filter((id) => !visited.has(id))
  if (cycleNodes.length === 0) return []

  return [cycleNodes]
}

/**
 * Get unresolved blockers for an issue.
 * A blocker is "unresolved" only if it exists as a node in the DAG (open issue).
 * Missing from DAG = already resolved (Done/Cancelled/external).
 */
export function getUnresolvedBlockers(nodes: Record<string, DagNode>, issueId: string): string[] {
  const node = nodes[issueId]
  if (!node) return []
  return node.blockedBy.filter((blockerId) => {
    const blocker = nodes[blockerId]
    return blocker && blocker.status !== "done" && blocker.status !== "cancelled"
  })
}

/**
 * Get all issues that are ready to execute (no unresolved blockers, status is "waiting" or "ready").
 */
export function getReadyIssues(nodes: Record<string, DagNode>): string[] {
  return Object.keys(nodes).filter((id) => {
    const node = nodes[id]
    if (!node || (node.status !== "waiting" && node.status !== "ready")) return false
    return getUnresolvedBlockers(nodes, id).length === 0
  })
}

/**
 * Get issues that become unblocked when the given issue completes.
 * Returns issue IDs whose last remaining blocker was the completed issue.
 */
export function getUnblockedByCompletion(nodes: Record<string, DagNode>, completedId: string): string[] {
  const completedNode = nodes[completedId]
  if (!completedNode) return []

  return completedNode.blocks.filter((blockedId) => {
    const blocked = nodes[blockedId]
    if (!blocked || blocked.status === "done" || blocked.status === "cancelled") return false
    // Check if all remaining blockers (excluding completedId) are resolved
    const remaining = blocked.blockedBy.filter((bid) => {
      if (bid === completedId) return false
      const b = nodes[bid]
      return b && b.status !== "done" && b.status !== "cancelled"
    })
    return remaining.length === 0
  })
}

/**
 * Check if all children of a parent issue are done.
 * Returns true if parent has no children (vacuous truth).
 */
export function allChildrenDone(nodes: Record<string, DagNode>, parentId: string): boolean {
  const parent = nodes[parentId]
  if (!parent || parent.children.length === 0) return true
  return parent.children.every((childId) => {
    const child = nodes[childId]
    return !child || child.status === "done"
  })
}
