/**
 * Workspace Manager — git worktree creation, cleanup, and lifecycle management.
 */

import type { Issue, Workspace, RunAttempt } from "../domain/models"
import { logger } from "../observability/logger"

export class WorkspaceManager {
  constructor(
    private rootPath: string,
    private retentionDays: number = 7,
  ) {}

  deriveKey(identifier: string): string {
    return identifier.replace(/[^A-Za-z0-9._-]/g, "_")
  }

  async create(issue: Issue): Promise<Workspace> {
    const key = this.deriveKey(issue.identifier)
    const path = `${this.rootPath}/${key}`
    const branch = `symphony/${key}`

    // Create git worktree first (it creates the directory)
    const wt = Bun.spawn(["git", "worktree", "add", path, "-b", branch], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    })
    await wt.exited

    if (wt.exitCode !== 0) {
      // Worktree might already exist — try reusing
      const existing = await this.get(issue.id)
      if (existing) {
        logger.info("workspace-manager", "Reusing existing workspace", { issueId: issue.id, workspacePath: path })
        return existing
      }
      const stderr = await new Response(wt.stderr).text()
      throw new Error(`git worktree add failed: ${stderr}\n  Fix: Ensure ${this.rootPath} is inside a git repository`)
    }

    // Create .symphony metadata directory after worktree
    await Bun.spawn(["mkdir", "-p", `${path}/.symphony/attempts`]).exited

    const workspace: Workspace = {
      issueId: issue.id,
      path,
      key,
      status: "idle",
      createdAt: new Date().toISOString(),
    }

    logger.info("workspace-manager", "Workspace created", { issueId: issue.id, workspacePath: path })
    return workspace
  }

  async get(issueId: string): Promise<Workspace | null> {
    // Scan existing workspaces
    const entries = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: this.rootPath, onlyFiles: false }))
    for (const entry of entries) {
      const metaPath = `${this.rootPath}/${entry}/.symphony/attempts`
      if (await Bun.file(`${this.rootPath}/${entry}/.git`).exists()) {
        // Found a worktree — check if it matches the issueId
        // In practice, we store issueId in the workspace metadata
        // For now, return based on directory existence
        return {
          issueId,
          path: `${this.rootPath}/${entry}`,
          key: entry,
          status: "idle",
          createdAt: new Date().toISOString(),
        }
      }
    }
    return null
  }

  async saveAttempt(workspace: Workspace, attempt: RunAttempt): Promise<void> {
    const path = `${workspace.path}/.symphony/attempts/${attempt.id}.json`
    await Bun.write(path, JSON.stringify(attempt, null, 2))
  }

  async cleanup(workspace: Workspace): Promise<void> {
    // Remove git worktree
    const wt = Bun.spawn(["git", "worktree", "remove", workspace.path, "--force"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await wt.exited

    // Remove directory if it still exists
    await Bun.spawn(["rm", "-rf", workspace.path]).exited

    logger.info("workspace-manager", "Workspace cleaned up", { issueId: workspace.issueId, workspacePath: workspace.path })
  }
}
